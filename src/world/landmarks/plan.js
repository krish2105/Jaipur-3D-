// Pure planning for hand-modelled landmarks (no three.js, safe in tests and workers):
//  * where each landmark goes and how it is rotated, taken from the baked OSM footprints when present
//  * which OSM building footprints must be suppressed because the hand-built model replaces them
import { project } from '../../core/geo.js';

/** Fallback positions (docs/LANDMARK_FACTS.md) used only when OSM has no matching feature. */
export const FALLBACK_LATLON = {
  hawaMahal: [26.9239, 75.8267],
  jantarMantar: [26.92472, 75.82444],
  jalMahal: [26.9537, 75.8463],
  cityPalace: [26.9257, 75.8236],
};

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function convexHull(pts) {
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/**
 * Minimum-area oriented bounding rectangle of a ring (metres, x east / z south).
 * Returns { cx, cz, ux, uz, len, dep }: (ux,uz) is the unit vector along the LONG side, len >= dep.
 */
export function orientedBox(ring) {
  const hull = convexHull(ring);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    const ux = dx / l, uz = dz / l, vx = -uz, vz = ux;
    let u0 = 1e18, u1 = -1e18, v0 = 1e18, v1 = -1e18;
    for (const q of hull) {
      const u = q[0] * ux + q[1] * uz, v = q[0] * vx + q[1] * vz;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, vx, vz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const cu = (best.u0 + best.u1) / 2, cv = (best.v0 + best.v1) / 2;
  const cx = cu * best.ux + cv * best.vx, cz = cu * best.uz + cv * best.vz;
  const lu = best.u1 - best.u0, lv = best.v1 - best.v0;
  if (lu >= lv) return { cx, cz, ux: best.ux, uz: best.uz, len: lu, dep: lv };
  return { cx, cz, ux: best.vx, uz: best.vz, len: lv, dep: lu };
}

/**
 * Yaw (rotation about +Y, three.js convention) that turns a model's local +z axis into the horizontal direction (nx, nz).
 * In three.js a rotation by t about Y maps local +z to (sin t, 0, cos t).
 */
export function yawForNormal(nx, nz) {
  return Math.atan2(nx, nz);
}

/** The unit normal of an oriented box's long side that points most toward (tx, tz) (e.g. east = [1, 0]). */
export function facingNormal(box, tx, tz) {
  let nx = -box.uz, nz = box.ux;
  if (nx * tx + nz * tz < 0) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

function best(manifest, key) {
  const c = manifest?.landmarks?.[key];
  return c && c.length ? c[0] : null;
}

/**
 * Where does a landmark stand? OSM first (ring -> oriented box), fallback to the sourced coordinate.
 * @returns {{key, source:'osm'|'fallback', id?:string, x:number, z:number, ring?:number[][], box?:object}|null}
 */
export function locate(manifest, key) {
  const f = best(manifest, key);
  if (f) {
    const ring = f.ring && f.ring.length >= 4 ? f.ring.slice(0, -1) : null;
    const box = ring ? orientedBox(ring) : null;
    return { key, source: 'osm', id: f.id, name: f.name, x: box ? box.cx : f.x, z: box ? box.cz : f.z, ring, box };
  }
  const fb = FALLBACK_LATLON[key];
  if (!fb) return null;
  const p = project(fb[0], fb[1]);
  return { key, source: 'fallback', x: p.x, z: p.z, ring: null, box: null };
}

/**
 * Footprints the models replace. `discs` are the radius fallback (used when no OSM ring exists).
 * Buildings whose centre falls inside an inflated ring, or inside a disc, are dropped by the tile worker; `ids` are dropped outright.
 */
export function buildExclusion(placements, { margin = 3, discRadius = {} } = {}) {
  const ids = new Set();
  const rings = [];
  const discs = [];
  for (const p of placements) {
    if (!p) continue;
    if (p.id) ids.add(p.id);
    if (p.ring) rings.push(inflateRing(p.ring, margin));
    else discs.push({ x: p.x, z: p.z, r: discRadius[p.key] ?? 40 });
  }
  return { ids: [...ids], rings, discs };
}

/** grow a ring outward by t metres about its centroid (adequate for the compact, convex-ish footprints used here) */
export function inflateRing(r, t) {
  let cx = 0, cz = 0;
  for (const p of r) { cx += p[0]; cz += p[1]; }
  cx /= r.length; cz /= r.length;
  return r.map(([x, z]) => {
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * t, z + (dz / l) * t];
  });
}

/** Should a baked building record (tile-local dm ring `p`, id `i`) be dropped? `ox,oz` is the tile origin in metres. */
export function isExcluded(rec, ox, oz, ex) {
  if (!ex) return false;
  if (ex.ids.length && ex.ids.includes(rec.i)) return true;
  const p = rec.p;
  let cx = 0, cz = 0;
  const n = p.length / 2;
  for (let k = 0; k < p.length; k += 2) { cx += p[k]; cz += p[k + 1]; }
  cx = ox + cx / n / 10; cz = oz + cz / n / 10;
  for (const r of ex.rings) if (pointInRing(cx, cz, r)) return true;
  for (const d of ex.discs) if (Math.hypot(cx - d.x, cz - d.z) < d.r) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------------
// OSM-derived poses (manifest.sites) and footprint-overlap suppression

/** rectangle (ring, CCW-agnostic) with centre (cx,cz), long axis (ux,uz), size len x dep */
export function rectRing(cx, cz, ux, uz, len, dep) {
  const vx = -uz, vz = ux, a = len / 2, b = dep / 2;
  return [[cx - ux * a - vx * b, cz - uz * a - vz * b], [cx + ux * a - vx * b, cz + uz * a - vz * b], [cx + ux * a + vx * b, cz + uz * a + vz * b], [cx - ux * a + vx * b, cz - uz * a + vz * b]];
}

/**
 * Hawa Mahal pose. The facade is the EAST face of the block containing the OSM node (docs/LANDMARK_FACTS.md: the celebrated
 * facade is the eastern one and is the palace's back). Returns the facade centre point F on the block's east edge (at the node's
 * position along the facade), the outward normal n (pointing east, onto the street) and the yaw that maps model +z to n.
 * Falls back to the node/fallback point facing east when no enclosing polygon is known.
 */
export function hawaPose(manifest) {
  const s = manifest?.sites?.hawaMahal;
  if (s && s.block) {
    const b = s.block.box;
    const box = { cx: b.cx, cz: b.cz, ux: b.ux, uz: b.uz, len: b.len, dep: b.dep };
    const [nx, nz] = facingNormal(box, 1, 0);
    const dn = (s.node.x - box.cx) * nx + (s.node.z - box.cz) * nz; // node's offset along the normal
    const t = Math.max(0, box.dep / 2 - dn);
    return { source: 'osm', x: s.node.x + nx * t, z: s.node.z + nz * t, nx, nz, yaw: yawForNormal(nx, nz), blockId: s.block.id, blockBox: box };
  }
  const l = locate(manifest, 'hawaMahal');
  if (!l) return null;
  return { source: l.source, x: l.x, z: l.z, nx: 1, nz: 0, yaw: yawForNormal(1, 0), blockId: null, blockBox: null };
}

/** Fraction (0..1) of a ring's area that lies inside `foot`, estimated on an n x n grid over the ring's bounding box. */
export function coverFraction(ring, foot, n = 7) {
  let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
  for (const [x, z] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  let inRing = 0, both = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0), z = z0 + ((j + 0.5) / n) * (z1 - z0);
    if (!pointInRing(x, z, ring)) continue;
    inRing++;
    if (pointInRing(x, z, foot)) both++;
  }
  return inRing ? both / inRing : 0;
}

/**
 * Footprint-overlap exclusion: buildings whose area is mostly (>= minFrac) under a model's footprint are dropped, while a large
 * neighbouring block that merely touches the model is kept. Add to an exclusion object built by buildExclusion().
 */
export function addFootprints(ex, foots, minFrac = 0.6) {
  ex.foots = (ex.foots || []).concat(foots.filter(Boolean).map((ring) => ({ ring, minFrac })));
  return ex;
}

/** isExcluded() extended with footprint overlap (rec.p is the tile-local dm ring, ox/oz the tile origin in metres). */
export function isExcludedFull(rec, ox, oz, ex) {
  if (!ex) return false;
  if (isExcluded(rec, ox, oz, ex)) return true;
  if (!ex.foots || !ex.foots.length) return false;
  const p = rec.p, ring = new Array(p.length / 2);
  for (let k = 0; k < ring.length; k++) ring[k] = [ox + p[2 * k] / 10, oz + p[2 * k + 1] / 10];
  for (const f of ex.foots) if (coverFraction(ring, f.ring) >= f.minFrac) return true;
  return false;
}
