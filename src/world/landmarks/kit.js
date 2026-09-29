// Modelling kit for hand-built landmarks: vertex-coloured geometry builder + a weathered "hero stone" material.
import * as THREE from 'three';
import { ShapeUtils } from 'three';
import { addEnvUniforms, ENV_DECL } from '../../render/env.js';

export const COL = {
  pink: [0.50, 0.20, 0.15], pinkDeep: [0.40, 0.13, 0.11], pinkLight: [0.58, 0.30, 0.23],
  cream: [0.72, 0.60, 0.45], limewash: [0.80, 0.72, 0.60], sand: [0.55, 0.40, 0.28], ochre: [0.55, 0.37, 0.18],
  white: [0.72, 0.68, 0.60], marble: [0.78, 0.76, 0.70], dark: [0.028, 0.022, 0.02], stone: [0.36, 0.30, 0.25],
  red: [0.42, 0.13, 0.09], green: [0.07, 0.16, 0.06], water: [0.02, 0.04, 0.045], gold: [0.6, 0.45, 0.12],
};

export class MB {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.idx = []; this.n = 0; }
  v(x, y, z, nx, ny, nz, c, u = 0, w = 0) { this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(c[0], c[1], c[2]); this.uv.push(u, w); return this.n++; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.idx.push(a, b, c); }

  /** rotated box; yaw rotates about Y around (cx, cz) (three.js convention: x' = x cos + z sin) */
  box(cx, y0, cz, sx, sy, sz, c, yaw = 0, top = c) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const R = (x, z) => [cx + x * co + z * si, cz - x * si + z * co];
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const F = (pts, n, col) => {
      const nx = n[0] * co + n[2] * si, nz = -n[0] * si + n[2] * co;
      const ids = pts.map((p, i) => {
        const r = R(p[0], p[2]);
        return this.v(r[0], p[1], r[1], nx, n[1], nz, col, i === 1 || i === 2 ? sx : 0, p[1]);
      });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    };
    F([[-hx, y0, hz], [hx, y0, hz], [hx, y1, hz], [-hx, y1, hz]], [0, 0, 1], c);
    F([[hx, y0, -hz], [-hx, y0, -hz], [-hx, y1, -hz], [hx, y1, -hz]], [0, 0, -1], c);
    F([[hx, y0, hz], [hx, y0, -hz], [hx, y1, -hz], [hx, y1, hz]], [1, 0, 0], c);
    F([[-hx, y0, -hz], [-hx, y0, hz], [-hx, y1, hz], [-hx, y1, -hz]], [-1, 0, 0], c);
    F([[-hx, y1, hz], [hx, y1, hz], [hx, y1, -hz], [-hx, y1, -hz]], [0, 1, 0], top);
  }

  /** extrude a simple polygon (CCW seen from above in x/z-north-up terms is not required) between y0 and y1 */
  prism(poly, y0, y1, c, cap = c, capTop = true) {
    const n = poly.length;
    // orientation: compute signed area with y = -z
    let a = 0;
    for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; a += p[0] * -q[1] - q[0] * -p[1]; }
    const pts = a < 0 ? poly.slice().reverse() : poly;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const v0 = this.v(p[0], y0, p[1], nx, 0, nz, c, 0, y0), v1 = this.v(q[0], y0, q[1], nx, 0, nz, c, L, y0);
      const v2 = this.v(q[0], y1, q[1], nx, 0, nz, c, L, y1), v3 = this.v(p[0], y1, p[1], nx, 0, nz, c, 0, y1);
      this.quad(v0, v1, v2, v3);
    }
    if (capTop) {
      const tri = ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
      const base = this.n;
      for (const p of pts) this.v(p[0], y1, p[1], 0, 1, 0, cap, p[0], p[1]);
      for (const t of tri) {
        const A = pts[t[0]], B = pts[t[1]], C = pts[t[2]];
        const up = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
        if (up > 0) this.tri(base + t[0], base + t[1], base + t[2]); else this.tri(base + t[0], base + t[2], base + t[1]);
      }
    }
  }

  cyl(cx, y0, cz, r0, r1, h, seg, c, cap = true) {
    const ring = [];
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; ring.push([Math.cos(a), Math.sin(a)]); }
    const slope = (r0 - r1) / h, nl = Math.hypot(1, slope);
    for (let i = 0; i < seg; i++) {
      const [c0, s0] = ring[i], [c1, s1] = ring[i + 1];
      const a = this.v(cx + c0 * r0, y0, cz + s0 * r0, c0 / nl, slope / nl, s0 / nl, c, i / seg * r0 * 6.28, y0);
      const b = this.v(cx + c1 * r0, y0, cz + s1 * r0, c1 / nl, slope / nl, s1 / nl, c, (i + 1) / seg * r0 * 6.28, y0);
      const e = this.v(cx + c1 * r1, y0 + h, cz + s1 * r1, c1 / nl, slope / nl, s1 / nl, c, (i + 1) / seg * r0 * 6.28, y0 + h);
      const d = this.v(cx + c0 * r1, y0 + h, cz + s0 * r1, c0 / nl, slope / nl, s0 / nl, c, i / seg * r0 * 6.28, y0 + h);
      this.quad(a, d, e, b);
    }
    if (cap && r1 > 0.001) {
      const ctr = this.v(cx, y0 + h, cz, 0, 1, 0, c);
      const base = this.n;
      for (let i = 0; i < seg; i++) this.v(cx + ring[i][0] * r1, y0 + h, cz + ring[i][1] * r1, 0, 1, 0, c);
      for (let i = 0; i < seg; i++) this.tri(ctr, base + (i + 1) % seg, base + i);
    }
  }

  /** half-ellipsoid dome; profile>1 gives an onion/bulbous bulge near the base */
  dome(cx, y0, cz, rx, ry, seg, rings, c, bulge = 0) {
    const P = (a, t) => {
      const r = Math.cos(a) * (1 + bulge * Math.sin(a * 2));
      return [cx + r * Math.cos(t) * rx, y0 + Math.sin(a) * ry, cz + r * Math.sin(t) * rx];
    };
    for (let k = 0; k < rings; k++) {
      const a0 = (k / rings) * (Math.PI / 2), a1 = ((k + 1) / rings) * (Math.PI / 2);
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        const vs = [[a0, t0], [a0, t1], [a1, t1], [a1, t0]].map(([a, t]) => {
          const p = P(a, t);
          const nx = Math.cos(a) * Math.cos(t) / rx, ny = Math.sin(a) / ry, nz = Math.cos(a) * Math.sin(t) / rx;
          const l = Math.hypot(nx, ny, nz);
          return this.v(p[0], p[1], p[2], nx / l, ny / l, nz / l, c);
        });
        this.quad(vs[0], vs[3], vs[2], vs[1]);
      }
    }
  }

  /** arched flat panel on a vertical face: origin (x,z), along-face direction (dx,dz), outward normal (nx,nz) */
  archOpening(x, y, z, dx, dz, nx, nz, w, h, c = COL.dark, pointed = true) {
    const r = w / 2;
    const pts = [];
    if (pointed) {
      // two arcs (radius 1.5r) centred at +-0.5r on the springing line meet at the apex (0, hs + 1.414 r)
      const hs = Math.max(h - r * 1.41421356, 0.05);
      pts.push([-r, 0], [r, 0], [r, hs]);
      const th1 = Math.acos(1 / 3);
      const N = 8;
      for (let i = 1; i <= N; i++) { const th = (i / N) * th1; pts.push([-0.5 * r + 1.5 * r * Math.cos(th), hs + 1.5 * r * Math.sin(th)]); }
      for (let i = N - 1; i >= 1; i--) { const th = (i / N) * th1; pts.push([0.5 * r - 1.5 * r * Math.cos(th), hs + 1.5 * r * Math.sin(th)]); }
      pts.push([-r, hs]);
    } else {
      const hs = Math.max(h - r, 0.05);
      pts.push([-r, 0], [r, 0], [r, hs]);
      const N = 10;
      for (let i = 1; i < N; i++) { const a = (i / N) * Math.PI; pts.push([Math.cos(a) * r, hs + Math.sin(a) * r]); }
      pts.push([-r, hs]);
    }
    const ids = pts.map((p) => this.v(x + dx * p[0] + nx * 0.02, y + p[1], z + dz * p[0] + nz * 0.02, nx, 0, nz, c));
    // fan triangulation is valid (convex outline); wind to face the outward normal
    for (let i = 1; i < ids.length - 1; i++) this.tri(ids[0], ids[i], ids[i + 1]);
  }

  /** row of arched openings along a wall segment */
  arcade(x0, z0, x1, z1, y, n, w, h, fill = COL.dark, pointed = true, frame = COL.limewash) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    const pitch = L / n;
    for (let i = 0; i < n; i++) {
      const cx = x0 + ux * (i + 0.5) * pitch, cz = z0 + uz * (i + 0.5) * pitch;
      this.archOpening(cx, y, cz, ux, uz, nx, nz, w + 0.28, h + 0.14, frame, pointed);
      this.archOpening(cx + nx * 0.01, y, cz + nz * 0.01, ux, uz, nx, nz, w, h, fill, pointed);
    }
  }

  /** merlon crenellation on top of a wall segment */
  merlons(x0, z0, x1, z1, y, mh, mw, gap, thick, c) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const yaw = Math.atan2(-uz, ux);
    const n = Math.max(1, Math.floor(L / (mw + gap)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * (L / n);
      this.box(x0 + ux * t, y, z0 + uz * t, mw, mh, thick, c, yaw);
    }
  }

  /** flip any triangle whose winding disagrees with its declared vertex normals (so declared normals are the source of truth) */
  orient() {
    const P = this.pos, N = this.nrm, I = this.idx;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2];
      const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
      const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = N[3 * a] + N[3 * b] + N[3 * c], ny = N[3 * a + 1] + N[3 * b + 1] + N[3 * c + 1], nz = N[3 * a + 2] + N[3 * b + 2] + N[3 * c + 2];
      if (fx * nx + fy * ny + fz * nz < 0) { I[i + 1] = c; I[i + 2] = b; }
    }
  }

  build() {
    this.orient();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Weathered hero stone: vertex colours * world-space noise, soot near the ground, drip stains, sun-bleached tops. */
export function createHeroMaterial(name = 'hero') {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.userData.programKey = 'hero';
  mat.name = name;
  mat.onBeforeCompile = (shader) => {
    addEnvUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vHWP; varying vec3 vHN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vHWP = (modelMatrix * vec4(position, 1.0)).xyz; vHN = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${ENV_DECL}\nvarying vec3 vHWP; varying vec3 vHN;\nvoid main() {`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          float hd = length(vViewPosition);
          float det = 1.0 - smoothstep(60.0, 500.0, hd);
          vec3 wp = vHWP;
          float n1 = fbm2_3(wp.xz * 0.25 + wp.y * 0.13);
          float n2 = vnoise(vec2(wp.x + wp.z, wp.y) * 1.9);
          float grain = vnoise(vec2(wp.x + wp.z, wp.y) * 7.0);
          float ground = wp.y - 442.6 * 0.0;
          float ht = clamp(wp.y * 0.02, 0.0, 1.0);
          float soot = (1.0 - smoothstep(0.0, 2.5, wp.y + 0.5)) * 0.35;
          float streak = smoothstep(0.55, 0.92, vnoise(vec2((wp.x + wp.z) * 1.7, wp.y * 0.09))) * 0.28;
          float wall = 1.0 - abs(vHN.y);
          vec3 c = diffuseColor.rgb;
          c *= 0.84 + 0.3 * n1 + 0.1 * (n2 - 0.5) * det + 0.06 * (grain - 0.5) * det;
          c *= 1.0 - (soot + streak * wall) ;
          c = mix(c, c * vec3(1.12, 1.03, 0.9), (1.0 - wall) * 0.5);
          c *= 1.0 - 0.18 * uWet.x;
          diffuseColor.rgb = c;
        }`,
      );
  };
  return mat;
}
