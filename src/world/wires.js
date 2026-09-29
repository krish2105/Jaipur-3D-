// Overhead utility wires across the streets of a detail tile (the reference photos of every bazaar show them): a span from one facade to the
// other every ~30 m along a street that has buildings on both sides, with a sag, sometimes a second wire beside it.
// Pure function: safe in the tile worker and in node tests. Positions are APPROX (spacing, heights and sag are art direction; the streets and
// the facades they hang on are the real baked ones).
import { hash01 } from '../core/rng.js';

const DM = 10;
const WIRE_CLASSES = /^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$/;
const SEGS = 5; // line segments per span

const ringOf = (p) => { const r = new Array(p.length / 2); for (let i = 0; i < r.length; i++) r[i] = [p[2 * i] / DM, p[2 * i + 1] / DM]; return r; };
function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** grid of building outlines (tile-local metres) for "is there a facade here, and how tall" queries */
export function buildingGrid(bChunk, cell = 32) {
  const map = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (const rec of bChunk.b) {
    if (!rec.p || rec.p.length < 6 || rec.pt) continue;
    const ring = ringOf(rec.p);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const it = { ring, h: rec.h, x0, x1, z0, z1 };
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
        const k = key(cx, cz);
        let a = map.get(k);
        if (!a) map.set(k, (a = []));
        a.push(it);
      }
  }
  return {
    /** the building whose footprint contains (x,z), or null */
    at(x, z) {
      const a = map.get(key(Math.floor(x / cell), Math.floor(z / cell)));
      if (!a) return null;
      for (const it of a) if (x >= it.x0 && x <= it.x1 && z >= it.z0 && z <= it.z1 && inRing(x, z, it.ring)) return it;
      return null;
    },
  };
}

/**
 * @param {object} bChunk      baked building chunk of the tile ({t:[ix,iz], b:[...]}) (already without excluded landmark footprints)
 * @param {object} roadChunk   baked road chunk of the same tile ({w:[{p,w,c,n}]})
 * @param {(x:number,z:number)=>number} groundAt terrain height at tile-local metres
 * @param {{spacing?:number, maxVerts?:number}} opts
 * @returns {Float32Array} line-segment endpoints, x,y,z per vertex (tile-local metres, absolute height), pairs of vertices
 */
export function buildWires(bChunk, roadChunk, groundAt, { spacing = 30, maxVerts = 9000 } = {}) {
  const out = [];
  if (!bChunk || !bChunk.b || !bChunk.b.length || !roadChunk || !roadChunk.w) return new Float32Array(0);
  const grid = buildingGrid(bChunk);
  const tx = bChunk.t[0], tz = bChunk.t[1];
  let wayIdx = 0;
  for (const w of roadChunk.w) {
    wayIdx++;
    if (!WIRE_CLASSES.test(w.c) || !(w.w >= 4) || w.w > 18) continue;
    const hw = w.w / 2;
    const pts = ringOf(w.p);
    let acc = 0, next = hash01(wayIdx, tx * 7 + tz, 3) * spacing; // distance along this way of the next span
    for (let i = 0; i < pts.length - 1 && out.length / 3 < maxVerts; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
      while (next < acc + L && out.length / 3 < maxVerts) {
        const s = next - acc;
        next += spacing * (0.8 + 0.4 * hash01(wayIdx, i, 5 + Math.floor(next)));
        const px = ax + dx * s, pz = az + dz * s;
        // find the facade on each side within 14 m of the kerb (wide pavements)
        const side = (sgn) => {
          for (let o = hw + 0.2; o <= hw + 14; o += 0.5) {
            const b = grid.at(px + nx * sgn * o, pz + nz * sgn * o);
            if (b) return { o: o - 0.05, b };
          }
          return null;
        };
        const L1 = side(1), R1 = side(-1);
        if (!L1 || !R1) continue;
        const nWires = hash01(wayIdx, i, 11 + Math.floor(next)) < 0.55 ? 2 : 1;
        for (let k = 0; k < nWires; k++) {
          const lat = k * (0.3 + 0.25 * hash01(wayIdx, i, 17 + k)); // the second wire runs 0.3-0.55 m along the street from the first
          const cx = px + dx * lat, cz = pz + dz * lat;
          const ex0 = cx + nx * L1.o, ez0 = cz + nz * L1.o, ex1 = cx - nx * R1.o, ez1 = cz - nz * R1.o;
          const g0 = groundAt(ex0, ez0), g1 = groundAt(ex1, ez1);
          const top = 5.6 + 2.6 * hash01(wayIdx, i, 23 + k + Math.floor(next));
          const y0 = g0 + Math.max(3.2, Math.min(top, L1.b.h - 0.8));
          const y1 = g1 + Math.max(3.2, Math.min(top + 0.4 * (hash01(wayIdx, i, 29) - 0.5), R1.b.h - 0.8));
          const span = Math.hypot(ex1 - ex0, ez1 - ez0);
          const sag = Math.min(1.1, 0.03 * span + 0.15) * (0.7 + 0.6 * hash01(wayIdx, i, 31 + k));
          let px0 = ex0, py0 = y0, pz0 = ez0;
          for (let q = 1; q <= SEGS; q++) {
            const t = q / SEGS;
            const x = ex0 + (ex1 - ex0) * t, z = ez0 + (ez1 - ez0) * t, y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
            out.push(px0, py0, pz0, x, y, z);
            px0 = x; py0 = y; pz0 = z;
          }
        }
      }
      acc += L;
    }
  }
  return new Float32Array(out);
}
