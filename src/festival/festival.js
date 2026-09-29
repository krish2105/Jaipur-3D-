// Festival / night controller: street lamps, festival strings + diyas + roofline lights, lit landmarks, fireworks (Diwali) and kites (Makar Sankranti).
//
//  modes:  'off' | 'diwali' | 'sankranti'      (night street lighting and lit landmarks are always on after dark, independent of the mode)
//  It owns the light grid (coloured street light read by every lit material), the instanced renderers and the kite simulation, and is driven by
//  the one simulation clock (`update` fixed step, `frame` per rendered frame).
//  Data: OSM streets + footprints; APPROX generated lamps / decoration (see layout.js); Diwali 8 Nov 2026 is moonless by the astro module.
import * as THREE from 'three';
import { ENV } from '../render/env.js';
import { LANDMARK_LIGHT } from '../world/landmarks/kit.js';
import { LightGrid } from './lightgrid.js';
import { GlowPoints, LampLayer, SpanWires } from './lights.js';
import { Fireworks } from './fireworks.js';
import { KiteSim } from './kites.js';
import { KiteRenderer } from './kiteRender.js';
import { landmarkSources } from './landmarkLights.js';
import { Bins } from './bins.js';
import { hawaOutline } from '../world/landmarks/hawaMahal.js';
import { LAMP_HEIGHT } from './layout.js';
import FestivalWorker from './festivalWorker.js?worker';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const FESTIVAL_MODES = ['off', 'diwali', 'sankranti'];
const LAMP_COL = [1.0, 0.72, 0.42];
// light-grid gains are irradiance in directional-light units (full moon 0.62); night exposure is 7.6-9.8x, so a lit street sits around 0.5-1.5
const KIND_GAIN = [0.55, 0.5, 0.4]; // per source kind: string spans, roofline runs, diya runs

export class Festival {
  /**
   * @param {{scene:THREE.Scene, settings:object, hf:object, lighting?:object, manifest:object, landmarkItems?:object[], base:string}} o
   */
  constructor(o) {
    this.scene = o.scene;
    this.s = o.settings;
    this.hf = o.hf;
    this.manifest = o.manifest;
    this.base = o.base;
    const s = o.settings;
    this.mode = 'off';
    this.strength = 0;        // 0..1 festival lighting (eased)
    this.target = 0;
    this.lampK = 0;           // street lamps 0..1
    this.landK = 0;           // floodlit landmarks 0..1
    this.fl = 0;              // festival bulbs on (strength x after-dark)
    this.layout = null;
    this.routes = {};
    this.error = null;
    this.group = new THREE.Group();
    this.group.name = 'festival';
    this.glow = new GlowPoints({ capacity: s.glowBulbs, radius: s.glowRadius });
    this.lampLayer = new LampLayer({ capacity: s.lampPoles, radius: s.lampRadius, hf: o.hf, lighting: o.lighting });
    this.wires = new SpanWires({ capacity: s.wireSpans, radius: s.glowRadius * 0.85 });
    this.fireworks = new Fireworks({ capacity: s.fireworkParticles, hf: o.hf });
    // far layers (high / medium tiers): the lit bazaars and the street lamps as soft glows so aerial and drone views of the night city are not dark
    this.farFest = s.farGlow ? new GlowPoints({ capacity: Math.min(s.farGlow, 1600), radius: s.farGlowRadius, gain: 1.05 }) : null;
    this.farLamps = s.farGlow ? new GlowPoints({ capacity: s.farGlow, radius: s.farGlowRadius, gain: 2.6 }) : null;
    this.group.add(this.glow.mesh, this.lampLayer.group, this.wires.mesh, this.fireworks.mesh);
    if (this.farFest) this.group.add(this.farFest.mesh, this.farLamps.mesh);
    this.scene.add(this.group);
    this.grid = new LightGrid({ n: s.lightGridN, size: s.lightGridSize, groundAt: (x, z) => o.hf.heightAt(x, z) });
    this.landSrc = landmarkSources(o.landmarkItems || []);
    this.landmarks = o.landmarks || null;
    this.sourceBins = null;
    this.kites = null;
    this.kiteRender = null;
    this.kitesOn = false;
    this._tmp = [];
    this._gridKey = '';
    this._gridAge = 1;
    this._fwSrc = [];
    this.stats = { bulbs: 0, lamps: 0, wires: 0, kites: 0, bursts: 0, gridMs: 0 };
    this.ready = this._plan();
  }

  /** ask the worker for the lamp / decoration layout; resolves true when applied */
  _plan() {
    const man = this.manifest;
    if (!man || !man.tiles) return Promise.resolve(false);
    const tiles = [];
    const R = 2300 + 500;
    for (const key of Object.keys(man.tiles)) {
      const [ix, iz] = key.split('_').map(Number);
      if (!man.tiles[key].b) continue;
      if (Math.hypot((ix + 0.5) * 500, (iz + 0.5) * 500) <= R) tiles.push([ix, iz]);
    }
    const sm = this.hf.sampler;
    const worker = new FestivalWorker();
    this.worker = worker;
    return new Promise((resolve) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'error') { this.error = m.error; console.warn('festival layout unavailable:', m.error); resolve(false); }
        else if (m.type === 'plan') { this._apply(m); resolve(true); }
        worker.terminate();
      };
      worker.postMessage({
        type: 'plan', graphUrl: new URL(`${this.base}data/osm/graph.json`, location.href).href, base: new URL(`${this.base}data/osm/`, location.href).href,
        tiles, lampRadius: 3600, festRadius: 1900, roofRadius: 2300,
        near: sm?.near, nearN: sm?.nearN, nearHalf: sm?.nearHalf, far: sm?.far, farN: sm?.farN, farHalf: sm?.farHalf,
      });
    });
  }

  _apply(m) {
    this.layout = m;
    this.routes = m.routes || {};
    this.glow.setData(this._withLandmarkBulbs(m.bulbs));
    this.lampLayer.setData(m.lamps);
    this.wires.setData(m.spans);
    this.sourceBins = new Bins(m.sources, 7, 0, 1, 64);
    if (this.farFest) {
      const hf = this.hf;
      const fs = new Float32Array((m.sources.length / 7) * 8);
      for (let i = 0, n = m.sources.length / 7; i < n; i++) {
        const o = i * 7, x = m.sources[o], z = m.sources[o + 1];
        // colour of the run, normalised so a big run does not blow out (the soft glow is only a distant impression)
        const mx = Math.max(m.sources[o + 2], m.sources[o + 3], m.sources[o + 4], 1e-3);
        fs.set([x, hf.heightAt(x, z) + 7, z, m.sources[o + 2] / mx * 0.7, m.sources[o + 3] / mx * 0.7, m.sources[o + 4] / mx * 0.7, (i * 0.618) % 1, 3], i * 8);
      }
      this.farFest.setData(fs);
      const ls = new Float32Array((m.lamps.length / 3) * 8);
      for (let i = 0, n = m.lamps.length / 3; i < n; i++) {
        const x = m.lamps[i * 3], z = m.lamps[i * 3 + 1];
        ls.set([x, hf.heightAt(x, z) + LAMP_HEIGHT, z, 1.0, 0.66, 0.34, (i * 0.618) % 1, 4], i * 8);
      }
      this.farLamps.setData(ls);
    }
    this.stats.layout = m.stats;
    this._gridKey = '';
    if (this.kitesOn && !this.kites) this._makeKites(this._cam || { x: 0, z: 0 });
  }

  /** festival outline lights on the modelled Hawa Mahal (bulbs along every storey's top edge, diyas on the plinth), transformed by the model's world matrix */
  _withLandmarkBulbs(bulbs) {
    const g = this.landmarks && this.landmarks.items && this.landmarks.items.hawaMahal;
    if (!g) return bulbs;
    g.updateMatrixWorld(true);
    const { bulbs: b, diyas: d } = hawaOutline();
    const out = new Float32Array(bulbs.length + (b.length + d.length) * 8);
    out.set(bulbs);
    let o = bulbs.length;
    const v = new THREE.Vector3();
    const put = (p, col, kind, k) => { v.set(p[0], p[1], p[2]).applyMatrix4(g.matrixWorld); out.set([v.x, v.y, v.z, col[0], col[1], col[2], (k * 0.618) % 1, kind], o); o += 8; };
    b.forEach((p, i) => put(p, i % 3 ? [1.0, 0.66, 0.2] : [1.0, 0.8, 0.4], 1, i));
    d.forEach((p, i) => put(p, [1.0, 0.5, 0.1], 2, i));
    return out;
  }

  /** set the festival mode */
  setMode(mode, app) {
    if (!FESTIVAL_MODES.includes(mode)) return;
    this.mode = mode;
    this.target = mode === 'diwali' ? 1 : 0;
    this.setKites(mode === 'sankranti', app);
    if (mode !== 'diwali') this.fireworks.clear();
  }

  _makeKites(cam) {
    const n = this.s.kites;
    if (!n) return;
    this.kites = new KiteSim({ count: n, seed: 20270114, groundAt: (x, z) => this.hf.heightAt(x, z), roofs: this.layout ? this.layout.roofs : null });
    this.kiteRender = new KiteRenderer({ sim: this.kites });
    this.group.add(this.kiteRender.group);
    this.kites.reset(cam.x, cam.z, 6);
    this.kiteRender.beforeStep();
  }

  setKites(on, app) {
    this.kitesOn = !!on;
    if (!on) { if (this.kiteRender) this.kiteRender.group.visible = false; return; }
    const cam = app ? app.camera.position : this._cam || { x: 0, z: 0 };
    if (!this.kites) { if (this.layout || !this.manifest) this._makeKites(cam); }
    else this.kites.reset(cam.x, cam.z, 6);
  }

  /** fixed step: kite physics */
  update(dt, app) {
    this._cam = app.camera.position;
    if (this.kitesOn && this.kites) {
      const w = app.weather.s;
      this.kites.setWind(Math.sin(w.windDir) * w.windSpeed, Math.cos(w.windDir) * w.windSpeed);
      this.kiteRender.beforeStep();
      this.kites.step(dt, app.camera.position.x, app.camera.position.z);
    }
  }

  /** per rendered frame */
  frame(dt, alpha, app) {
    const env = app.env, cam = app.camera;
    this._cam = cam.position;
    const sunAlt = env.sunAlt;
    // after dark: lamps and landmark floodlights come on around sunset; the festival bulbs a little later so they read against the dusk sky
    this.lampK = smooth(2.0, -3.0, sunAlt);
    this.landK = smooth(1.0, -3.5, sunAlt);
    const dark = smooth(3.0, -5.0, sunAlt);
    this.strength += (this.target - this.strength) * (1 - Math.exp(-Math.min(dt, 0.1) / 1.6));
    if (Math.abs(this.strength - this.target) < 0.002) this.strength = this.target;
    this.fl = this.strength * dark;
    ENV.uFestival.value = this.strength * dark;
    const vw = app.renderer.domElement.width, vh = app.renderer.domElement.height;
    const cx = cam.position.x, cz = cam.position.z;

    if (this.layout) {
      this.glow.gather(cx, cz);
      this.lampLayer.gather(cx, cz);
      this.wires.gather(cx, cz);
    }
    this.glow.setState(this.fl, vw, vh);
    if (this.farFest) {
      if (this.layout) { this.farFest.gather(cx, cz); this.farLamps.gather(cx, cz); }
      this.farFest.setState(this.fl, vw, vh);
      this.farLamps.setState(this.lampK, vw, vh);
    }
    this.lampLayer.setNight(this.lampK);
    this.wires.mesh.visible = this.strength > 0.05 && this.wires.count > 0;
    this.stats.bulbs = this.glow.count; this.stats.lamps = this.lampLayer.count; this.stats.wires = this.wires.count;

    // floodlit landmarks (hero material term)
    const lf = this.landK * (1 + 0.5 * this.strength);
    LANDMARK_LIGHT.uLandLit.value.set(1.0 * lf, 0.58 * lf, 0.28 * lf).multiplyScalar(0.8);

    // fireworks (Diwali): a show after dark, placed around the view
    const fw = this.fireworks;
    fw.setViewport(vw, vh);
    fw.update(Math.min(dt, 0.1), app.clock.hours, this.mode === 'diwali' ? this.strength * smooth(-2, -8, sunAlt) : 0, cam);
    this.stats.bursts = fw.bursts.length;

    if (this.kitesOn && this.kites) { this.kiteRender.frame(alpha, cam, vw, vh); this.stats.kites = this.kiteRender.active; }
    else if (this.kiteRender) this.kiteRender.group.visible = false;

    this._updateGrid(dt);
  }

  _updateGrid(dt) {
    const g = this.grid, cam = this._cam;
    if (!cam) return;
    const fw = this.fireworks;
    const want = this.lampK > 0.02 || this.fl > 0.02 || this.landK > 0.02 || fw.bursts.length > 0;
    if (!want) { if (g.enabled) g.disable(); this._gridKey = ''; return; }
    let dirty = false;
    if (g.needsRecentre(cam.x, cam.z)) { g.recentre(cam.x, cam.z); dirty = true; }
    this._gridAge += dt;
    const key = `${Math.round(this.lampK * 30)}|${Math.round(this.fl * 30)}|${Math.round(this.landK * 30)}|${this.layout ? 1 : 0}`;
    if (key !== this._gridKey) { this._gridKey = key; dirty = true; }
    if (fw.bursts.length && this._gridAge > 0.05) dirty = true;
    if (!dirty && g.enabled) return;
    const t0 = performance.now();
    g.clear();
    const half = g.half * 1.1, tmp = this._tmp;
    if (this.layout && this.lampK > 0.02) {
      const bins = this.lampLayer.bins, d = this.lampLayer.data, k = this.lampK * 0.34;
      bins.within(g.cx, g.cz, half, tmp);
      for (let i = 0; i < tmp.length; i++) { const o = tmp[i] * 3; g.splat(d[o], d[o + 1], LAMP_COL[0] * k, LAMP_COL[1] * k, LAMP_COL[2] * k, 14); }
    }
    if (this.layout && this.fl > 0.02 && this.sourceBins) {
      const d = this.layout.sources;
      this.sourceBins.within(g.cx, g.cz, half, tmp);
      for (let i = 0; i < tmp.length; i++) {
        const o = tmp[i] * 7, gk = this.fl * KIND_GAIN[d[o + 6] | 0];
        g.splat(d[o], d[o + 1], d[o + 2] * gk, d[o + 3] * gk, d[o + 4] * gk, d[o + 5]);
      }
    }
    if (this.landK > 0.02) {
      const d = this.landSrc, k = this.landK * (1 + 0.5 * this.strength) * 0.15;
      for (let o = 0; o < d.length; o += 7) if (Math.abs(d[o] - g.cx) < half + d[o + 5] && Math.abs(d[o + 1] - g.cz) < half + d[o + 5]) g.splat(d[o], d[o + 1], d[o + 2] * k, d[o + 3] * k, d[o + 4] * k, d[o + 5]);
    }
    if (fw.bursts.length) for (const s of fw.lightSources(this._fwSrc)) g.splat(s.x, s.z, s.r * 0.9, s.g * 0.9, s.b * 0.9, s.R); // a burst visibly lights the streets for a moment
    g.upload();
    this._gridAge = 0;
    this.stats.gridMs = performance.now() - t0;
  }

  /** a camera standing on the roof of flyer i (or the nearest flying kite to the camera) looking up along the string at the kite: { pos, look } */
  flyerView(i = -1) {
    const s = this.kites;
    if (!s) return null;
    if (i < 0) {
      let best = 1e18;
      const c = this._cam || { x: 0, z: 0 };
      for (let k = 0; k < s.n; k++) {
        if (s.state[k] !== 0 || s.pay[k] < s.len[k] * 0.8) continue;
        const d = Math.hypot(s.anchor[k * 3] - c.x, s.anchor[k * 3 + 2] - c.z);
        if (d < best) { best = d; i = k; }
      }
      if (i < 0) return null;
    }
    const ax = s.anchor[i * 3], ay = s.anchor[i * 3 + 1], az = s.anchor[i * 3 + 2];
    return { pos: [ax, ay + 0.6, az], look: [s.kp[i * 3], s.kp[i * 3 + 1], s.kp[i * 3 + 2]], index: i };
  }

  /** harness: make the layout available, then run the fixed step n times (kites settle) */
  async settle(app, kiteSeconds = 0) {
    await this.ready;
    this._cam = app.camera.position;
    if (this.kitesOn && !this.kites) this._makeKites(app.camera.position);
    for (let i = 0; i < kiteSeconds * 30; i++) this.update(1 / 30, app);
  }
}
