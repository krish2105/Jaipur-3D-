// Street-life simulation on the baked OSM street graph: vehicles (IDM car following, node locks, routing), pedestrians (crowd
// random walk weighted toward bazaars and monuments), cows (slow, resting in the road) and pigeon flocks (perch / circle / flush).
//
//  * pure JS, fixed timestep, seeded RNG: runs identically in a Web Worker, in node tests and in the harness
//  * agents live in structure-of-arrays typed arrays; the render side reads packed snapshots
//  * agents are only ever SPAWNED where the camera cannot see (outside a generous view cone, never right next to the lens) and are
//    recycled when they fall far behind; the population target follows the time of day
//  * traffic keeps LEFT (India). Vehicles are single-lane per direction with a per-type lateral offset; conflicts at junctions are
//    resolved by node locks (one approach at a time, platoons of the same approach pass together, signals alternate axes) with a
//    wait timeout so a jam can never become a permanent deadlock
import { mulberry32 } from '../core/rng.js';
import { idmAccel } from './idm.js';

export const VTYPE = { BIKE: 0, CAR: 1, AUTO: 2, BUS: 3 };
export const TYPES = [
  { name: 'bike', len: 1.9, vmax: 15, share: 0.46, T: 0.7, s0: 1.0, aMax: 2.4, b: 3.0, latMin: -0.7, latMax: 0.5 },
  { name: 'car', len: 4.2, vmax: 15, share: 0.27, T: 1.1, s0: 1.6, aMax: 1.6, b: 2.6, latMin: 0.9, latMax: 1.4 },
  { name: 'auto', len: 2.8, vmax: 11, share: 0.19, T: 0.9, s0: 1.3, aMax: 1.3, b: 2.6, latMin: 0.8, latMax: 1.3 },
  { name: 'bus', len: 9.5, vmax: 12, share: 0.08, T: 1.4, s0: 2.2, aMax: 1.0, b: 2.2, latMin: 1.1, latMax: 1.5 },
];
const CUM_SHARE = (() => { let c = 0; return TYPES.map((t) => (c += t.share)); })();

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** fraction of the maximum vehicle population on the road at IST hour h (0..24): near-empty at night, morning rush, a small lunchtime dip, evening peak, late fade */
export function vehicleDensity(h) {
  const day = smooth(5.5, 9.0, h) * (1 - smooth(21.0, 24.0, h));
  const lunch = 1 - 0.18 * Math.exp(-Math.pow((h - 14) / 1.6, 2));
  const evening = 1 + 0.0 * h;
  return Math.max(0.12, Math.min(1, 0.14 + 0.86 * day * lunch * evening));
}
/** pedestrians: two peaks (late morning, early evening bazaar), shops shut late, streets empty after midnight */
export function pedDensity(h) {
  const a = Math.exp(-Math.pow((h - 11.3) / 2.6, 2));
  const b = Math.exp(-Math.pow((h - 18.6) / 2.4, 2));
  return Math.max(0.05, Math.min(1, 0.12 + 0.9 * Math.max(a, b)));
}

export const CAM_DEFAULT = { x: 0, y: 30, z: 0, fx: 0, fy: 0, fz: -1, fov: 60, aspect: 1.78 };

export class TrafficSim {
  /**
   * @param {import('./graph.js').StreetGraph} graph
   * @param {object} o { seed, vehicles, pedestrians, cows, birds, heightAt, hotspots:[{x,z,r,w}], simRadius, pedRadius }
   */
  constructor(graph, o = {}) {
    this.g = graph;
    this.rng = mulberry32(o.seed ?? 20260929);
    this.heightAt = o.heightAt || (() => 0);
    this.capV = o.vehicles ?? 300;
    this.capP = o.pedestrians ?? 400;
    this.capC = o.cows ?? 20;
    this.capB = o.birds ?? 60;
    this.simRadius = o.simRadius ?? 1500;
    this.pedRadius = o.pedRadius ?? 650;
    this.time = 0;
    this.hour = 12;
    this.densityScale = 1;
    this.cam = { ...CAM_DEFAULT };
    this._pt = { x: 0, z: 0, dx: 0, dz: 0 };
    this._pt2 = { x: 0, z: 0, dx: 0, dz: 0 };

    // hotspot weights for crowds (Badi Chaupar, bazaars, monuments)
    this.hotspots = o.hotspots || [];
    this.hot = new Float32Array(graph.edgeCount);
    this._buildHot();

    // vehicles
    const V = this.capV;
    this.vAlive = new Uint8Array(V);
    this.vEdge = new Int32Array(V);
    this.vDir = new Uint8Array(V);
    this.vS = new Float32Array(V);
    this.vV = new Float32Array(V);
    this.vLat = new Float32Array(V);
    this.vType = new Uint8Array(V);
    this.vColor = new Uint8Array(V);
    this.vV0f = new Float32Array(V);   // driver's speed factor
    this.vNext = new Int32Array(V).fill(-1); // encoded next (edge*2+dirbit)
    this.vHold = new Int32Array(V).fill(-1); // node whose lock this vehicle holds
    this.vWait = new Float32Array(V);
    this.vAge = new Float32Array(V);
    this.vBrake = new Float32Array(V);
    this.vStill = new Float32Array(V); // seconds motionless
    this.vX = new Float32Array(V);   // world position cache (lateral offset 0) for spacing / recycling tests
    this.vZ = new Float32Array(V);
    this.nV = 0;
    const nn = graph.nodeCount;
    this.lockKey = new Int32Array(nn).fill(-1);
    this.lockCount = new Uint16Array(nn);

    // pedestrians
    const P = this.capP;
    this.pAlive = new Uint8Array(P);
    this.pEdge = new Int32Array(P);
    this.pDir = new Uint8Array(P);
    this.pS = new Float32Array(P);
    this.pV = new Float32Array(P);
    this.pLat = new Float32Array(P);
    this.pColor = new Uint8Array(P);
    this.pKind = new Uint8Array(P);
    this.pPhase = new Float32Array(P);
    this.nP = 0;

    // cows
    const C = this.capC;
    this.cAlive = new Uint8Array(C);
    this.cEdge = new Int32Array(C);
    this.cDir = new Uint8Array(C);
    this.cS = new Float32Array(C);
    this.cV = new Float32Array(C);
    this.cLat = new Float32Array(C);
    this.cRest = new Float32Array(C);
    this.cKind = new Uint8Array(C);

    // pigeon flocks
    this.flocks = [];
    this.bX = new Float32Array(this.capB);
    this.bY = new Float32Array(this.capB);
    this.bZ = new Float32Array(this.capB);
    this.bYaw = new Float32Array(this.capB);
    this.bPhase = new Float32Array(this.capB);
    this.bPerched = new Uint8Array(this.capB);
    this._initFlocks();

    this._order = new Int32Array(V);
    this._cand = [];
    this._stats = { spawned: 0, despawned: 0, forced: 0 };
  }

  // ---------------------------------------------------------------------------------------------------------------
  _rand() { return this.rng(); }

  _buildHot() {
    const g = this.g, pt = this._pt;
    for (let e = 0; e < g.edgeCount; e++) {
      let w = g.bazaar[e] ? 4 : 0;
      if (this.hotspots.length) {
        g.pointAt(e, g.len[e] * 0.5, pt);
        for (const h of this.hotspots) {
          const d = Math.hypot(pt.x - h.x, pt.z - h.z);
          if (d < h.r) w += h.w * (1 - d / h.r);
        }
      }
      this.hot[e] = w;
    }
  }

  _inView(x, y, z, extraMargin = 0) {
    if (this._anywhere) return false; // seeding a fresh scene: agents may appear anywhere, including in view
    const c = this.cam;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 30) return true; // never right next to the lens
    const cos = (dx * c.fx + dy * c.fy + dz * c.fz) / d;
    const halfV = (c.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * c.aspect);
    const half = Math.hypot(halfV, halfH) + (12 * Math.PI) / 180 + extraMargin;
    return cos > Math.cos(Math.min(half, Math.PI * 0.95));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // routing

  /** pick the next (edge*2+dirbit) after travelling `e`/`dir` to its end node; -1 if there is no way on (never for vehicles: U-turn) */
  _chooseNext(e, dir, ped) {
    const g = this.g;
    const n = g.endNode(e, dir);
    const start = ped ? g.pedStart : g.outStart, list = ped ? g.pedList : g.outList;
    const a = start[n], b = start[n + 1];
    if (b === a) return -1;
    const hin = g.headingAt(e, dir, true, this._pt);
    const hdx = hin.dx, hdz = hin.dz;
    let total = 0;
    const w = this._w || (this._w = new Float32Array(16));
    const cnt = Math.min(b - a, 16);
    for (let k = 0; k < cnt; k++) {
      const code = list[a + k];
      const e2 = code >> 1, d2 = code & 1;
      let wt = 0;
      if (e2 === e && d2 !== dir) wt = 0.02; // reverse: only if nothing else
      else {
        const h2 = g.headingAt(e2, d2, false, this._pt2);
        const cosT = hdx * h2.dx + hdz * h2.dz;
        wt = Math.exp(-Math.pow(Math.acos(Math.max(-1, Math.min(1, cosT))), 2) / (2 * 0.95 * 0.95)) + 0.05;
        if (g.name[e2] && g.name[e2] === g.name[e]) wt *= 3;
        if (ped) wt *= 1 + this.hot[e2] * 0.7;
        else wt *= 1 + 0.35 * g.rank[e2] + (g.rank[e2] >= g.rank[e] ? 0.5 : 0);
      }
      w[k] = wt;
      total += wt;
    }
    let r = this._rand() * total;
    for (let k = 0; k < cnt; k++) { r -= w[k]; if (r <= 0) return list[a + k]; }
    return list[a + cnt - 1];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // vehicles

  _vehicleType() {
    const r = this._rand();
    for (let i = 0; i < CUM_SHARE.length; i++) if (r < CUM_SHARE[i]) return i;
    return VTYPE.CAR;
  }

  _spawnVehicle() {
    const g = this.g, c = this.cam;
    let slot = -1;
    for (let i = 0; i < this.capV; i++) if (!this.vAlive[i]) { slot = i; break; }
    if (slot < 0) return false;
    const cand = g.edgesNear(c.x, c.z, this.simRadius, this._cand);
    if (!cand.length) return false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const e = cand[(this._rand() * cand.length) | 0];
      if (!g.car[e]) continue;
      // bigger roads are used more
      if (this._rand() > 0.35 + 0.16 * g.rank[e]) continue;
      const dir = g.oneway[e] ? 0 : (this._rand() < 0.5 ? 0 : 1);
      const s = this._rand() * g.len[e];
      g.place(e, dir, s, 0, this._pt);
      if (this._inView(this._pt.x, this.heightAt(this._pt.x, this._pt.z) + 1, this._pt.z)) continue;
      const dx = this._pt.x - c.x, dz = this._pt.z - c.z;
      if (dx * dx + dz * dz > this.simRadius * this.simRadius) continue;
      // spacing to everything else IN WORLD SPACE (adjacent short roads count, a bus needs more room than a bike)
      let ok = true;
      const px = this._pt.x, pz = this._pt.z;
      for (let j = 0; j < this.capV; j++) {
        if (!this.vAlive[j]) continue;
        const dx2 = this.vX[j] - px, dz2 = this.vZ[j] - pz;
        if (dx2 * dx2 + dz2 * dz2 < 12 * 12) { ok = false; break; }
      }
      if (!ok) continue;
      const type = this._vehicleType();
      const T = TYPES[type];
      this.vAlive[slot] = 1;
      this.vEdge[slot] = e; this.vDir[slot] = dir; this.vS[slot] = s;
      this.vType[slot] = type;
      this.vColor[slot] = (this._rand() * 255) | 0;
      this.vLat[slot] = T.latMin + this._rand() * (T.latMax - T.latMin);
      if (g.oneway[e]) this.vLat[slot] *= 0.5;
      this.vV0f[slot] = 0.8 + this._rand() * 0.4;
      this.vV[slot] = Math.min(this._v0(slot, e), 5 + this._rand() * 4);
      this.vNext[slot] = -1; this.vHold[slot] = -1; this.vWait[slot] = 0; this.vAge[slot] = 0; this.vBrake[slot] = 0;
      this.vX[slot] = this._pt.x; this.vZ[slot] = this._pt.z; this.vStill[slot] = 0;
      this.nV++;
      this._stats.spawned++;
      return true;
    }
    return false;
  }

  _despawnVehicle(i) {
    if (this.vHold[i] >= 0) this._release(i);
    this.vAlive[i] = 0;
    this.nV--;
    this._stats.despawned++;
  }

  _v0(i, e) {
    const T = TYPES[this.vType[i]];
    return Math.min(T.vmax, this.g.speed[e] * 0.9 + 1.5) * this.vV0f[i];
  }

  _release(i) {
    const n = this.vHold[i];
    if (n < 0) return;
    if (this.lockCount[n] > 0) this.lockCount[n]--;
    if (this.lockCount[n] === 0) this.lockKey[n] = -1;
    this.vHold[i] = -1;
  }

  /** try to take the crossing lock of the node ending this vehicle's edge */
  _acquire(i, e, dir, force) {
    const g = this.g;
    const n = g.endNode(e, dir);
    if (this.vHold[i] === n) return true;
    const key = e * 2 + dir;
    if (g.signal[n] && !force) {
      const h = g.headingAt(e, dir, true, this._pt);
      const axis = Math.abs(h.dx) > Math.abs(h.dz) ? 0 : 1;
      if (axis !== (Math.floor(this.time / 22) & 1)) return false; // red
    }
    if (this.lockCount[n] === 0 || this.lockKey[n] === key || force) {
      if (this.lockCount[n] === 0 || force) this.lockKey[n] = key;
      this.lockCount[n]++;
      this.vHold[i] = n;
      return true;
    }
    return false;
  }

  _stepVehicles(dt) {
    const g = this.g, V = this.capV;
    // ordering: by (edge, dir, s) ascending so that leader = next in the same group
    const ord = this._order;
    let n = 0;
    for (let i = 0; i < V; i++) if (this.vAlive[i]) ord[n++] = i;
    const view = ord.subarray(0, n);
    view.sort((a, b) => {
      const ka = this.vEdge[a] * 2 + this.vDir[a], kb = this.vEdge[b] * 2 + this.vDir[b];
      return ka - kb || this.vS[a] - this.vS[b];
    });
    // first vehicle (smallest s) of each (edge, dir) group, for cross-edge leaders
    const first = this._first || (this._first = new Map());
    first.clear();
    const entered = this._entered || (this._entered = new Map()); // road key -> vehicle that entered it during THIS step
    entered.clear();
    for (let k = 0; k < n; k++) {
      const i = ord[k], key = this.vEdge[i] * 2 + this.vDir[i];
      if (!first.has(key)) first.set(key, k);
    }
    for (let k = 0; k < n; k++) {
      const i = ord[k];
      const e = this.vEdge[i], dir = this.vDir[i];
      const key = e * 2 + dir;
      const T = TYPES[this.vType[i]];
      const len = g.len[e];
      const s = this.vS[i], v = this.vV[i];
      const v0 = this._v0(i, e);
      const toEnd = len - s;
      let gap = Infinity, vL = 0;
      // same-road leader
      if (k + 1 < n) {
        const j = ord[k + 1];
        if (this.vEdge[j] * 2 + this.vDir[j] === key) {
          gap = this.vS[j] - s - 0.5 * (TYPES[this.vType[j]].len + T.len);
          vL = this.vV[j];
        }
      }
      // decide the next road early, look at its rearmost vehicle
      if (this.vNext[i] < 0 && toEnd < 70) this.vNext[i] = this._chooseNext(e, dir, false);
      const nx = this.vNext[i];
      if (gap === Infinity && nx >= 0 && toEnd < 90) {
        const kn = first.get(nx);
        if (kn !== undefined) {
          const j = ord[kn];
          gap = toEnd + this.vS[j] - 0.5 * (TYPES[this.vType[j]].len + T.len);
          vL = this.vV[j];
        }
      }
      // node crossing lock / signal: a virtual stopped leader at the stop line
      const stopDist = toEnd - 0.5 * T.len - 1.2 - g.width[e] * 0.35;
      if (toEnd < 16 && this.vHold[i] < 0) {
        const force = this.vWait[i] > 9;
        if (this._acquire(i, e, dir, force)) { if (force) this._stats.forced++; this.vWait[i] = 0; }
      }
      if (this.vHold[i] < 0 && toEnd < 40) {
        if (stopDist < gap) { gap = Math.max(stopDist, 0.05); vL = 0; }
      }
      // cows in the road ahead
      for (let c = 0; c < this.capC; c++) {
        if (!this.cAlive[c] || this.cEdge[c] !== e) continue;
        const cs = this.cDir[c] === dir ? this.cS[c] : len - this.cS[c];
        if (cs > s && cs - s < 40) {
          const cg = cs - s - 1.6 - 0.5 * T.len;
          if (cg < gap) { gap = cg; vL = 0.3; }
        }
      }
      const acc = idmAccel(v, v0, gap, vL, T);
      const nv = Math.max(0, v + acc * dt);
      this.vBrake[i] = acc < -1.2 ? 1 : 0;
      this.vV[i] = nv;
      this.vS[i] = s + 0.5 * (v + nv) * dt;
      this.vWait[i] = nv < 0.3 && this.vHold[i] < 0 && toEnd < 30 ? this.vWait[i] + dt : (nv > 1 ? 0 : this.vWait[i]);
      this.vAge[i] += dt;
      this.vStill[i] = nv < 0.05 ? this.vStill[i] + dt : 0;
      // cross the end of the road
      if (this.vS[i] >= len) {
        let next = this.vNext[i];
        if (next < 0) next = this._chooseNext(e, dir, false);
        if (next < 0) { this._despawnVehicle(i); continue; }
        // never enter a road onto a vehicle that has not cleared its start (hard block; the IDM gap normally prevents this)
        const kn2 = first.get(next);
        let blocked = false;
        if (kn2 !== undefined) {
          const j = ord[kn2];
          if (j !== i && this.vS[j] - (this.vS[i] - len) - 0.5 * (TYPES[this.vType[j]].len + T.len) < 0.3) blocked = true;
        }
        const ej = entered.get(next);
        if (!blocked && ej !== undefined && this.vS[ej] - (this.vS[i] - len) - 0.5 * (TYPES[this.vType[ej]].len + T.len) < 0.3) blocked = true;
        if (blocked) { this.vS[i] = len - 0.02; this.vV[i] = 0; this.vNext[i] = next; continue; }
        this.vEdge[i] = next >> 1; this.vDir[i] = next & 1;
        this.vS[i] -= len;
        entered.set(next, i);
        this.vNext[i] = -1;
        if (g.oneway[this.vEdge[i]] && T.latMin > 0) this.vLat[i] = Math.min(this.vLat[i], 0.8);
      }
      g.place(this.vEdge[i], this.vDir[i], this.vS[i], 0, this._pt);
      this.vX[i] = this._pt.x; this.vZ[i] = this._pt.z;
      // release the lock once well into the next road
      if (this.vHold[i] >= 0 && g.startNode(this.vEdge[i], this.vDir[i]) === this.vHold[i] && this.vS[i] > 5 + 0.5 * T.len) this._release(i);
    }
  }

  _manageVehicles(dt) {
    const c = this.cam, R2 = this.simRadius * this.simRadius * 1.5 * 1.5;
    const target = Math.round(this.capV * vehicleDensity(this.hour) * this.densityScale);
    // recycle: far behind the camera (or stuck for very long) and not visible
    for (let i = 0; i < this.capV; i++) {
      if (!this.vAlive[i]) continue;
      this.g.place(this.vEdge[i], this.vDir[i], this.vS[i], 0, this._pt);
      const dx = this._pt.x - c.x, dz = this._pt.z - c.z;
      const far = dx * dx + dz * dz > R2;
      const surplus = this.nV > target;
      const stuck = this.vStill[i] > 45; // motionless for ages (jam / sleeping cow / rare overlap): recycle it where nobody can see
      if ((far || stuck || (surplus && this.vAge[i] > 5)) && !this._inView(this._pt.x, this.heightAt(this._pt.x, this._pt.z) + 1, this._pt.z, -0.05)) this._despawnVehicle(i);
    }
    let tries = 0;
    while (this.nV < target && tries < 8) { if (!this._spawnVehicle()) tries += 2; tries++; }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // pedestrians

  _spawnPed() {
    const g = this.g, c = this.cam;
    let slot = -1;
    for (let i = 0; i < this.capP; i++) if (!this.pAlive[i]) { slot = i; break; }
    if (slot < 0) return false;
    const cand = g.edgesNear(c.x, c.z, this.pedRadius, this._cand);
    if (!cand.length) return false;
    for (let attempt = 0; attempt < 14; attempt++) {
      const e = cand[(this._rand() * cand.length) | 0];
      if (g.rank[e] >= 5) continue;
      // crowds concentrate where the hot weight is high
      if (this._rand() > (0.04 + this.hot[e] * 0.3) / (1 + this.hot[e] * 0.3)) continue;
      const dir = this._rand() < 0.5 ? 0 : 1;
      const s = this._rand() * g.len[e];
      g.place(e, dir, s, 0, this._pt);
      if (this._inView(this._pt.x, this.heightAt(this._pt.x, this._pt.z) + 1.5, this._pt.z)) continue;
      const dx = this._pt.x - c.x, dz = this._pt.z - c.z;
      if (dx * dx + dz * dz > this.pedRadius * this.pedRadius) continue;
      this.pAlive[slot] = 1;
      this.pEdge[slot] = e; this.pDir[slot] = dir; this.pS[slot] = s;
      this.pV[slot] = 0.9 + this._rand() * 0.7;
      const half = g.car[e] ? g.width[e] * 0.5 + 0.7 : 0.4 + this._rand() * 1.6;
      this.pLat[slot] = (this._rand() < 0.5 ? -1 : 1) * (g.car[e] ? half : half * 0.5 * (this._rand() < 0.5 ? -1 : 1));
      this.pColor[slot] = (this._rand() * 255) | 0;
      this.pKind[slot] = (this._rand() * 4) | 0;
      this.pPhase[slot] = this._rand() * 6.283;
      this.nP++;
      return true;
    }
    return false;
  }

  _stepPeds(dt) {
    const g = this.g;
    for (let i = 0; i < this.capP; i++) {
      if (!this.pAlive[i]) continue;
      const e = this.pEdge[i];
      const crowd = 1 / (1 + this.hot[e] * 0.06);
      this.pS[i] += this.pV[i] * crowd * dt;
      this.pPhase[i] += this.pV[i] * dt * 3.2;
      if (this.pS[i] >= g.len[e]) {
        const next = this._chooseNext(e, this.pDir[i], true);
        if (next < 0) { this.pAlive[i] = 0; this.nP--; continue; }
        this.pS[i] -= g.len[e];
        this.pEdge[i] = next >> 1; this.pDir[i] = next & 1;
        if (this.pS[i] > g.len[this.pEdge[i]]) this.pS[i] = 0;
      }
    }
  }

  _managePeds() {
    const c = this.cam, R2 = this.pedRadius * this.pedRadius * 1.4;
    const target = Math.round(this.capP * pedDensity(this.hour) * this.densityScale);
    for (let i = 0; i < this.capP; i++) {
      if (!this.pAlive[i]) continue;
      this.g.place(this.pEdge[i], this.pDir[i], this.pS[i], 0, this._pt);
      const dx = this._pt.x - c.x, dz = this._pt.z - c.z;
      const far = dx * dx + dz * dz > R2;
      if ((far || this.nP > target * 1.02) && !this._inView(this._pt.x, this.heightAt(this._pt.x, this._pt.z) + 1.5, this._pt.z, -0.05)) { this.pAlive[i] = 0; this.nP--; }
    }
    let tries = 0;
    while (this.nP < target && tries < 24) { if (!this._spawnPed()) tries += 3; tries++; }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // cows

  _stepCows(dt) {
    const g = this.g;
    for (let i = 0; i < this.capC; i++) {
      if (!this.cAlive[i]) continue;
      this.cRest[i] -= dt;
      if (this.cRest[i] > 0) { this.cV[i] = 0; continue; }
      if (this.cRest[i] < -25 - (i % 7) * 4) this.cRest[i] = 30 + this._rand() * 120; // walk a while, then lie in the road again
      this.cV[i] = 0.35;
      this.cS[i] += this.cV[i] * dt;
      const e = this.cEdge[i];
      if (this.cS[i] >= g.len[e]) {
        const next = this._chooseNext(e, this.cDir[i], true);
        if (next < 0) { this.cDir[i] ^= 1; this.cS[i] = 0; continue; }
        this.cS[i] -= g.len[e];
        this.cEdge[i] = next >> 1; this.cDir[i] = next & 1;
      }
    }
  }

  _manageCows() {
    const g = this.g, c = this.cam;
    const target = Math.round(this.capC * (0.75 + 0.25 * pedDensity(this.hour)));
    let alive = 0;
    for (let i = 0; i < this.capC; i++) {
      if (!this.cAlive[i]) continue;
      g.place(this.cEdge[i], this.cDir[i], this.cS[i], 0, this._pt);
      const dx = this._pt.x - c.x, dz = this._pt.z - c.z;
      if (dx * dx + dz * dz > this.pedRadius * this.pedRadius * 2.2 && !this._inView(this._pt.x, this.heightAt(this._pt.x, this._pt.z) + 1, this._pt.z, -0.05)) this.cAlive[i] = 0;
      else alive++;
    }
    for (let i = 0; i < this.capC && alive < target; i++) {
      if (this.cAlive[i]) continue;
      const cand = g.edgesNear(c.x, c.z, this.pedRadius, this._cand);
      for (let attempt = 0; attempt < 12; attempt++) {
        const e = cand[(this._rand() * cand.length) | 0];
        if (e === undefined || !g.car[e] || g.rank[e] > 2) continue;
        if (this._rand() > (0.1 + this.hot[e] * 0.15) / (1 + this.hot[e] * 0.15)) continue;
        const s = this._rand() * g.len[e];
        g.place(e, 0, s, 0, this._pt);
        if (this._inView(this._pt.x, this.heightAt(this._pt.x, this._pt.z) + 1, this._pt.z)) continue;
        this.cAlive[i] = 1; this.cEdge[i] = e; this.cDir[i] = this._rand() < 0.5 ? 0 : 1; this.cS[i] = s; this.cLat[i] = (this._rand() - 0.5) * 1.2;
        this.cRest[i] = this._rand() * 120; this.cKind[i] = (this._rand() * 3) | 0;
        alive++;
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // pigeons

  _initFlocks() {
    const n = Math.max(1, Math.round(this.capB / 20));
    const spots = this.hotspots.length ? this.hotspots : [{ x: 0, z: 0, r: 60, w: 1 }];
    for (let f = 0; f < n; f++) {
      const h = spots[f % spots.length];
      const ang = this._rand() * 6.283, rad = this._rand() * h.r * 0.5;
      this.flocks.push({
        x: h.x + Math.cos(ang) * rad, z: h.z + Math.sin(ang) * rad, home: h,
        state: this._rand() < 0.5 ? 0 : 1, timer: 5 + this._rand() * 30, orbit: this._rand() * 6.283, orbitR: 22 + this._rand() * 30, alt: 14 + this._rand() * 24,
        first: 0, count: 0,
      });
    }
    let b = 0;
    const per = Math.floor(this.capB / n);
    for (let f = 0; f < n; f++) { this.flocks[f].first = b; this.flocks[f].count = f === n - 1 ? this.capB - b : per; b += this.flocks[f].count; }
  }

  _stepBirds(dt) {
    const c = this.cam;
    for (const f of this.flocks) {
      f.timer -= dt;
      const dCam = Math.hypot(f.x - c.x, f.z - c.z);
      // perched flocks flush when someone comes close; flying flocks land again after a while
      if (f.state === 0 && dCam < 9) { f.state = 1; f.timer = 18 + this._rand() * 25; }
      if (f.timer <= 0) { f.state ^= 1; f.timer = f.state === 0 ? 25 + this._rand() * 50 : 15 + this._rand() * 30; }
      f.orbit += dt * (f.state === 1 ? 0.32 : 0);
      const gy = this.heightAt(f.home.x, f.home.z);
      for (let k = 0; k < f.count; k++) {
        const i = f.first + k;
        const a = f.orbit + (k / f.count) * 6.283 * 1.7 + Math.sin(i * 12.9898) * 0.6;
        if (f.state === 1) {
          const r = f.orbitR * (0.8 + 0.4 * Math.abs(Math.sin(i * 4.1)));
          const nx = f.home.x + Math.cos(a) * r, nz = f.home.z + Math.sin(a) * r;
          this.bYaw[i] = Math.atan2(nx - this.bX[i], nz - this.bZ[i]) || this.bYaw[i];
          this.bX[i] = nx; this.bZ[i] = nz;
          this.bY[i] = gy + f.alt * (0.7 + 0.5 * Math.sin(i * 2.7 + f.orbit * 0.7));
          this.bPerched[i] = 0;
          this.bPhase[i] += dt * (14 + (i % 5));
        } else {
          const r = 3 + (i % 11) * 0.7;
          this.bX[i] = f.x + Math.cos(i * 2.399) * r;
          this.bZ[i] = f.z + Math.sin(i * 2.399) * r;
          this.bY[i] = this.heightAt(this.bX[i], this.bZ[i]) + 0.15;
          this.bYaw[i] = i * 1.7;
          this.bPerched[i] = 1;
          this.bPhase[i] += dt * (i % 7 === 0 ? 2 : 0);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------

  /** advance one fixed step; ctx: { hour, cam:{x,y,z,fx,fy,fz,fov,aspect}, density (0..2) } */
  step(dt, ctx = {}) {
    if (ctx.cam) Object.assign(this.cam, ctx.cam);
    if (ctx.hour !== undefined) this.hour = ctx.hour;
    if (ctx.density !== undefined) this.densityScale = ctx.density;
    this.time += dt;
    this._stepVehicles(dt);
    this._stepPeds(dt);
    this._stepCows(dt);
    this._stepBirds(dt);
    // population management every few steps (cheap, keeps the camera-relative ring topped up)
    this._mgr = (this._mgr || 0) + 1;
    if (this._mgr % 3 === 0) { this._manageVehicles(dt); this._managePeds(); this._manageCows(); }
  }

  /** fill the population instantly (initial state / after a teleport): repeated management passes without simulating */
  seed(passes = 60) {
    const saveMgr = this._mgr;
    this._anywhere = true;
    for (let i = 0; i < passes; i++) { this._manageVehicles(0); this._managePeds(); this._manageCows(); }
    this._anywhere = false;
    this._mgr = saveMgr;
  }

  /** move the camera somewhere else (cut / teleport): agents far from the new spot are recycled, the surroundings are filled at once */
  reseed(ctx, passes = 60) {
    if (ctx.cam) Object.assign(this.cam, ctx.cam);
    if (ctx.hour !== undefined) this.hour = ctx.hour;
    this._anywhere = true;
    for (let i = 0; i < this.capV; i++) if (this.vAlive[i]) { this.g.place(this.vEdge[i], this.vDir[i], this.vS[i], 0, this._pt); const dx = this._pt.x - this.cam.x, dz = this._pt.z - this.cam.z; if (dx * dx + dz * dz > this.simRadius * this.simRadius) this._despawnVehicle(i); }
    for (let i = 0; i < this.capP; i++) if (this.pAlive[i]) { this.g.place(this.pEdge[i], this.pDir[i], this.pS[i], 0, this._pt); const dx = this._pt.x - this.cam.x, dz = this._pt.z - this.cam.z; if (dx * dx + dz * dz > this.pedRadius * this.pedRadius) { this.pAlive[i] = 0; this.nP--; } }
    this._anywhere = false;
    this.seed(passes);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // snapshots for rendering: packed floats

  /** vehicles: x, y, z, yaw, type, colour(0..255), speed, flags(bit0 brake). returns count */
  snapshotVehicles(out) {
    const g = this.g, p = this._pt;
    let n = 0;
    for (let i = 0; i < this.capV; i++) {
      if (!this.vAlive[i]) continue;
      g.place(this.vEdge[i], this.vDir[i], this.vS[i], this.vLat[i], p);
      const o = n * 8;
      out[o] = p.x; out[o + 1] = this.heightAt(p.x, p.z); out[o + 2] = p.z; out[o + 3] = Math.atan2(p.dx, p.dz);
      out[o + 4] = this.vType[i]; out[o + 5] = this.vColor[i]; out[o + 6] = this.vV[i]; out[o + 7] = this.vBrake[i];
      n++;
    }
    return n;
  }

  /** pedestrians: x, y, z, yaw, phase, colour, speed, kind */
  snapshotPeds(out) {
    const g = this.g, p = this._pt;
    let n = 0;
    for (let i = 0; i < this.capP; i++) {
      if (!this.pAlive[i]) continue;
      g.place(this.pEdge[i], this.pDir[i], this.pS[i], this.pLat[i], p);
      const o = n * 8;
      out[o] = p.x; out[o + 1] = this.heightAt(p.x, p.z); out[o + 2] = p.z; out[o + 3] = Math.atan2(p.dx, p.dz);
      out[o + 4] = this.pPhase[i]; out[o + 5] = this.pColor[i]; out[o + 6] = this.pV[i]; out[o + 7] = this.pKind[i];
      n++;
    }
    return n;
  }

  /** cows: x, y, z, yaw, rest(0/1 lying), kind */
  snapshotCows(out) {
    const g = this.g, p = this._pt;
    let n = 0;
    for (let i = 0; i < this.capC; i++) {
      if (!this.cAlive[i]) continue;
      g.place(this.cEdge[i], this.cDir[i], this.cS[i], this.cLat[i], p);
      const o = n * 6;
      out[o] = p.x; out[o + 1] = this.heightAt(p.x, p.z); out[o + 2] = p.z; out[o + 3] = Math.atan2(p.dx, p.dz);
      out[o + 4] = this.cRest[i] > 0 ? 1 : 0; out[o + 5] = this.cKind[i];
      n++;
    }
    return n;
  }

  /** birds: x, y, z, yaw, flapPhase, perched */
  snapshotBirds(out) {
    for (let i = 0; i < this.capB; i++) {
      const o = i * 6;
      out[o] = this.bX[i]; out[o + 1] = this.bY[i]; out[o + 2] = this.bZ[i]; out[o + 3] = this.bYaw[i]; out[o + 4] = this.bPhase[i]; out[o + 5] = this.bPerched[i];
    }
    return this.capB;
  }
}
