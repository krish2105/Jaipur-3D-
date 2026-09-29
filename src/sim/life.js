// Street life on the main thread: owns the simulation worker, the instanced meshes and the per-frame culling / interpolation.
//  * lockstep with the fixed simulation update: each fixed step posts (at most 2 in flight, the rest is merged into the next message)
//  * between worker snapshots agents are dead-reckoned along their heading, so 30 Hz simulation looks smooth at any frame rate
//  * instanced draws are not culled per instance by the GPU, so agents are culled here against the camera frustum and a per-kind
//    draw radius; only visible agents are written (this is what keeps the triangle budget honest)
import * as THREE from 'three';
import { createAgentMaterial } from './agentMaterial.js';
import { buildBike, buildCar, buildAuto, buildBus, buildPerson, buildCow, buildPigeon } from './agentGeometry.js';
import { TYPES } from './traffic.js';
import TrafficWorker from './trafficWorker.js?worker';

// palettes: linear reflectance values (vertex colours are linear in the shader)
const CAR_PAL = [[0.72, 0.72, 0.7], [0.55, 0.56, 0.58], [0.85, 0.85, 0.84], [0.12, 0.12, 0.14], [0.5, 0.05, 0.05], [0.05, 0.1, 0.3], [0.62, 0.6, 0.55], [0.7, 0.66, 0.5], [0.08, 0.2, 0.12]];
const BIKE_PAL = [[0.6, 0.05, 0.05], [0.04, 0.05, 0.12], [0.08, 0.08, 0.09], [0.55, 0.55, 0.5], [0.05, 0.25, 0.4], [0.7, 0.35, 0.05]];
const AUTO_PAL = [[0.95, 0.72, 0.04], [0.06, 0.45, 0.14], [0.95, 0.72, 0.04], [0.9, 0.62, 0.05]];
const BUS_PAL = [[0.7, 0.28, 0.04], [0.05, 0.3, 0.55], [0.6, 0.6, 0.58], [0.1, 0.4, 0.2]];
const MAN_PAL = [[0.72, 0.7, 0.62], [0.55, 0.62, 0.72], [0.4, 0.4, 0.42], [0.35, 0.08, 0.06], [0.28, 0.32, 0.18], [0.75, 0.68, 0.45], [0.12, 0.14, 0.2], [0.65, 0.35, 0.2]];
const WOMAN_PAL = [[0.8, 0.05, 0.08], [0.85, 0.1, 0.4], [0.9, 0.42, 0.04], [0.92, 0.72, 0.05], [0.06, 0.5, 0.2], [0.08, 0.2, 0.7], [0.4, 0.08, 0.5], [0.05, 0.4, 0.45], [0.9, 0.9, 0.85]];
const TURBAN_PAL = [[0.95, 0.5, 0.05], [0.85, 0.06, 0.08], [0.9, 0.2, 0.5], [0.95, 0.75, 0.05], [0.9, 0.9, 0.85], [0.12, 0.55, 0.2]];
const COW_PAL = [[0.85, 0.83, 0.78], [0.4, 0.26, 0.15], [0.12, 0.1, 0.09]];
const pick = (pal, b) => pal[b % pal.length];

function makeKind(geometry, cap, mat, { castShadow = false, name }) {
  const g = geometry.clone();
  g.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.InstancedMesh(g, mat, cap);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return { mesh, cap, k: 0, colors: g.getAttribute('aColor'), anim: g.getAttribute('aAnim') };
}

export class Life {
  /**
   * @param {object} o { scene, settings, hf, lighting, manifest, base }
   */
  constructor(o) {
    this.scene = o.scene;
    this.settings = o.settings;
    this.hf = o.hf;
    this.manifest = o.manifest;
    this.base = o.base;
    const s = o.settings;
    this.group = new THREE.Group();
    this.group.name = 'life';
    this.caps = { vehicles: s.vehicles, peds: s.pedestrians, cows: s.animals, birds: s.birds };
    this.draw = { veh: Math.min(s.tileRadius, 950), ped: s.tileRadius > 1000 ? 420 : s.tileRadius > 700 ? 330 : 230, cow: 450, bird: 900 };
    const shadowVeh = s.shadowCascades > 0 && s.tileRadius >= 900;
    const M = (mode, key, r = 0.75, m = 0.05) => { const mat = createAgentMaterial({ mode, key, roughness: r, metalness: m }); o.lighting?.setupMaterial(mat); return mat; };
    const vmat = M(0, 'veh', 0.45, 0.25), pmat = M(1, 'ped', 0.85, 0), cmat = M(2, 'cow', 0.85, 0), bmat = M(3, 'bird', 0.9, 0);
    const vcap = (i) => Math.ceil(this.caps.vehicles * TYPES[i].share * 1.7) + 12;
    this.veh = [buildBike, buildCar, buildAuto, buildBus].map((build, i) => makeKind(build(), vcap(i), vmat, { castShadow: shadowVeh, name: 'veh-' + TYPES[i].name }));
    const pc = this.caps.peds;
    this.man = makeKind(buildPerson('man'), Math.ceil(pc * 0.75), pmat, { name: 'ped-man' });
    this.woman = makeKind(buildPerson('woman'), Math.ceil(pc * 0.55), pmat, { name: 'ped-woman' });
    this.turban = makeKind(buildPerson('turban'), Math.ceil(pc * 0.45), pmat, { name: 'ped-turban' });
    this.cow = makeKind(buildCow(), Math.max(4, this.caps.cows), cmat, { castShadow: shadowVeh, name: 'cows' });
    this.bird = makeKind(buildPigeon(), Math.max(4, this.caps.birds), bmat, { name: 'pigeons' });
    for (const k of [...this.veh, this.man, this.woman, this.turban, this.cow, this.bird]) this.group.add(k.mesh);
    this.scene.add(this.group);

    this.worker = null;
    this.ready = null;
    this.snap = null;
    this.snapT = 0;
    this.inflight = 0;
    this.pendingSteps = 0;
    this.speedScale = 1;
    this.enabled = true;      // UI: street life on / off
    this.densityScale = 1;    // UI: Light 0.4 / Normal 1 / Busy 1.6
    this.error = null;
    this.stats = { veh: 0, ped: 0, cow: 0, bird: 0, worker: null };
    this._fr = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
    this._waiters = new Map();
    this._tag = 0;
  }

  _hotspots() {
    const m = this.manifest, out = [];
    const add = (key, r, w) => { const l = m?.landmarks?.[key]?.[0]; if (l) out.push({ x: l.x, z: l.z, r, w }); };
    add('badiChaupar', 240, 6); add('chhotiChaupar', 170, 4); add('hawaMahal', 150, 5); add('johariBazaar', 130, 4);
    add('jantarMantar', 130, 3); add('cityPalace', 190, 3); add('tripolia', 110, 3); add('jamaMasjid', 100, 3); add('albertHall', 160, 3);
    const s = m?.sites?.hawaMahal; if (s) out.push({ x: s.node.x, z: s.node.z, r: 150, w: 5 });
    const j = m?.sites?.jantarMantar; if (j) out.push({ x: j.node.x, z: j.node.z, r: 130, w: 3 });
    if (!out.length) out.push({ x: 0, z: 100, r: 250, w: 5 });
    return out;
  }

  _cam(camera) {
    const d = camera.getWorldDirection(new THREE.Vector3());
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z, fx: d.x, fy: d.y, fz: d.z, fov: camera.fov, aspect: camera.aspect };
  }

  /** start the worker; resolves when the street graph is loaded and the population seeded */
  init(app) {
    const s = this.settings;
    this.worker = new TrafficWorker();
    const sm = this.hf.sampler;
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { this.stats.worker = m.boot; }
        else if (m.type === 'error') { this.error = m.error; console.warn('street life unavailable:', m.error); resolve(false); }
        else if (m.type === 'snap') {
          this.snap = m; this.snapT = performance.now(); this.inflight = Math.max(0, this.inflight - 1);
          if (m.tag === 'init') resolve(true);
          const w = this._waiters.get(m.tag);
          if (w) { this._waiters.delete(m.tag); w(); }
        }
      };
    });
    this.worker.postMessage({
      type: 'init', graphUrl: new URL(`${this.base}data/osm/graph.json`, location.href).href, seed: 20260929,
      vehicles: this.caps.vehicles, pedestrians: this.caps.peds, cows: this.caps.cows, birds: this.caps.birds,
      simRadius: Math.min(s.tileRadius * 1.15, 1600), pedRadius: this.draw.ped * 1.7, hotspots: this._hotspots(),
      hour: app.clock.hours, cam: this._cam(app.camera),
      near: sm?.near, nearN: sm?.nearN, nearHalf: sm?.nearHalf, far: sm?.far, farN: sm?.farN, farHalf: sm?.farHalf,
    });
    return this.ready;
  }

  /** the population around a new camera position (after a cut / teleport) */
  teleport(app) {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'reseed', hour: app.clock.hours, cam: this._cam(app.camera) });
  }

  /** fixed-step hook: ask the worker for the next steps */
  /** UI density: 0 switches street life off (nothing simulated or drawn), otherwise a multiplier on the time-of-day density */
  setDensity(v) {
    if (v <= 0) { this.enabled = false; return; }
    this.enabled = true;
    this.densityScale = v;
  }

  update(dt, app) {
    if (!this.worker || this.error || !this.enabled) return;
    const c = app.clock;
    if (!c.paused) this.pendingSteps += Math.max(1, Math.min(4, Math.round(c.speed)));
    this.speedScale = Math.max(1, Math.min(4, Math.round(c.speed)));
    if (this.inflight >= 2 || this.pendingSteps <= 0) return;
    const w = app.weather.s;
    const density = Math.max(0.15, 1 - 0.55 * Math.min(1, w.rain * 1.2) - 0.4 * w.dust * w.storm) * this.densityScale;
    this.worker.postMessage({ type: 'step', n: Math.min(6, this.pendingSteps), hour: c.hours, cam: this._cam(app.camera), density, tag: 'live' });
    this.pendingSteps = Math.max(0, this.pendingSteps - 6);
    this.inflight++;
  }

  /** advance the street life by n fixed steps and wait for the result (deterministic stills / tests) */
  run(app, n = 90) {
    if (!this.worker) return Promise.resolve();
    const tag = 'run' + ++this._tag;
    return new Promise((resolve) => {
      this._waiters.set(tag, resolve);
      this.inflight++;
      this.worker.postMessage({ type: 'step', n, hour: app.clock.hours, cam: this._cam(app.camera), density: 1, tag });
    });
  }

  _inFrustum(x, y, z, r) {
    const p = this._fr.planes;
    for (let i = 0; i < 6; i++) if (p[i].normal.x * x + p[i].normal.y * y + p[i].normal.z * z + p[i].constant < -r) return false;
    return true;
  }

  /** per rendered frame: dead-reckon, cull, write instance data */
  frame(dt, app) {
    const snap = this.snap;
    if (!snap) return;
    if (!this.enabled) {
      for (const k of [...this.veh, this.man, this.woman, this.turban, this.cow, this.bird]) { k.k = 0; k.mesh.count = 0; k.mesh.visible = false; }
      this.stats.veh = this.stats.ped = this.stats.cow = this.stats.bird = 0;
      return;
    }
    const cam = app.camera;
    this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._fr.setFromProjectionMatrix(this._pm);
    const cx = cam.position.x, cz = cam.position.z;
    const age = Math.min(0.2, (performance.now() - this.snapT) / 1000) * this.speedScale;
    for (const k of [...this.veh, this.man, this.woman, this.turban, this.cow, this.bird]) k.k = 0;

    const put = (kind, x, y, z, yaw, sc, col, a0, a1, a2) => {
      if (kind.k >= kind.cap) return;
      const i = kind.k++;
      const c = Math.cos(yaw) * sc, s = Math.sin(yaw) * sc, e = kind.mesh.instanceMatrix.array, o = i * 16;
      e[o] = c; e[o + 1] = 0; e[o + 2] = -s; e[o + 3] = 0; e[o + 4] = 0; e[o + 5] = sc; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = s; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0; e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
      const ca = kind.colors.array; ca[i * 3] = col[0]; ca[i * 3 + 1] = col[1]; ca[i * 3 + 2] = col[2];
      const an = kind.anim.array; an[i * 4] = a0; an[i * 4 + 1] = a1; an[i * 4 + 2] = a2; an[i * 4 + 3] = 0;
    };

    // vehicles
    const v = snap.veh, R2v = this.draw.veh * this.draw.veh;
    for (let i = 0; i < snap.nv; i++) {
      const o = i * 8;
      const yaw = v[o + 3], sp = v[o + 6];
      const x = v[o] + Math.sin(yaw) * sp * age, z = v[o + 2] + Math.cos(yaw) * sp * age;
      const dx = x - cx, dz = z - cz;
      const type = v[o + 4];
      if (dx * dx + dz * dz > R2v) continue;
      const y = v[o + 1];
      if (!this._inFrustum(x, y + 1, z, type === 3 ? 7 : 3)) continue;
      const pal = type === 0 ? BIKE_PAL : type === 1 ? CAR_PAL : type === 2 ? AUTO_PAL : BUS_PAL;
      put(this.veh[type], x, y, z, yaw, 1, pick(pal, v[o + 5] | 0), 0, 0, v[o + 7]);
    }
    // pedestrians
    const p = snap.ped, R2p = this.draw.ped * this.draw.ped;
    for (let i = 0; i < snap.np; i++) {
      const o = i * 8;
      const yaw = p[o + 3], sp = p[o + 6];
      const x = p[o] + Math.sin(yaw) * sp * age, z = p[o + 2] + Math.cos(yaw) * sp * age;
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > R2p) continue;
      const y = p[o + 1];
      if (!this._inFrustum(x, y + 0.9, z, 1.2)) continue;
      const kind = p[o + 7] | 0, phase = p[o + 4] + sp * age * 3.2, b = p[o + 5] | 0;
      if (kind === 1) put(this.woman, x, y, z, yaw, 1, pick(WOMAN_PAL, b), phase, sp, 0);
      else if (kind === 2) put(this.turban, x, y, z, yaw, 1, pick(TURBAN_PAL, b), phase, sp, 0);
      else put(this.man, x, y, z, yaw, kind === 3 ? 0.62 : 0.95 + (b % 7) * 0.02, pick(MAN_PAL, b), phase, sp * (kind === 3 ? 1.2 : 1), 0);
    }
    // cows
    const cw = snap.cow, R2c = this.draw.cow * this.draw.cow;
    for (let i = 0; i < snap.nc; i++) {
      const o = i * 6, x = cw[o], z = cw[o + 2], dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > R2c || !this._inFrustum(x, cw[o + 1] + 0.7, z, 2)) continue;
      put(this.cow, x, cw[o + 1], z, cw[o + 3], 1, pick(COW_PAL, cw[o + 5] | 0), 0, 0, cw[o + 4]);
    }
    // pigeons
    const bd = snap.bird, R2b = this.draw.bird * this.draw.bird;
    for (let i = 0; i < snap.nb; i++) {
      const o = i * 6, x = bd[o], z = bd[o + 2], dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > R2b || !this._inFrustum(x, bd[o + 1], z, 0.6)) continue;
      put(this.bird, x, bd[o + 1], z, bd[o + 3], 1, [1, 1, 1], bd[o + 4], 0, bd[o + 5]);
    }
    let vis = 0;
    const flush = (kind) => {
      const m = kind.mesh;
      m.count = kind.k;
      if (kind.k) {
        m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, kind.k * 16); m.instanceMatrix.needsUpdate = true;
        kind.colors.clearUpdateRanges(); kind.colors.addUpdateRange(0, kind.k * 3); kind.colors.needsUpdate = true;
        kind.anim.clearUpdateRanges(); kind.anim.addUpdateRange(0, kind.k * 4); kind.anim.needsUpdate = true;
      }
      m.visible = kind.k > 0;
      return kind.k;
    };
    for (const k of this.veh) vis += flush(k);
    this.stats.veh = vis;
    this.stats.ped = flush(this.man) + flush(this.woman) + flush(this.turban);
    this.stats.cow = flush(this.cow);
    this.stats.bird = flush(this.bird);
  }
}
