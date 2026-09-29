// Kite simulation (pure, deterministic, node-testable): flyers on rooftops, a light aerodynamic kite on the end of a verlet string, cut strings.
//
//  * String: NS + 1 nodes, node 0 pinned at the flyer's hands. Verlet integration + position-based length constraints that only act when the
//    string is TAUT (a slack string may crumple), gravity, per-node drag against the wind, sub-stepped twice per fixed step.
//  * Kite: a point mass at the last node with a flat-plate style aerodynamic force at a fixed bridle angle of attack:
//      F = q A (CL * lift + CD * drag),  lift = up-ish direction perpendicular to the relative wind, plus a slow side-to-side "dance" force.
//    At the equilibrium the string, gravity and this force balance, which puts the kite downwind of the flyer at about 50-65 deg elevation.
//  * Wind: a base wind vector (m/s at 10 m) with height shear (power law), gusts and a little thermal. The simulation clock's weather supplies it.
//  * Cut strings (kite fighting): every so often a flying kite loses its string; the string drops, the kite tumbles downwind and lands; a new
//    kite is launched from another roof (real OSM building footprint) near the camera.
//  APPROX: masses, areas, coefficients and gust spectrum are plausible modelling values, not measurements.
import { mulberry32 } from '../core/rng.js';

export const KITE = { mass: 0.05, area: 0.14, cl: 1.05, cd: 0.42, rho: 1.2, nodeMass: 0.006, g: 9.81, payout: 4.5, maxRange: 600 };

const _w = { x: 0, y: 0, z: 0 };

export class KiteSim {
  /**
   * @param {{count:number, seed?:number, nodes?:number, roofs?:Float32Array|null, groundAt:(x:number,z:number)=>number}} o
   *   roofs: stride 4 (x, z, height, area) real footprint anchors; without them flyers stand on open ground around the camera
   */
  constructor(o) {
    this.n = o.count;
    this.NS = o.nodes ?? 14;
    this.rng = mulberry32(o.seed ?? 5);
    this.groundAt = o.groundAt;
    this.roofs = o.roofs && o.roofs.length ? o.roofs : null;
    const n = this.n, N1 = this.NS + 1;
    this.state = new Uint8Array(n); // 0 flying, 1 cut (free flight), 2 waiting to relaunch
    this.timer = new Float32Array(n);
    this.anchor = new Float32Array(n * 3);
    this.kp = new Float32Array(n * 3);
    this.kv = new Float32Array(n * 3);
    this.len = new Float32Array(n);
    this.pay = new Float32Array(n);
    this.sp = new Float32Array(n * N1 * 3);
    this.sq = new Float32Array(n * N1 * 3);
    this.phase = new Float32Array(n);
    this.palette = new Uint8Array(n * 2);
    this.size = new Float32Array(n);
    this.time = 0;
    this.windX = 6.0; // downwind velocity components at 10 m (m/s); kites need a fresh breeze (below ~5 m/s they barely climb)
    this.windZ = 2.5;
    this.nextCut = 30;
    this.stats = { launched: 0, cut: 0, recycled: 0 };
    for (let i = 0; i < n; i++) this.state[i] = 2;
  }

  setWind(x, z) { this.windX = x; this.windZ = z; }

  /** wind (m/s) at a point: shear with height above the flyer's ground, gusts, thermals */
  windAt(x, y, z, gy, phase, out = _w) {
    const h = Math.max(3, y - gy);
    const shear = Math.pow(h / 10, 0.22);
    const t = this.time;
    const gust = 1 + 0.26 * Math.sin(0.5 * t + 0.011 * x + phase) + 0.12 * Math.sin(1.9 * t + 0.03 * z + phase * 2.3);
    out.x = this.windX * shear * gust;
    out.z = this.windZ * shear * gust;
    out.y = 0.25 * Math.sin(0.9 * t + 0.02 * (x + z) + phase);
    return out;
  }

  /** launch kite i from a roof (or open ground) near the camera position (cx, cz) */
  launch(i, cx, cz) {
    const rng = this.rng;
    let ax, az, ay;
    let placed = false;
    if (this.roofs) {
      const m = this.roofs.length / 4;
      for (let tries = 0; tries < 80 && !placed; tries++) {
        const k = Math.floor(rng() * m) * 4;
        const x = this.roofs[k], z = this.roofs[k + 1], h = this.roofs[k + 2], a = this.roofs[k + 3];
        const d = Math.hypot(x - cx, z - cz);
        if (a < 40 || d < 45 || d > 300) continue;
        ax = x; az = z; ay = this.groundAt(x, z) + h + 1.15; placed = true;
      }
    }
    if (!placed) { // no footprint data: a flyer on open ground on a ring around the camera (no roofs are invented)
      const a = rng() * Math.PI * 2, d = 55 + rng() * 240;
      ax = cx + Math.cos(a) * d; az = cz + Math.sin(a) * d; ay = this.groundAt(ax, az) + 1.4;
    }
    const N1 = this.NS + 1;
    this.anchor[i * 3] = ax; this.anchor[i * 3 + 1] = ay; this.anchor[i * 3 + 2] = az;
    this.phase[i] = rng() * 6.28;
    this.len[i] = 45 + rng() * 75;
    this.pay[i] = 0.6;
    this.size[i] = 1.35 + rng() * 0.6; // ~0.62-0.9 m across: a large patang (reviewers found the kites too small to read)
    this.palette[i * 2] = Math.floor(rng() * 12);
    this.palette[i * 2 + 1] = Math.floor(rng() * 12);
    const wd = Math.hypot(this.windX, this.windZ) || 1;
    const ux = this.windX / wd, uz = this.windZ / wd;
    for (let k = 0; k < N1; k++) {
      const o = (i * N1 + k) * 3, t = k / this.NS;
      const x = ax + ux * t * 2.5, y = ay + t * 1.6, z = az + uz * t * 2.5;
      this.sp[o] = x; this.sp[o + 1] = y; this.sp[o + 2] = z;
      this.sq[o] = x; this.sq[o + 1] = y; this.sq[o + 2] = z;
    }
    const kk = (i * N1 + this.NS) * 3;
    this.kp[i * 3] = this.sp[kk]; this.kp[i * 3 + 1] = this.sp[kk + 1]; this.kp[i * 3 + 2] = this.sp[kk + 2];
    this.kv[i * 3] = this.kv[i * 3 + 1] = this.kv[i * 3 + 2] = 0;
    // the flyer throws the kite into the wind: a small initial climb speed so it does not just drag along the roof
    this.kv[i * 3 + 1] = 3.5;
    const kq = (i * N1 + this.NS) * 3;
    this.sq[kq + 1] -= 3.5 * (1 / 60);
    this.state[i] = 0;
    this.timer[i] = 0;
    this.stats.launched++;
  }

  /** stagger a fresh population (each kite at a random point of its life so the sky is not empty then full) */
  reset(cx, cz, warm = 10) {
    this.time = 0;
    for (let i = 0; i < this.n; i++) this.launch(i, cx, cz);
    const dt = 1 / 30;
    // staggered payout so kites are at different heights when the mode starts
    for (let i = 0; i < this.n; i++) this.pay[i] = 8 + this.rng() * (this.len[i] - 8);
    for (let s = 0; s < warm * 30; s++) this.step(dt, cx, cz);
  }

  _aero(i, vx, vy, vz, wx, wy, wz, cutK, out) {
    const rx = wx - vx, ry = wy - vy, rz = wz - vz;
    const s = Math.hypot(rx, ry, rz);
    if (s < 1e-3) { out[0] = out[1] = out[2] = 0; return; }
    const dx = rx / s, dy = ry / s, dz = rz / s;
    // lift: up minus its component along the flow
    const dot = dy;
    let lx = -dot * dx, ly = 1 - dot * dy, lz = -dot * dz;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    const q = 0.5 * KITE.rho * s * s * KITE.area * (this.size[i] * this.size[i]);
    const cl = KITE.cl * cutK.cl, cd = KITE.cd * cutK.cd;
    out[0] = q * (cl * lx + cd * dx);
    out[1] = q * (cl * ly + cd * dy);
    out[2] = q * (cl * lz + cd * dz);
  }

  /** one fixed step (dt seconds) around a camera at (cx, cz) */
  step(dt, cx, cz) {
    this.time += dt;
    const NS = this.NS, N1 = NS + 1;
    const F = [0, 0, 0];
    const w = { x: 0, y: 0, z: 0 };
    const SUB = 2, h = dt / SUB;
    const wl = Math.hypot(this.windX, this.windZ) || 1;
    const cwx = -this.windZ / wl, cwz = this.windX / wl; // horizontal cross-wind unit vector
    for (let i = 0; i < this.n; i++) {
      const st = this.state[i];
      if (st === 2) {
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) this.launch(i, cx, cz);
        continue;
      }
      // recycle kites that drifted out of reach of the viewer
      const kx = this.kp[i * 3], kz = this.kp[i * 3 + 2];
      if (Math.hypot(kx - cx, kz - cz) > KITE.maxRange) { this.stats.recycled++; this.launch(i, cx, cz); continue; }
      const phase = this.phase[i];
      const ax = this.anchor[i * 3], ay = this.anchor[i * 3 + 1], az = this.anchor[i * 3 + 2];
      const gy = ay - 2;
      if (st === 0 && this.pay[i] < this.len[i]) this.pay[i] = Math.min(this.len[i], this.pay[i] + KITE.payout * dt);
      const seg = Math.max(0.05, this.pay[i] / NS);
      this.timer[i] += dt;
      if (st === 0 && this.timer[i] > 30 && this.kp[i * 3 + 1] - ay < 4) { this.cut(i); continue; } // never got up (too little wind): let it go
      const cutK = st === 0 ? { cl: 1, cd: 1 } : { cl: 0.28 + 0.25 * Math.sin(this.timer[i] * 3.1 + phase), cd: 1.9 };
      const base = i * N1 * 3;
      for (let sub = 0; sub < SUB; sub++) {
        for (let k = st === 0 ? 1 : 0; k <= NS; k++) {
          const o = base + k * 3;
          const px = this.sp[o], py = this.sp[o + 1], pz = this.sp[o + 2];
          const qx = this.sq[o], qy = this.sq[o + 1], qz = this.sq[o + 2];
          const vx = (px - qx) / h, vy = (py - qy) / h, vz = (pz - qz) / h;
          this.windAt(px, py, pz, gy, phase, w);
          let axx, ayy, azz;
          if (k === NS) {
            this._aero(i, vx, vy, vz, w.x, w.y, w.z, cutK, F);
            const sway = st === 0 ? 0.55 * Math.sin(1.3 * this.time + phase) + 0.25 * Math.sin(3.1 * this.time + phase * 1.7) : 0;
            axx = (F[0] + cwx * sway) / KITE.mass;
            ayy = F[1] / KITE.mass - KITE.g;
            azz = (F[2] + cwz * sway) / KITE.mass;
          } else {
            // string node: gravity + drag toward the local wind
            const rx = w.x - vx, ry = w.y - vy, rz = w.z - vz, rs = Math.hypot(rx, ry, rz);
            const kd = Math.min(60, 0.9 * rs);
            axx = kd * rx / 6; ayy = kd * ry / 6 - KITE.g; azz = kd * rz / 6;
            // (a heavy "manja" string: quadratic drag on the node's projected length; dividing by 6 keeps the node light but stable)
          }
          const damp = k === NS ? 0.992 : 0.985;
          this.sq[o] = px; this.sq[o + 1] = py; this.sq[o + 2] = pz;
          this.sp[o] = px + (px - qx) * damp + axx * h * h;
          this.sp[o + 1] = py + (py - qy) * damp + ayy * h * h;
          this.sp[o + 2] = pz + (pz - qz) * damp + azz * h * h;
        }
        // constraints (only when taut); node 0 pinned while held
        if (st === 0) { this.sp[base] = ax; this.sp[base + 1] = ay; this.sp[base + 2] = az; }
        for (let it = 0; it < 10; it++) {
          for (let k = 0; k < NS; k++) {
            const a = base + k * 3, b = a + 3;
            const dx = this.sp[b] - this.sp[a], dy = this.sp[b + 1] - this.sp[a + 1], dz = this.sp[b + 2] - this.sp[a + 2];
            const L = Math.hypot(dx, dy, dz);
            if (L <= seg || L < 1e-6) continue;
            const diff = (L - seg) / L;
            const wa = k === 0 && st === 0 ? 0 : 1 / KITE.nodeMass;
            const wb = k + 1 === NS ? 1 / KITE.mass : 1 / KITE.nodeMass;
            const ws = wa + wb;
            const ca = wa / ws * diff, cb = wb / ws * diff;
            this.sp[a] += dx * ca; this.sp[a + 1] += dy * ca; this.sp[a + 2] += dz * ca;
            this.sp[b] -= dx * cb; this.sp[b + 1] -= dy * cb; this.sp[b + 2] -= dz * cb;
          }
          if (st === 0) { this.sp[base] = ax; this.sp[base + 1] = ay; this.sp[base + 2] = az; }
        }
        // floor: a held string never dips below the roof it is held on; free strings stop at the ground
        for (let k = 1; k <= NS; k++) {
          const o = base + k * 3;
          const floor = st === 0 ? ay - 0.6 : this.groundAt(this.sp[o], this.sp[o + 2]) + 0.05;
          if (this.sp[o + 1] < floor) { this.sp[o + 1] = floor; this.sq[o + 1] = Math.max(this.sq[o + 1], floor - 0.001); }
        }
      }
      const ko = base + NS * 3;
      this.kv[i * 3] = (this.sp[ko] - this.sq[ko]) / h; this.kv[i * 3 + 1] = (this.sp[ko + 1] - this.sq[ko + 1]) / h; this.kv[i * 3 + 2] = (this.sp[ko + 2] - this.sq[ko + 2]) / h;
      this.kp[i * 3] = this.sp[ko]; this.kp[i * 3 + 1] = this.sp[ko + 1]; this.kp[i * 3 + 2] = this.sp[ko + 2];
      if (st === 1) {
        const gh = this.groundAt(this.kp[i * 3], this.kp[i * 3 + 2]);
        if (this.kp[i * 3 + 1] < gh + 0.5 || this.timer[i] > 45) { this.state[i] = 2; this.timer[i] = 1.5 + this.rng() * 5; }
      }
    }
    // kite fighting: from time to time one flying kite is cut loose
    this.nextCut -= dt;
    if (this.nextCut <= 0) {
      this.nextCut = (240 / Math.max(1, this.n)) * (0.5 + this.rng());
      for (let tries = 0; tries < 20; tries++) {
        const i = Math.floor(this.rng() * this.n);
        if (this.state[i] === 0 && this.pay[i] >= this.len[i] * 0.9) { this.cut(i); break; }
      }
    }
  }

  cut(i) {
    if (this.state[i] !== 0) return false;
    this.state[i] = 1;
    this.timer[i] = 0;
    this.stats.cut++;
    return true;
  }

  /** number of kites in each state */
  counts() {
    const c = [0, 0, 0];
    for (let i = 0; i < this.n; i++) c[this.state[i]]++;
    return c;
  }

  /** pose basis of kite i: face normal n (toward the string), spine s, across a; out = [ax,ay,az, sx,sy,sz, nx,ny,nz] */
  pose(i, out) {
    const N1 = this.NS + 1, NS = this.NS;
    const ko = (i * N1 + NS) * 3, po = (i * N1 + NS - 1) * 3;
    let tx = this.sp[po] - this.sp[ko], ty = this.sp[po + 1] - this.sp[ko + 1], tz = this.sp[po + 2] - this.sp[ko + 2];
    const cut = this.state[i] === 1;
    if (cut) { // a cut kite tumbles: its "string direction" is its own (negated) velocity
      tx = -this.kv[i * 3]; ty = -this.kv[i * 3 + 1] - 1.5; tz = -this.kv[i * 3 + 2];
    }
    let l = Math.hypot(tx, ty, tz) || 1;
    tx /= l; ty /= l; tz /= l;
    // face normal: toward the flyer, leaned back into the wind by the bridle angle
    const wl = Math.hypot(this.windX, this.windZ) || 1;
    let nx = tx * 0.9 - (this.windX / wl) * 0.12, ny = ty * 0.9 + 0.05, nz = tz * 0.9 - (this.windZ / wl) * 0.12;
    l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // spine: up, made perpendicular to the normal
    let d = ny;
    let sx = -d * nx, sy = 1 - d * ny, sz = -d * nz;
    l = Math.hypot(sx, sy, sz);
    if (l < 1e-3) { sx = this.windX / wl; sy = 0; sz = this.windZ / wl; d = sx * nx + sz * nz; sx -= d * nx; sz -= d * nz; l = Math.hypot(sx, sy, sz) || 1; }
    sx /= l; sy /= l; sz /= l;
    // across = spine x normal
    let ax = sy * nz - sz * ny, ay = sz * nx - sx * nz, az = sx * ny - sy * nx;
    // dance: roll about the normal
    const t = this.time, ph = this.phase[i];
    const roll = cut ? this.timer[i] * (2.2 + (ph % 1) * 2) : 0.28 * Math.sin(1.1 * t + ph) + 0.12 * Math.sin(2.9 * t + ph * 2);
    const c = Math.cos(roll), s = Math.sin(roll);
    out[0] = ax * c + sx * s; out[1] = ay * c + sy * s; out[2] = az * c + sz * s;
    out[3] = sx * c - ax * s; out[4] = sy * c - ay * s; out[5] = sz * c - az * s;
    out[6] = nx; out[7] = ny; out[8] = nz;
    return out;
  }

  /** actual string length of kite i (sum of node distances), metres */
  stringLength(i) {
    const N1 = this.NS + 1;
    let L = 0;
    for (let k = 0; k < this.NS; k++) {
      const a = (i * N1 + k) * 3, b = a + 3;
      L += Math.hypot(this.sp[b] - this.sp[a], this.sp[b + 1] - this.sp[a + 1], this.sp[b + 2] - this.sp[a + 2]);
    }
    return L;
  }
}
