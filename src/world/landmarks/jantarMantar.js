// Jantar Mantar (Jaipur). Facts: docs/LANDMARK_FACTS.md. Compound layout is approximate; instrument geometry follows the published forms.
//  Samrat Yantra: gnomon base 44 m, inclined 27 deg (= Jaipur latitude), 22.4 m wall + summit chhatri ~= 27 m; quadrants either side parallel
//  to the equatorial plane. Also: 2x Jai Prakash (hemispherical bowls), 2x Ram Yantra (open cylinders), 12x Rashivalaya (zodiac Samrats),
//  Laghu Samrat, Narivalaya, Dakshinottara Bhitti, Kranti Vritta, Dhruva Darshak Pattika.
// Local frame: x east, z south (north = -z), y up; origin at the compound centre.
import * as THREE from 'three';
import { MB, COL } from './kit.js';

const LAT = (26.9235 * Math.PI) / 180;
const S = Math.sin(LAT), C = Math.cos(LAT);

/** right-triangle wedge wall: base along z from zS (south, y=0) to zN (north), vertical edge at zN of height hN, thickness t (x) */
function gnomon(b, cx, zS, zN, hN, t, col, top = COL.limewash) {
  const x0 = cx - t / 2, x1 = cx + t / 2;
  const A = [zS, 0], B = [zN, 0], D = [zN, hN];
  const face = (x, nx, order) => {
    const ids = order.map((p) => b.v(x, p[1], p[0], nx, 0, 0, col));
    b.tri(ids[0], ids[1], ids[2]);
  };
  face(x1, 1, [A, B, D].reverse() && [D, B, A]); // east face (+x), CCW seen from +x
  face(x0, -1, [A, B, D]);
  // north vertical face (normal -z)
  const n0 = b.v(x0, 0, zN, 0, 0, -1, col), n1 = b.v(x1, 0, zN, 0, 0, -1, col), n2 = b.v(x1, hN, zN, 0, 0, -1, col), n3 = b.v(x0, hN, zN, 0, 0, -1, col);
  b.quad(n1, n0, n3, n2);
  // bottom
  const b0 = b.v(x0, 0, zS, 0, -1, 0, col), b1 = b.v(x1, 0, zS, 0, -1, 0, col), b2 = b.v(x1, 0, zN, 0, -1, 0, col), b3 = b.v(x0, 0, zN, 0, -1, 0, col);
  b.quad(b0, b3, b2, b1);
  // hypotenuse (top slope), normal up-and-south
  const sl = Math.hypot(zS - zN, hN), nz = (hN) / sl, ny = (zS - zN) / sl;
  const h0 = b.v(x0, 0, zS, 0, ny, nz, top, 0, 0), h1 = b.v(x1, 0, zS, 0, ny, nz, top, t, 0), h2 = b.v(x1, hN, zN, 0, ny, nz, top, t, sl), h3 = b.v(x0, hN, zN, 0, ny, nz, top, 0, sl);
  b.quad(h0, h1, h2, h3);
}

/** curved quadrant track + supporting mass, in the plane perpendicular to the gnomon axis. side = +1 east, -1 west */
function quadrant(b, cx, axisPt, R, side, width, col) {
  const a = [0, S, -C], t = [0, C, S]; // axis direction (toward the pole), and 'up-south' in-plane vector
  const N = 20;
  const arc = [];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * (Math.PI / 2);
    // direction in plane: cos(th) * (side*x) + sin(th) * (-t)
    arc.push([cx + side * R * Math.cos(th), axisPt[1] - R * Math.sin(th) * C, axisPt[2] - R * Math.sin(th) * S]);
  }
  for (let i = 0; i < N; i++) {
    const p = arc[i], q = arc[i + 1];
    // slab across the arc: offset along the axis by +-width/2
    const ph = [p[0], p[1] + a[1] * width / 2, p[2] + a[2] * width / 2], pl = [p[0], p[1] - a[1] * width / 2, p[2] - a[2] * width / 2];
    const qh = [q[0], q[1] + a[1] * width / 2, q[2] + a[2] * width / 2], ql = [q[0], q[1] - a[1] * width / 2, q[2] - a[2] * width / 2];
    // top surface (the graduated track); normal points toward the axis centre
    const nx = -side * Math.cos((i + 0.5) / N * Math.PI / 2), ny = C * Math.sin((i + 0.5) / N * Math.PI / 2), nz = S * Math.sin((i + 0.5) / N * Math.PI / 2);
    const ids = [pl, ql, qh, ph].map((v) => b.v(v[0], v[1], v[2], nx, ny, nz, COL.limewash));
    b.quad(ids[0], ids[1], ids[2], ids[3]);
    // supporting wall from the track down to the ground (solid masonry)
    const gnd = (v) => [v[0], 0, v[2]];
    for (const [u, w] of [[ph, qh], [pl, ql]]) {
      const side_n = u === ph ? 1 : -1;
      const nn = [0, a[1] * side_n, a[2] * side_n];
      const l = Math.hypot(...nn) || 1;
      const g0 = b.v(u[0], u[1], u[2], nn[0] / l, nn[1] / l, nn[2] / l, col), g1 = b.v(w[0], w[1], w[2], nn[0] / l, nn[1] / l, nn[2] / l, col);
      const g2 = b.v(...gnd(w), nn[0] / l, nn[1] / l, nn[2] / l, col), g3 = b.v(...gnd(u), nn[0] / l, nn[1] / l, nn[2] / l, col);
      if (side_n > 0) b.quad(g0, g3, g2, g1); else b.quad(g0, g1, g2, g3);
    }
  }
  // outer end cap wall
  const e = arc[0];
  b.box(e[0], 0, e[2] + 0, 0.9, e[1], width * 1.0, col);
}

function samrat(b, scale, cx, cz, withChhatri = true) {
  const baseHalf = 22 * scale, hN = 22.4 * scale;
  const zS = cz + baseHalf, zN = cz - baseHalf;
  // gnomon
  const sub = new MB();
  gnomon(sub, 0, baseHalf, -baseHalf, hN, 3.2 * scale, COL.pink);
  // translate into main builder
  appendTranslated(b, sub, cx, 0, cz);
  // stair band + rails along the hypotenuse
  const len = Math.hypot(44 * scale, hN);
  const ang = Math.atan2(hN, 44 * scale);
  // rails as thin slanted boxes sampled along the slope
  const steps = Math.floor(len / 1.6);
  for (let i = 0; i < steps; i++) {
    const tt = (i + 0.5) / steps;
    const z = zS + (zN - zS) * tt, y = hN * tt;
    b.box(cx - 1.35 * scale, y - 0.05, z, 0.35 * scale, 0.9 * scale, (len / steps) * 0.65, COL.limewash, 0);
    b.box(cx + 1.35 * scale, y - 0.05, z, 0.35 * scale, 0.9 * scale, (len / steps) * 0.65, COL.limewash, 0);
  }
  if (withChhatri) {
    const y = hN, z = zN + 1.5;
    b.box(cx, y, z, 4.6 * scale, 0.35 * scale, 4.6 * scale, COL.limewash);
    for (const [px, pz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) b.cyl(cx + px * scale, y + 0.35 * scale, z + pz * scale, 0.22 * scale, 0.2 * scale, 3.0 * scale, 8, COL.limewash);
    b.box(cx, y + 3.35 * scale, z, 4.8 * scale, 0.3 * scale, 4.8 * scale, COL.pink);
    b.dome(cx, y + 3.65 * scale, z, 2.3 * scale, 1.5 * scale, 12, 4, COL.pinkLight);
    b.cyl(cx, y + 5.1 * scale, z, 0.1 * scale, 0.03 * scale, 0.8 * scale, 6, COL.gold, false);
  }
  // quadrants
  const R = 15.5 * scale;
  const axisPt = [cx, R * C, zN + (hN - R * C) / Math.tan(LAT) + 0]; // axis point whose height = R*cos(lat)
  const yAxis = R * C;
  const zAxis = zN + (hN - yAxis) / Math.tan(LAT);
  for (const side of [-1, 1]) quadrant(b, cx + side * 1.6 * scale, [cx, yAxis, zAxis], R, side, 2.4 * scale, COL.pinkDeep);
  void axisPt;
}

function appendTranslated(dst, src, dx, dy, dz) {
  const base = dst.n;
  for (let i = 0; i < src.n; i++) {
    dst.pos.push(src.pos[3 * i] + dx, src.pos[3 * i + 1] + dy, src.pos[3 * i + 2] + dz);
    dst.nrm.push(src.nrm[3 * i], src.nrm[3 * i + 1], src.nrm[3 * i + 2]);
    dst.col.push(src.col[3 * i], src.col[3 * i + 1], src.col[3 * i + 2]);
    dst.uv.push(src.uv[2 * i], src.uv[2 * i + 1]);
  }
  for (const i of src.idx) dst.idx.push(base + i);
  dst.n += src.n;
}

function jaiPrakash(b, cx, cz) {
  const R = 5.4;
  b.cyl(cx, 0, cz, R + 0.5, R + 0.5, 1.5, 24, COL.pink, false);
  // ring top
  const seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c = [COL.limewash][0];
    const v = [[R + 0.5, 0], [R - 0.05, 0]].map(([r]) => r);
    const p0 = [cx + Math.cos(a0) * v[0], cz + Math.sin(a0) * v[0]], p1 = [cx + Math.cos(a1) * v[0], cz + Math.sin(a1) * v[0]];
    const q0 = [cx + Math.cos(a0) * v[1], cz + Math.sin(a0) * v[1]], q1 = [cx + Math.cos(a1) * v[1], cz + Math.sin(a1) * v[1]];
    const ids = [p0, p1, q1, q0].map((p) => b.v(p[0], 1.5, p[1], 0, 1, 0, c));
    b.quad(ids[0], ids[3], ids[2], ids[1]);
  }
  // hemispherical bowl (concave): inverted dome facing up
  const rings = 6;
  for (let k = 0; k < rings; k++) {
    const a0 = (k / rings) * (Math.PI / 2), a1 = ((k + 1) / rings) * (Math.PI / 2);
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
      const P = (a, t) => [cx + Math.cos(a) * Math.cos(t) * R, 1.5 - Math.sin(a) * R * 0.62 + R * 0.62 - R * 0.62, cz + Math.cos(a) * Math.sin(t) * R];
      const pts = [[a0, t0], [a0, t1], [a1, t1], [a1, t0]].map(([a, t]) => { const p = P(a, t); return [p[0], 1.5 - (1 - Math.sin(a)) * 0 - Math.sin(a) * R * 0.62 + R * 0.62 * 0 - 0, p[2], a, t]; });
      // depth: rim at a=0 (y=1.5) down to a=90deg (y = 1.5 - 0.62R)
      const ids = pts.map((p) => {
        const y = 1.5 - Math.sin(p[3]) * R * 0.62;
        const nx = -Math.cos(p[3]) * Math.cos(p[4]), ny = Math.sin(p[3]), nz = -Math.cos(p[3]) * Math.sin(p[4]);
        return b.v(p[0], y, p[2], nx, ny, nz, (i + k) % 2 ? COL.limewash : COL.cream);
      });
      b.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  // crossed wire supports (thin)
  b.box(cx, 1.5, cz, 2 * R, 0.05, 0.06, COL.dark);
  b.box(cx, 1.5, cz, 0.06, 0.05, 2 * R, COL.dark);
  // entry steps
  for (let i = 0; i < 5; i++) b.box(cx + R + 0.6 + i * 0.3, 0, cz, 0.6, 1.5 - i * 0.3, 2.0, COL.limewash);
}

function ramYantra(b, cx, cz) {
  const R = 4.6, H = 4.4;
  const seg = 28;
  for (let i = 0; i < seg; i++) {
    if (i % 7 === 0) continue; // openings for entry
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const ids = [[a0, 0], [a1, 0], [a1, H], [a0, H]].map(([a, y]) => b.v(cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2), COL.pink));
    b.quad(ids[0], ids[3], ids[2], ids[1]);
    const ids2 = [[a0, 0], [a1, 0], [a1, H], [a0, H]].map(([a, y]) => b.v(cx + Math.cos(a) * (R - 0.35), y, cz + Math.sin(a) * (R - 0.35), -Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2), COL.limewash));
    b.quad(ids2[0], ids2[1], ids2[2], ids2[3]);
  }
  b.cyl(cx, 0, cz, 0.42, 0.42, H, 10, COL.limewash);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box(cx + Math.cos(a) * (R * 0.55), 0, cz + Math.sin(a) * (R * 0.55), R * 0.9, 0.7 + (i % 3) * 0.1, 0.2, COL.limewash, -a);
  }
  b.cyl(cx, 0, cz, R - 0.3, R - 0.3, 0.25, 24, COL.cream);
}

export function buildJantarMantar(heroMat) {
  const g = new THREE.Group();
  g.name = 'JantarMantar';
  const b = new MB();
  // compound: low crenellated wall, 100 x 62 m, with paved floor
  const W = 100, D = 62;
  b.box(0, -0.02, 0, W, 0.16, D, COL.sand);
  for (const [x0, z0, x1, z1] of [[-W / 2, -D / 2, W / 2, -D / 2], [W / 2, -D / 2, W / 2, D / 2], [W / 2, D / 2, -W / 2, D / 2], [-W / 2, D / 2, -W / 2, -D / 2]]) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    b.box((x0 + x1) / 2, 0, (z0 + z1) / 2, Math.abs(dx) > Math.abs(dz) ? L : 1.0, 2.8, Math.abs(dx) > Math.abs(dz) ? 1.0 : L, COL.pinkDeep);
    b.merlons(x0, z0, x1, z1, 2.8, 0.5, 0.5, 0.45, 0.6, COL.limewash);
  }
  // Samrat Yantra (Vrihat) — the largest, gnomon axis N-S, west-central
  samrat(b, 1.0, -8, -1);
  // Laghu Samrat (smaller, ~1/3): east
  samrat(b, 0.36, 32, 6, true);
  // Jai Prakash Yantras (two bowls)
  jaiPrakash(b, 28, -18);
  jaiPrakash(b, 41, -8);
  // Ram Yantras (two open cylinders)
  ramYantra(b, -38, -16);
  ramYantra(b, -38, 12);
  // Rashivalaya: twelve small zodiac Samrats in a row
  for (let i = 0; i < 12; i++) {
    const sc = 0.15 + (i % 3) * 0.015;
    samrat(b, sc, 8 + i * 3.4 - 20, 24, false);
  }
  // Narivalaya: two drum dials
  for (const [x, z] of [[18, 19], [24, 19]]) { b.cyl(x, 0, z, 1.5, 1.5, 0.9, 20, COL.pink); b.cyl(x, 0.9, z, 1.35, 1.35, 0.06, 20, COL.limewash); b.box(x, 0.96, z, 0.06, 1.2, 0.06, COL.dark); }
  // Dakshinottara Bhitti (meridian wall) with a curved frame
  b.box(-16, 0, 16, 0.7, 5.2, 9.0, COL.pink);
  b.cyl(-16, 5.2, 16, 0.5, 0.5, 0.2, 12, COL.limewash);
  // Kranti Vritta, Dhruva Darshak Pattika, Kapali, Disha: stone plinths / arcs (simplified)
  for (const [x, z, s] of [[0, 20, 1.2], [-6, 22, 0.9], [12, -20, 1.1], [-25, -2, 1.0]]) { b.cyl(x, 0, z, s * 1.4, s * 1.2, 1.3, 16, COL.cream); b.cyl(x, 1.3, z, s * 1.0, s * 0.95, 0.15, 16, COL.limewash); }
  // entrance gate on the north wall
  b.box(0, 0, -D / 2 - 0.3, 8, 5.2, 1.6, COL.pink);
  b.archOpening(0, 0, -D / 2 + 0.55, 1, 0, 0, 1, 2.8, 3.6, COL.dark, true);
  const mesh = new THREE.Mesh(b.build(), heroMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  g.userData.samratHeightM = 22.4 + 4.6 * 0.35 + 3.0 + 1.5; // gnomon wall + chhatri (documented ~27 m)
  return g;
}
export const _parts = { gnomon, quadrant, jaiPrakash, ramYantra, samrat };
