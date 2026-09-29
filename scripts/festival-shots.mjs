// Night / festival / kite stills. Camera spots are derived from the same layout the app computes (real OSM streets + facades), so they follow the data.
// Usage: node scripts/festival-shots.mjs [--tier high] [--w 1600] [--h 900] [--only night,diwali,fireworks,kites,landmarks] [--out shots-tmp/festival]
import { mkdir } from 'node:fs/promises';
import { openSession } from './lib/session.mjs';
import { SPOT_JS } from './lib/festival-spot.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const OUT = args.out || 'shots-tmp/festival';
const only = args.only ? args.only.split(',') : null;
const want = (k) => !only || only.includes(k);
await mkdir(OUT, { recursive: true });
const sess = await openSession({ w: +(args.w || 1600), h: +(args.h || 900), tier: args.tier || 'high', query: { t: '20' } });
const P = sess.page;
const log = (name, info, extra = '') => console.log(name.padEnd(26), 'draws', info.info.drawCalls, 'tris', (info.info.triangles / 1e6).toFixed(2) + 'M', 'sun', info.sunAlt, 'moon', info.moonAlt, 'illum', info.illum, 'exp', info.exposure, extra);

try {
  // wait for the layout, then find the densest run of festival spans (a stretch of bazaar with facades on both sides)
  const spot = await P.evaluate(async (js) => { const a = window.__jaipur; return (new Function('a', 'return (async()=>{' + js + '})()'))(a); }, SPOT_JS);
  if (!spot) throw new Error('festival layout not available');
  console.log('layout', JSON.stringify(spot.stats), 'densest spot', spot.mx.toFixed(0), spot.mz.toFixed(0), 'spans within 70 m:', spot.dense);
  const cam = (back, eh, lookAhead, lh) => `
    const s = ${JSON.stringify(spot)}; const hf = a.hf;
    const px = s.mx - s.tx * ${back}, pz = s.mz - s.tz * ${back}, lx = s.mx + s.tx * ${lookAhead}, lz = s.mz + s.tz * ${lookAhead};
    a.setView([px, hf.heightAt(px, pz) + ${eh}, pz], [lx, hf.heightAt(lx, lz) + ${lh}, lz], 64);
    a.life.teleport(a); await a.life.run(a, 1); await a.city.settle(a.camera, 120000); await a.life.run(a, 120);`;

  if (want('night')) {
    // ordinary night: lamps + floodlit landmarks, festival off
    let i = await sess.shot({ date: '2026-10-20', t: 20.5, out: `${OUT}/night-street.png`, n: 3, eval: `a.setFestival('off', { moveClock: false }); a.festival.strength = 0; a.setWeather('clear', true); await a.festival.settle(a, 0);` + cam(14, 2.4, 60, 4) });
    log('night-street (lamps only)', i);
  }
  if (want('diwali')) {
    const ev = (extra) => `a.setFestival('diwali', { moveClock: false }); a.festival.strength = 1; await a.festival.settle(a, 0);` + extra;
    let i = await sess.shot({ date: '2026-11-08', t: 20.2, out: `${OUT}/diwali-street.png`, n: 3, eval: ev(cam(16, 2.6, 60, 6)) });
    log('diwali-street (moonless)', i, `bulbs ${await P.evaluate(() => window.__jaipur.festival.stats.bulbs)} wires ${await P.evaluate(() => window.__jaipur.festival.stats.wires)}`);
    i = await sess.shot({ date: '2026-11-08', t: 20.6, out: `${OUT}/diwali-street-high.png`, n: 3, eval: ev(cam(40, 14, 80, 8)) });
    log('diwali-street-high', i);
    i = await sess.shot({ date: '2026-11-08', t: 21.0, out: `${OUT}/diwali-aerial.png`, n: 3, eval: ev(`
      const s = ${JSON.stringify(spot)}; const hf = a.hf;
      a.setView([s.mx - s.tx * 260, hf.heightAt(s.mx, s.mz) + 190, s.mz - s.tz * 260], [s.mx + s.tx * 200, hf.heightAt(s.mx, s.mz), s.mz + s.tz * 200], 58);
      await a.city.settle(a.camera, 120000);`) });
    log('diwali-aerial', i);
  }
  if (want('fireworks')) {
    const ev = `a.setFestival('diwali', { moveClock: false }); a.festival.strength = 1; await a.festival.settle(a, 0);
      const s = ${JSON.stringify(spot)}; const hf = a.hf; const fw = a.festival.fireworks; fw.clear();
      a.setView([s.mx - s.tx * 30, hf.heightAt(s.mx, s.mz) + 3, s.mz - s.tz * 30], [s.mx + s.tx * 260, hf.heightAt(s.mx, s.mz) + 130, s.mz + s.tz * 260], 64);
      await a.city.settle(a.camera, 120000);
      const at = (d, h, side) => [s.mx + s.tx * d - s.tz * side, hf.heightAt(s.mx, s.mz) + h, s.mz + s.tz * d + s.tx * side];
      const C = [[1, 0.62, 0.18], [1, 0.1, 0.6], [0.1, 1, 0.2], [0.12, 0.3, 1], [1, 0.06, 0.04]];
      [[380, 200, -40, 0, 0], [520, 250, 120, 1, 1], [700, 300, -150, 2, 2], [450, 170, 200, 3, 3], [900, 320, 20, 0, 4]].forEach(([d, h, sd, k, c], j) => { const p = at(d, h, sd); fw.time = 0; fw.burst(p[0], p[1], p[2], k, C[c]); fw.time = 0.35 + j * 0.28; });
      fw.time = 1.9; fw.uniforms.uT.value = 1.9;
      for (const b of fw.bursts) b.t0 = 1.9 - 0.9;`;
    const i = await sess.shot({ date: '2026-11-08', t: 21.5, out: `${OUT}/diwali-fireworks.png`, n: 1, eval: ev });
    log('diwali-fireworks', i, `bursts ${await P.evaluate(() => window.__jaipur.festival.fireworks.stats.bursts)}`);
  }
  if (want('landmarks') && spot.hawa) {
    const h = spot.hawa;
    for (const [name, off, eh, lat] of [['hawa-lit-street', 30, 3.5, 16], ['hawa-lit-drone', 110, 55, 0]]) {
      const i = await sess.shot({ date: '2026-11-08', t: 20.4, out: `${OUT}/${name}.png`, n: 3, eval: `
        a.setFestival('diwali', { moveClock: false }); a.festival.strength = 1; await a.festival.settle(a, 0);
        const it = ${JSON.stringify(h)}; const hf = a.hf;
        const px = it.x + it.nx * ${off} + it.ux * ${lat}, pz = it.z + it.nz * ${off} + it.uz * ${lat};
        a.setView([px, hf.heightAt(px, pz) + ${eh}, pz], [it.x, hf.heightAt(it.x, it.z) + 9, it.z], 62);
        a.life.teleport(a); await a.life.run(a, 1); await a.city.settle(a.camera, 120000); await a.life.run(a, 90);` });
      log(name, i);
    }
  }
  if (want('kites')) {
    const ev = (eh, back, pitch, fov = 64) => `a.setFestival('sankranti', { moveClock: false }); await a.festival.settle(a, 25);
      const s = ${JSON.stringify(spot)}; const hf = a.hf;
      const px = s.mx - s.tx * ${back}, pz = s.mz - s.tz * ${back};
      const w = a.weather.s, wx = Math.sin(w.windDir), wz = Math.cos(w.windDir);
      // look across the wind so the kites (downwind of their flyers) sit in front of the camera
      a.setView([px, hf.heightAt(px, pz) + ${eh}, pz], [px + wx * 120, hf.heightAt(px, pz) + ${eh} + ${pitch}, pz + wz * 120], ${fov});
      a.life.teleport(a); await a.life.run(a, 1); await a.city.settle(a.camera, 120000); await a.life.run(a, 90);
      await a.festival.settle(a, 3);`;
    let i = await sess.shot({ date: '2027-01-14', t: 11, weather: 'winter', out: `${OUT}/kites-street.png`, n: 3, eval: ev(2.6, 20, 75, 72) });
    log('kites-street', i, `kites ${await P.evaluate(() => window.__jaipur.festival.stats.kites)}`);
    i = await sess.shot({ date: '2027-01-14', t: 16.4, weather: 'winter', out: `${OUT}/kites-golden.png`, n: 3, eval: ev(20, 40, 85, 74) });
    log('kites-golden-hour', i, `kites ${await P.evaluate(() => window.__jaipur.festival.stats.kites)}`);
    // from a flyer's roof, looking up the string
    i = await sess.shot({ date: '2027-01-14', t: 15.6, weather: 'winter', out: `${OUT}/kites-flyer.png`, n: 3, eval: `a.setFestival('sankranti', { moveClock: false }); await a.festival.settle(a, 30);
      const v = a.festival.flyerView(); a.setView(v.pos, [v.look[0], v.look[1] - 8, v.look[2]], 70);
      a.life.teleport(a); await a.life.run(a, 1); await a.city.settle(a.camera, 120000); await a.festival.settle(a, 2);` });
    log('kites-flyer-roof', i, `kites ${await P.evaluate(() => window.__jaipur.festival.stats.kites)}`);
  }
  console.log(sess.logs.join('\n') || 'no console problems');
} finally {
  await sess.close();
}
process.exit(0);
