// Cinematic tour: a fixed set of shots flown along paths anchored on real data (the OSM landmark plan, street polylines, festival layout).
//   1 Sunrise over Hawa Mahal   2 A drift down Johari Bazaar   3 Diwali night in the bazaars   4 Monsoon dusk over the City Palace
//   5 Jal Mahal -> Amer Fort, ending in the golden hour
// Each shot sets the date / time / weather / festival, teleports, waits for the tiles, fades in, flies (terrain-following) and fades out.
// After the last shot (or on any user input) control passes to free-fly at the camera's current pose. Shots whose anchor is missing from the data are skipped.
import { catmullRom, polylineLengths, polylineAt, clamp, lerp, smoothstep01 } from './math.js';
import { densestSpot } from './routes.js';
import { fromIST, sunEvents } from '../astro/astro.js';

const MIN = 60000;
const way = (pts) => (u, out = []) => catmullRom(pts, u, out); // [x, z, h] waypoints -> position along the curve

/** build the shots that the loaded data supports */
export function buildShots(app) {
  const man = app.city.manifest || {};
  const items = (app.landmarkPlan && app.landmarkPlan.items) || [];
  const fest = app.festival;
  const shots = [];
  const day1 = [2026, 10, 25];
  const sun1 = sunEvents(fromIST(day1[0], day1[1], day1[2], 12));

  const hawa = items.find((k) => k.kind === 'hawa');
  if (hawa) {
    // n = out of the facade toward the street (east), u = along the facade
    const P = (n, u, h) => [hawa.x + hawa.nx * n + hawa.ux * u, hawa.z + hawa.nz * n + hawa.uz * u, h];
    // starts above the roofs across the street (about 12-14 m) so the facade is not hidden behind them, then rises and drifts along it
    const pos = way([P(90, -44, 13), P(74, -26, 20), P(62, -8, 30), P(52, 12, 44)]);
    const lk = way([P(0, -8, 9), P(0, -2, 13), P(0, 4, 17), P(0, 8, 21)]);
    shots.push({
      id: 'sunrise', title: 'Sunrise over Hawa Mahal', sub: 'the street facade faces east', duration: 36, speed: 60,
      prepare(a) { a.setDate(...day1, 6); a.clock.set(sun1.sunrise - 14 * MIN); a.setWeather('clear', true); a.setFestival('off', { moveClock: false }); },
      path: (u) => ({ pos: pos(u), look: lk(u), fov: 55 }),
    });
  }

  const jo = fest && fest.routes && fest.routes.johari;
  if (jo && jo.length >= 8) {
    let pts = jo;
    if (pts[1] < pts[pts.length - 1]) { pts = new Float32Array(jo.length); for (let i = 0; i < jo.length / 2; i++) { pts[i * 2] = jo[jo.length - 2 - i * 2]; pts[i * 2 + 1] = jo[jo.length - 1 - i * 2]; } } // start at the southern end, drift north
    const cum = polylineLengths(pts), L = cum[cum.length - 1];
    const dur = 40, speed = Math.min(6.5, L / dur), a = { x: 0, z: 0, dx: 0, dz: 1 }, b = { x: 0, z: 0, dx: 0, dz: 1 };
    shots.push({
      id: 'johari', title: 'Johari Bazaar', sub: 'the jewellers\' street, mid-morning', duration: dur, speed: 1,
      prepare(x) { x.setDate(...day1, 10.6); x.setWeather('clear', true); x.setFestival('off', { moveClock: false }); },
      path(u) {
        const s = speed * u * dur;
        polylineAt(pts, cum, s, a); polylineAt(pts, cum, s + 26, b);
        const sway = Math.sin(u * dur * 0.55) * 0.7;
        return { pos: [a.x - a.dz * sway, a.z + a.dx * sway, 3.3], look: [b.x, b.z, 7.5], fov: 64 };
      },
    });
  }

  const spot = fest && fest.layout ? densestSpot(fest.layout.spans) : null;
  if (spot) {
    const P = (d, h) => [spot.mx + spot.tx * d, spot.mz + spot.tz * d, h];
    const pos = way([P(-48, 2.8), P(-8, 3.0), P(40, 9), P(95, 42), P(150, 105)]);
    const lk = way([P(52, 6), P(84, 9), P(140, 16), P(220, 26), P(300, 60)]);
    shots.push({
      id: 'diwali', title: 'Diwali night', sub: 'Sunday 8 November 2026: a moonless sky', duration: 44, speed: 1,
      prepare(a) { a.setDate(2026, 11, 8, 20.1); a.setWeather('clear', true); a.setFestival('diwali', { moveClock: false }); a.festival.strength = 1; },
      path: (u) => ({ pos: pos(u), look: lk(u), fov: 62 }),
    });
  }

  const cp = items.find((k) => k.kind === 'chandra') || (man.landmarks && man.landmarks.cityPalace && man.landmarks.cityPalace[0]) || hawa;
  if (cp) {
    const sun2 = sunEvents(fromIST(2026, 8, 15, 12));
    shots.push({
      // 34 s at 20x = 11 minutes: from just before sunset into the first twilight
      id: 'monsoon', title: 'Monsoon dusk', sub: 'Hariyali Teej, 15 August 2026', duration: 34, speed: 20,
      prepare(a) { a.setDate(2026, 8, 15, 18); a.clock.set(sun2.sunset - 8 * MIN); a.setWeather('monsoon', true); a.weather.s.rain = 0.85; a.setFestival('off', { moveClock: false }); },
      path(u) {
        const ang = lerp(-0.5, 1.15, u), r = lerp(165, 125, u);
        return { pos: [cp.x + Math.sin(ang) * r, cp.z + Math.cos(ang) * r, lerp(34, 66, u)], look: [cp.x, cp.z, 20], fov: 58 };
      },
    });
  }

  const jal = items.find((k) => k.kind === 'jal');
  const amer = man.landmarks && man.landmarks.amerFort && man.landmarks.amerFort[0];
  if (jal && amer) {
    const dx = amer.x - jal.x, dz = amer.z - jal.z, dl = Math.hypot(dx, dz), d = [dx / dl, dz / dl], p = [-d[1], d[0]];
    const J = (f, s, h) => [jal.x + d[0] * f + p[0] * s, jal.z + d[1] * f + p[1] * s, h];
    const A = (f, s, h) => [amer.x + d[0] * f + p[0] * s, amer.z + d[1] * f + p[1] * s, h];
    const pos = way([J(-95, 0, 7), J(-60, -10, 22), J(20, -30, 85), J(900, 140, 190), J(dl * 0.55, -120, 240), A(-650, 170, 150), A(-250, 60, 78), A(-40, -80, 70)]);
    const lk = way([J(0, 0, 8), J(0, 0, 10), J(120, 0, 18), J(1300, 0, 70), A(-500, 0, 60), A(0, 0, 38), A(0, 0, 40), A(-1500, 0, 90)]);
    const dur = 64, speed = 40;
    const sun3 = sunEvents(fromIST(day1[0], day1[1], day1[2], 12));
    shots.push({
      id: 'amer', title: 'Jal Mahal to Amer Fort', sub: 'and back, at golden hour', duration: dur, speed,
      prepare(a) { a.setDate(...day1, 16); a.clock.set(sun3.sunset - 12 * MIN - dur * speed * 1000); a.setWeather('clear', true); a.setFestival('off', { moveClock: false }); },
      path: (u) => ({ pos: pos(u), look: lk(u), fov: 56 }),
    });
  }
  return shots;
}

export class Tour {
  constructor(app) {
    this.app = app;
    this.hooks = { fade() {}, title() {}, end() {} };
    this.state = 'idle'; // idle | intro | prepare | fadein | play
    this.shots = [];
    this.i = -1;
    this.t = 0;
    this._f = 0;
    this._token = 0;
    this._cur = null;
    this.stats = { shots: 0, completed: 0 };
  }

  get running() { return this.state !== 'idle'; }
  get shot() { return this._cur; }

  start() {
    this.shots = buildShots(this.app);
    this.stats.shots = this.shots.length;
    if (!this.shots.length) return false;
    this.i = -1;
    this.state = 'intro';
    this._f = 0;
    this.app.rig.setMode('tour');
    return true;
  }

  /** end the tour; the camera stays where it is and free-fly takes over */
  stop() {
    if (this.state === 'idle') return;
    this._token++;
    this.state = 'idle';
    this._cur = null;
    this.app.clock.speed = 1;
    this.hooks.fade(0);
    this.hooks.title('', '');
    this.app.rig.setMode('fly');
    this.hooks.end();
  }

  /** jump to the next shot now */
  next() { if (this.state === 'play' || this.state === 'fadein') { this.t = this._cur.duration; this.state = 'play'; } }

  /** p = { pos: [x, z, height above ground], look: [x, z, height above ground], fov }: terrain-following */
  _place(p) {
    const app = this.app, cam = app.camera, g = (x, z) => app.hf.heightAt(x, z);
    const [px, pz, ph] = p.pos, [lx, lz, lh] = p.look;
    cam.position.set(px, g(px, pz) + ph, pz);
    cam.lookAt(lx, g(lx, lz) + lh, lz);
    if (Math.abs(cam.fov - p.fov) > 0.01) { cam.fov = p.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
  }

  async _prepare(shot, token) {
    const app = this.app;
    shot.prepare(app);
    app.clock.speed = 1;
    this._place(shot.path(0));
    app.life?.teleport(app);
    try { await app.city.settle(app.camera, 9000); } catch { /* keep going with whatever streamed in */ }
    if (token !== this._token) return;
    app.clock.speed = shot.speed || 1;
    this.t = 0;
    this._place(shot.path(0));
    this.state = 'fadein';
    this._f = 0;
    this.hooks.title(shot.title, shot.sub);
  }

  _begin(i) {
    this.i = i;
    this._cur = this.shots[i];
    this.state = 'prepare';
    this.hooks.fade(1);
    this.hooks.title('', '');
    this._prepare(this._cur, ++this._token);
  }

  update(dt) {
    switch (this.state) {
      case 'idle': return;
      case 'intro': this._f += dt / 0.6; this.hooks.fade(smoothstep01(this._f)); if (this._f >= 1) this._begin(0); return;
      case 'prepare': return;
      case 'fadein': {
        this._f += dt / 1.0;
        this.hooks.fade(1 - smoothstep01(this._f));
        this._place(this._cur.path(0));
        if (this._f >= 1) this.state = 'play';
        return;
      }
      case 'play': {
        this.t += dt;
        const sh = this._cur, u = clamp(this.t / sh.duration, 0, 1);
        this._place(sh.path(u));
        const left = sh.duration - this.t;
        this.hooks.fade(left < 0.8 ? smoothstep01(1 - left / 0.8) : 0);
        if (this.t >= sh.duration) {
          this.stats.completed++;
          if (this.i + 1 < this.shots.length) this._begin(this.i + 1);
          else this.stop();
        }
      }
    }
  }
}
