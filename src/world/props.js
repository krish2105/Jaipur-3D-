// Hand-built prop meshes (vertex-coloured, unit-sized) + a slot pool for instancing them across tiles.
import * as THREE from 'three';

class PB {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.n = 0; }
  v(x, y, z, nx, ny, nz, c) { this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(c[0], c[1], c[2]); return this.n++; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  // axis-aligned box, faces outward
  box(cx, cy, cz, sx, sy, sz, c, top = c) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const f = (p, n, cc) => { const ids = p.map((q) => this.v(q[0], q[1], q[2], n[0], n[1], n[2], cc)); this.quad(ids[0], ids[1], ids[2], ids[3]); };
    f([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c);
    f([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], c);
    f([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], c);
    f([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], c);
    f([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], top);
    f([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], c);
  }
  // vertical cylinder (smooth normals)
  cyl(cx, y0, cz, r0, r1, h, seg, c, cap = true) {
    const ring = [];
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push([Math.cos(a), Math.sin(a)]); }
    const slope = (r0 - r1) / h;
    for (let i = 0; i < seg; i++) {
      const [c0, s0] = ring[i], [c1, s1] = ring[i + 1];
      const nl0 = Math.hypot(1, slope);
      const a = this.v(cx + c0 * r0, y0, cz + s0 * r0, c0 / nl0, slope / nl0, s0 / nl0, c);
      const b = this.v(cx + c1 * r0, y0, cz + s1 * r0, c1 / nl0, slope / nl0, s1 / nl0, c);
      const cc = this.v(cx + c1 * r1, y0 + h, cz + s1 * r1, c1 / nl0, slope / nl0, s1 / nl0, c);
      const d = this.v(cx + c0 * r1, y0 + h, cz + s0 * r1, c0 / nl0, slope / nl0, s0 / nl0, c);
      this.quad(a, d, cc, b);
    }
    if (cap && r1 > 0.001) {
      const ctr = this.v(cx, y0 + h, cz, 0, 1, 0, c);
      const base = this.n;
      for (let i = 0; i < seg; i++) this.v(cx + ring[i][0] * r1, y0 + h, cz + ring[i][1] * r1, 0, 1, 0, c);
      for (let i = 0; i < seg; i++) this.idx.push(ctr, base + (i + 1) % seg, base + i);
    }
  }
  // dome (half ellipsoid), rings x seg
  dome(cx, y0, cz, rx, ry, seg, rings, c) {
    for (let k = 0; k < rings; k++) {
      const a0 = (k / rings) * (Math.PI / 2), a1 = ((k + 1) / rings) * (Math.PI / 2);
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (a, t) => [cx + Math.cos(a) * Math.cos(t) * rx, y0 + Math.sin(a) * ry, cz + Math.cos(a) * Math.sin(t) * rx];
        const N = (a, t) => { const nx = Math.cos(a) * Math.cos(t) / rx, ny = Math.sin(a) / ry, nz = Math.cos(a) * Math.sin(t) / rx; const l = Math.hypot(nx, ny, nz); return [nx / l, ny / l, nz / l]; };
        const q = [[a0, t0], [a0, t1], [a1, t1], [a1, t0]].map(([a, t]) => { const p = P(a, t), n = N(a, t); return this.v(p[0], p[1], p[2], n[0], n[1], n[2], c); });
        this.quad(q[0], q[3], q[2], q[1]);
      }
    }
  }
  // flat polygon facing +z at depth z (for arched inset panels)
  archPanel(cx, cy, z, w, h, c) {
    const r = w / 2, hs = h - r, pts = [[-r, 0], [r, 0], [r, hs]];
    for (let i = 1; i < 8; i++) { const a = (i / 8) * Math.PI; pts.push([Math.cos(a) * r, hs + Math.sin(a) * r]); }
    pts.push([-r, hs]);
    const ids = pts.map((p) => this.v(cx + p[0], cy + p[1], z, 0, 0, 1, c));
    for (let i = 1; i < ids.length - 1; i++) this.idx.push(ids[0], ids[i], ids[i + 1]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const PINK = [0.52, 0.2, 0.15], CREAM = [0.72, 0.6, 0.45], DARK = [0.03, 0.025, 0.022], STONE = [0.42, 0.3, 0.22];

/** Jharokha (projecting oriel window): corbels, floor, arched lattice bay, chhajja eave with a small dome. Front = +Z. */
export function makeJharokhaGeometry() {
  const b = new PB();
  // stepped corbel bracket
  b.box(0, -0.10, 0.22, 0.95, 0.10, 0.44, STONE);
  b.box(0, -0.20, 0.16, 0.7, 0.10, 0.32, STONE);
  b.box(0, -0.30, 0.10, 0.45, 0.10, 0.20, STONE);
  b.box(0, 0.03, 0.30, 1.56, 0.08, 0.62, CREAM); // floor slab
  b.box(0, 0.75, 0.29, 1.44, 1.32, 0.56, PINK); // body
  // trim frame
  b.box(0, 1.43, 0.30, 1.56, 0.07, 0.62, CREAM);
  // three arched openings on the front, two on each side
  const front = 0.29 + 0.28 + 0.004;
  for (let i = -1; i <= 1; i++) { b.archPanel(i * 0.46, 0.22, front, 0.36, 1.0, DARK); }
  // eave (chhajja) and shallow dome
  b.box(0, 1.52, 0.30, 1.74, 0.06, 0.8, CREAM);
  b.dome(0, 1.55, 0.29, 0.62, 0.46, 12, 4, PINK);
  b.cyl(0, 2.0, 0.29, 0.03, 0.0, 0.16, 6, CREAM, false);
  // side panels via thin boxes
  b.box(0.727, 0.75, 0.29, 0.02, 0.9, 0.34, DARK);
  b.box(-0.727, 0.75, 0.29, 0.02, 0.9, 0.34, DARK);
  return b.build();
}

/** Chhatri: four pillars, platform, domed cap and finial (unit ~2.4 m wide, 3.3 m tall). */
export function makeChhatriGeometry() {
  const b = new PB();
  b.box(0, 0.10, 0, 2.5, 0.2, 2.5, CREAM);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.cyl(sx * 0.95, 0.2, sz * 0.95, 0.11, 0.09, 1.65, 8, CREAM);
  b.box(0, 1.92, 0, 2.3, 0.14, 2.3, CREAM);
  b.dome(0, 1.99, 0, 1.1, 0.95, 16, 5, PINK);
  b.cyl(0, 2.9, 0, 0.09, 0.03, 0.5, 6, CREAM);
  return b.build();
}

export function makeLampPostGeometry() {
  const b = new PB();
  b.cyl(0, 0, 0, 0.09, 0.055, 5.2, 8, [0.06, 0.06, 0.065]);
  b.box(0.45, 5.1, 0, 1.0, 0.06, 0.06, [0.06, 0.06, 0.065]);
  b.box(0.9, 5.05, 0, 0.36, 0.1, 0.16, [0.07, 0.07, 0.075]);
  return b.build();
}
export function makeLampHeadGeometry() {
  const g = new THREE.BoxGeometry(0.32, 0.05, 0.14);
  g.translate(0.9, 4.98, 0);
  return g;
}

/** Low-poly Indian street tree (neem / peepal style): trunk + three lumpy canopy blobs. */
export function makeTreeGeometry() {
  const b = new PB();
  b.cyl(0, 0, 0, 0.28, 0.16, 3.2, 7, [0.16, 0.11, 0.08]);
  const leaf = [0.08, 0.16, 0.05];
  for (const [x, y, z, r] of [[0, 5.2, 0, 2.7], [1.5, 4.4, 0.4, 2.0], [-1.3, 4.6, -0.7, 2.1], [0.2, 4.5, 1.4, 1.9]]) {
    b.dome(x, y - r * 0.55, z, r, r * 1.05, 9, 3, leaf);
    // mirrored lower half for a filled blob
    const n0 = b.n;
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * (Math.PI / 2), a1 = ((k + 1) / 3) * (Math.PI / 2);
      for (let i = 0; i < 9; i++) {
        const t0 = (i / 9) * Math.PI * 2, t1 = ((i + 1) / 9) * Math.PI * 2;
        const P = (a, t) => [x + Math.cos(a) * Math.cos(t) * r, y - r * 0.55 - Math.sin(a) * r * 0.5, z + Math.cos(a) * Math.sin(t) * r];
        const q = [[a0, t0], [a0, t1], [a1, t1], [a1, t0]].map(([a, t]) => { const p = P(a, t); return b.v(p[0], p[1], p[2], Math.cos(a) * Math.cos(t), -Math.sin(a), Math.cos(a) * Math.sin(t), leaf); });
        b.quad(q[0], q[1], q[2], q[3]);
      }
    }
    void n0;
  }
  return b.build();
}

// ---------------------------------------------------------------------------------------------
/** Fixed-capacity InstancedMesh shared by all tiles; tiles allocate contiguous slot ranges. */
export class InstancePool {
  constructor(geometry, material, capacity, { castShadow = true, receiveShadow = true, name = 'pool' } = {}) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.frustumCulled = false; // spans many tiles; per-tile culling would need chunks
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.free = [[0, capacity]];
    this.high = 0;
    this._m = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  alloc(n) {
    for (let i = 0; i < this.free.length; i++) {
      const [s, e] = this.free[i];
      if (e - s >= n) {
        this.free[i] = [s + n, e];
        if (this.free[i][0] === this.free[i][1]) this.free.splice(i, 1);
        this.high = Math.max(this.high, s + n);
        return { start: s, count: n };
      }
    }
    return null;
  }

  release(r) {
    if (!r) return;
    for (let i = 0; i < r.count; i++) this.mesh.setMatrixAt(r.start + i, this._zero);
    this.mesh.instanceMatrix.addUpdateRange(r.start * 16, r.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push([r.start, r.start + r.count]);
    this.free.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const f of this.free) {
      const last = merged[merged.length - 1];
      if (last && last[1] === f[0]) last[1] = f[1];
      else merged.push([...f]);
    }
    this.free = merged;
    // shrink draw range
    this.high = this.free.length && this.free[this.free.length - 1][1] === this.capacity ? this.free[this.free.length - 1][0] : this.capacity;
    this.mesh.count = this.high;
  }

  /** write matrices from a builder callback (i, matrix) */
  write(r, fn) {
    for (let i = 0; i < r.count; i++) {
      fn(i, this._m);
      this.mesh.setMatrixAt(r.start + i, this._m);
    }
    this.mesh.instanceMatrix.addUpdateRange(r.start * 16, r.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, r.start + r.count);
  }

  get used() {
    return this.capacity - this.free.reduce((s, f) => s + f[1] - f[0], 0);
  }
}
