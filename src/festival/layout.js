// Decoration layout (pure: no three.js, node-testable): where street lamps, festival strings, roofline lights and diyas go.
//
//  DATA PROVENANCE (also documented in PROGRESS.md / README):
//   * REAL (OpenStreetMap): the street polylines and their names/classes/widths, and the building footprint edges the strings hang on.
//   * APPROX (modelling choice, NOT survey data): OSM has no street-lamp nodes in this area (0 instances), so lamps are generated along the
//     OSM roads at a nominal spacing; which bazaars are decorated, the colours and the bulb spacing are art direction. Nothing here claims to be
//     the real lamp or decoration positions of any year. Building heights (used for roofline lights) are the baked ones, 99 % inferred.
//
//  Outputs are flat typed arrays so the renderer can gather the nearest ones without allocating:
//   lamps   stride 3: x, z, yaw                         (pole arm points toward the road)
//   bulbs   stride 8: x, y, z, r, g, b, phase, kind     kind 0 string bulb, 1 roofline bulb, 2 diya
//   sources stride 7: x, z, r, g, b, radius(m), kind    aggregated light-grid sources (spans, roofline runs, diya runs)
import { mulberry32 } from '../core/rng.js';

/** decorated bazaars: the named markets on the OSM street graph. Theme 0 gold, 1 multicolour. */
export const FESTIVAL_STREETS = [
  { re: /johari/i, theme: 0 },
  { re: /hawa\s*(sadak|mahal)/i, theme: 0 },
  { re: /bapu\s*baz|nehru\s*baz/i, theme: 1 },
  { re: /tripolia/i, theme: 1 },
  { re: /chandpol|chandpole/i, theme: 1 },
  { re: /chaura\s*rasta/i, theme: 1 },
  { re: /ramganj|sanjay\s*baz|gangauri|kishanpol|sujrapol|ghat\s*darwaja|indira\s*baz/i, theme: 1 },
];
// only the elevated road is excluded: "Hawa sadak" is the ground-level Hawa Mahal road (the earlier /sadak/ filter dropped it by mistake; found in the photo review)
const EXCLUDE = /elevated|flyover/i;

// linear emissive colours (multiplied by an HDR gain in the shader)
export const PALETTE = {
  gold: [[1.0, 0.62, 0.16], [1.0, 0.78, 0.36], [1.0, 0.5, 0.08]],
  multi: [[1.0, 0.45, 0.04], [1.0, 0.06, 0.32], [0.16, 0.95, 0.3], [0.12, 0.42, 1.0], [1.0, 0.85, 0.5], [1.0, 0.05, 0.05], [0.6, 0.15, 1.0], [0.05, 0.85, 0.9]],
  diya: [[1.0, 0.5, 0.1], [1.0, 0.42, 0.06]],
};

export function streetTheme(name) {
  if (!name || EXCLUDE.test(name)) return null;
  for (const s of FESTIVAL_STREETS) if (s.re.test(name)) return s;
  return null;
}

const LAMP_CLASS = { motorway: 34, trunk: 30, primary: 28, secondary: 28, tertiary: 32, unclassified: 44, residential: 46, living_street: 50, motorway_link: 40, trunk_link: 40, primary_link: 36, secondary_link: 36, tertiary_link: 40 };
export const LAMP_HEIGHT = 5.1;

/** generated lamps along every lit road class within `radius` of (0, 0): alternating sides (both sides on wide roads), spacing per class */
export function planLamps(graph, opts = {}) {
  const radius = opts.radius ?? 3600;
  const rng = mulberry32(opts.seed ?? 41);
  const out = [];
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (let e = 0; e < graph.edgeCount; e++) {
    const sp = LAMP_CLASS[graph.cls[e]];
    if (!sp || graph.len[e] < 8) continue;
    const nm = graph.name[e];
    if (nm && EXCLUDE.test(nm)) continue;
    graph.pointAt(e, graph.len[e] * 0.5, p);
    if (Math.hypot(p.x, p.z) > radius) continue;
    const w = graph.width[e];
    const step = sp * (w > 12 ? 0.85 : 1);
    let s = step * (0.25 + 0.5 * rng()), side = rng() < 0.5 ? 1 : -1, k = 0;
    while (s < graph.len[e] - 3) {
      graph.pointAt(e, s, p);
      // pole sits just off the carriageway edge; the arm (+x of the model) points back toward the road centre
      const off = w * 0.5 + 0.7;
      const nx = -p.dz * side, nz = p.dx * side; // unit normal of the chosen side
      out.push(p.x + nx * off, p.z + nz * off, Math.atan2(nz, -nx));
      if (w > 12 && k % 2 === 0) out.push(p.x - nx * off, p.z - nz * off, Math.atan2(-nz, nx)); // wide road: a mirror pole opposite
      side = -side;
      k++;
      s += step * (0.8 + 0.4 * rng());
    }
  }
  return Float32Array.from(out);
}

/** point on a sagging span between two anchors (sag in metres at the middle) */
function swag(a, b, t, sag) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
}

function pickColor(mode, i, pal, rng, base) {
  if (mode === 0) return base;
  if (mode === 1) return i % 2 === 0 ? base : pal[(pal.indexOf(base) + 1) % pal.length];
  return pal[Math.floor(rng() * pal.length)];
}

/**
 * strings across the bazaars, roofline lights on the facades they hang on, and diyas at the wall bases.
 * @param {object} graph StreetGraph
 * @param {object} fp FootprintIndex
 * @param {(x:number, z:number)=>number} groundAt terrain height (m)
 * @param {{radius?:number, seed?:number, maxBulbs?:number}} opts radius: only streets within this distance of the origin
 */
export function planFestival(graph, fp, groundAt, opts = {}) {
  const radius = opts.radius ?? 1900;
  const maxBulbs = opts.maxBulbs ?? 60000;
  const rng = mulberry32(opts.seed ?? 8112);
  const bulbs = [];
  const sources = [];
  const spansOut = []; // x0 y0 z0 x1 y1 z1 sag theme (tests / debugging)
  const facades = new Map(); // seg -> street theme
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  const stats = { edges: 0, spans: 0, skippedOpen: 0, roofSegs: 0, diyaRuns: 0, bulbs: 0, sources: 0 };
  const room = () => bulbs.length / 8 < maxBulbs;

  for (let e = 0; e < graph.edgeCount; e++) {
    const th = streetTheme(graph.name[e]);
    if (!th || graph.len[e] < 10) continue;
    graph.pointAt(e, graph.len[e] * 0.5, p);
    if (Math.hypot(p.x, p.z) > radius) continue;
    stats.edges++;
    const w = graph.width[e];
    const reach = w * 0.5 + 14;
    let s = 4 + rng() * 8;
    while (s < graph.len[e] - 4 && room()) {
      graph.pointAt(e, s, p);
      // slightly skewed spans: real strings are never square to the street
      const skew = (rng() - 0.5) * 0.22;
      const c = Math.cos(skew), sn = Math.sin(skew);
      const ax = -p.dz * c - p.dx * sn, az = p.dx * c - p.dz * sn;
      const L = fp.raycast(p.x, p.z, ax, az, reach);
      const R = fp.raycast(p.x, p.z, -ax, -az, reach);
      s += 8 + rng() * 9;
      // a mapped facade on either side gets roofline lights / diyas even when the opposite side is unmapped; strings need BOTH walls
      if (L && !facades.has(L.seg)) facades.set(L.seg, th);
      if (R && !facades.has(R.seg)) facades.set(R.seg, th);
      if (!L || !R || L.t + R.t < 3.2 || L.t + R.t > 30) { stats.skippedOpen++; continue; }
      const yA = Math.min(L.h - 0.6, 5.4 + rng() * 2.6), yB = Math.min(R.h - 0.6, 5.4 + rng() * 2.6);
      if (yA < 3 || yB < 3) { stats.skippedOpen++; continue; }
      // anchors sit 0.15 m out from the wall, on the street side
      const A = [L.x - ax * 0.15, groundAt(L.x, L.z) + yA, L.z - az * 0.15];
      const B = [R.x + ax * 0.15, groundAt(R.x, R.z) + yB, R.z + az * 0.15];
      const span = Math.hypot(B[0] - A[0], B[2] - A[2]);
      const sag = span * (0.035 + rng() * 0.05);
      const pal = th.theme === 0 ? PALETTE.gold : PALETTE.multi;
      const mode = th.theme === 0 ? (rng() < 0.7 ? 0 : 2) : (rng() < 0.3 ? 0 : rng() < 0.5 ? 1 : 2);
      const base = pal[Math.floor(rng() * pal.length)];
      const strands = span > 7 && rng() < 0.45 ? 2 : 1; // some spans carry a second, lower strand
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let st = 0; st < strands; st++) {
        const A2 = [A[0], A[1] - st * 0.55, A[2]], B2 = [B[0], B[1] - st * 0.55, B[2]];
        const n = Math.max(6, Math.round(span / 0.55));
        let t = 0.012 + rng() * 0.02, i = 0;
        while (t < 0.99) {
          if (rng() > 0.07) { // 7 % dead bulbs
            const q = swag(A2, B2, t, sag + st * 0.12);
            const col = pickColor(mode, i, pal, rng, base);
            bulbs.push(q[0], q[1], q[2], col[0], col[1], col[2], rng(), 0);
            sr += col[0]; sg += col[1]; sb += col[2]; count++;
          }
          t += (0.7 + 0.6 * rng()) / n;
          i++;
        }
      }
      if (count) {
        const g = Math.min(1, count / 18);
        sources.push((A[0] + B[0]) / 2, (A[2] + B[2]) / 2, (sr / count) * g, (sg / count) * g, (sb / count) * g, 11 + span * 0.35, 0);
      }
      spansOut.push(A[0], A[1], A[2], B[0], B[1], B[2], sag, th.theme);
      stats.spans++;
    }
  }

  // roofline lights along the hit facades + diyas at their bases
  for (const [seg, th] of facades) {
    if (!room()) break;
    const x0 = fp.sx0[seg], z0 = fp.sz0[seg], x1 = fp.sx1[seg], z1 = fp.sz1[seg], h = fp.sh[seg];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 2.5 || len > 40) continue;
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const pal = th.theme === 0 ? PALETTE.gold : PALETTE.multi;
    const base = pal[Math.floor(rng() * pal.length)];
    const mode = th.theme === 0 ? 0 : rng() < 0.55 ? 1 : 2;
    if (rng() < 0.85) { // some frontages are left dark
      let sr = 0, sg = 0, sb = 0, count = 0, i = 0;
      for (let t = 0.3 + rng() * 0.4; t < len - 0.3; t += 0.55 + rng() * 0.25) {
        if (rng() < 0.06) { i++; continue; }
        const x = x0 + ux * t, z = z0 + uz * t;
        const col = pickColor(mode, i++, pal, rng, base);
        bulbs.push(x, groundAt(x, z) + h + 0.2, z, col[0], col[1], col[2], rng(), 1);
        sr += col[0]; sg += col[1]; sb += col[2]; count++;
      }
      if (count) {
        const g = Math.min(1, count / 22) * 0.8;
        sources.push((x0 + x1) / 2, (z0 + z1) / 2, (sr / count) * g, (sg / count) * g, (sb / count) * g, 9 + len * 0.3, 1);
        stats.roofSegs++;
      }
    }
    if (rng() < 0.55) { // diyas: low warm lights on the ground along the wall, on the open (street) side
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const nx = -uz, nz = ux;
      const sideSign = fp.raycast(mx + nx * 0.4, mz + nz * 0.4, nx, nz, 1.2) ? -1 : 1; // a wall right there means that side is the inside
      let count = 0;
      for (let t = 0.6 + rng() * 0.8; t < len - 0.5; t += 1.0 + rng() * 1.6) {
        const x = x0 + ux * t + nx * sideSign * (0.3 + rng() * 0.25), z = z0 + uz * t + nz * sideSign * (0.3 + rng() * 0.25);
        const col = PALETTE.diya[rng() < 0.5 ? 0 : 1];
        bulbs.push(x, groundAt(x, z) + 0.06, z, col[0], col[1], col[2], rng(), 2);
        count++;
      }
      if (count) {
        const g = Math.min(1, count / 8) * 0.55;
        sources.push(mx + nx * sideSign * 0.6, mz + nz * sideSign * 0.6, 1.0 * g, 0.5 * g, 0.12 * g, 5 + len * 0.25, 2);
        stats.diyaRuns++;
      }
    }
  }
  stats.bulbs = bulbs.length / 8;
  stats.sources = sources.length / 7;
  return { bulbs: Float32Array.from(bulbs), sources: Float32Array.from(sources), spans: Float32Array.from(spansOut), stats };
}
