// OSM (Overpass `out geom` JSON) -> tile-chunked, projected, quantised data for the app.
// Pure functions only (no I/O) so they can be unit-tested with tiny synthetic fixtures.
//
// Conventions
//  * World metres: x east, z south (three.js: -z is north). Chunk tiles are TILE m squares,
//    tile (ix,iz) covers x in [ix*TILE,(ix+1)*TILE), z in [iz*TILE,(iz+1)*TILE).
//  * Chunk coordinates are integer decimetres relative to the tile's min corner.
//  * Building outer rings are counter-clockwise seen from above (east right, north up).
import { project } from '../../src/core/geo.js';
import { hash01 } from '../../src/core/rng.js';

export const TILE = 500;
const DM = 10;

// ---------------------------------------------------------------------------------------------
// geometry helpers

export function projectGeom(geometry) {
  const out = [];
  for (const g of geometry || []) {
    if (!g || g.lat === undefined) continue;
    const p = project(g.lat, g.lon);
    out.push([p.x, p.z]);
  }
  return out;
}

/** Signed area with y = -z (north up). Positive => counter-clockwise seen from above. */
export function signedArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % n];
    a += x0 * -z1 - x1 * -z0;
  }
  return a / 2;
}

export function centroid(r) {
  let x = 0, z = 0, a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % n];
    const c = x0 * z1 - x1 * z0;
    a += c;
    x += (x0 + x1) * c;
    z += (z0 + z1) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of r) { sx += p[0]; sz += p[1]; }
    return [sx / r.length, sz / r.length];
  }
  return [x / (3 * a), z / (3 * a)];
}

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function dedupePoints(pts, eps = 0.05) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  return out;
}

function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

function dpOpen(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distPointSeg(pts[i], pts[s], pts[e]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker for a closed ring (ring has no repeated last point). */
export function simplifyRing(r, tol) {
  if (r.length <= 4 || tol <= 0) return r;
  // split at the point farthest from point 0
  let fi = 1, fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) { fd = d; fi = i; }
  }
  const a = dpOpen(r.slice(0, fi + 1), tol);
  const b = dpOpen(r.slice(fi).concat([r[0]]), tol);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : r;
}

/** Close nearly-closed rings, drop repeated last point, dedupe. Returns null if unusable. */
function cleanRing(pts, closeTol = 2) {
  let p = dedupePoints(pts);
  if (p.length < 3) return null;
  const first = p[0], last = p[p.length - 1];
  const gap = Math.hypot(first[0] - last[0], first[1] - last[1]);
  if (p.length >= 4 && gap <= closeTol) p = p.slice(0, -1);
  else if (gap > closeTol) return null;
  return p.length >= 3 ? p : null;
}

/** Join open way segments (arrays of [x,z] with exact-matching ends) into closed rings. */
export function stitchRings(segments, tol = 0.02) {
  const rings = [];
  const segs = segments.map((s) => s.slice()).filter((s) => s.length >= 2);
  const same = (a, b) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
  while (segs.length) {
    let cur = segs.pop();
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 10000) {
      const end = cur[cur.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < segs.length; i++) {
        if (same(segs[i][0], end)) { found = i; break; }
        if (same(segs[i][segs[i].length - 1], end)) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      const s = segs.splice(found, 1)[0];
      if (rev) s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (same(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(cur.slice(0, -1));
  }
  return rings;
}

// ---------------------------------------------------------------------------------------------
// tag parsing

export function parseLength(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres|ft|feet|')?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'ft' || m[2] === 'feet' || m[2] === "'") n *= 0.3048;
  return Number.isFinite(n) ? n : null;
}

export function parseInt0(v) {
  if (v == null) return 0;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const ROOF_MAP = { flat: 'f', gabled: 'g', hipped: 'h', pyramidal: 'p', dome: 'd', skillion: 's', half_hipped: 'h', gambrel: 'g', mansard: 'h', round: 'd', onion: 'd', cone: 'p' };

export function buildingClass(tags) {
  const b = tags.building || '';
  if (/^(temple|mosque|church|shrine|religious|chapel|synagogue|cathedral|gurdwara|monastery)$/.test(b) || tags.amenity === 'place_of_worship') return 'rel';
  if (tags.historic || /^(castle|palace|fort|monument|ruins|manor)$/.test(b) || /^(monument|castle|fort|palace|archaeological_site|city_gate|citywalls|memorial)$/.test(tags.historic || '')) return 'her';
  if (/^(garage|garages|shed|roof|hut|carport|kiosk|toilets|service|cabin|greenhouse|container|stable|cowshed|barn)$/.test(b)) return 'min';
  if (/^(retail|commercial|shop|supermarket|office|hotel|mall|market)$/.test(b) || tags.shop || tags.office) return 'com';
  if (/^(industrial|warehouse|factory|manufacture|storage_tank)$/.test(b)) return 'ind';
  if (/^(civic|public|government|school|hospital|university|college|kindergarten|train_station|transportation|stadium|fire_station)$/.test(b) || /^(school|college|university|hospital|clinic|police|townhall|courthouse|bus_station|library|theatre|cinema)$/.test(tags.amenity || '')) return 'pub';
  if (/^(residential|house|apartments|detached|terrace|dormitory|semidetached_house|bungalow|hut)$/.test(b)) return 'res';
  return 'oth';
}

const CLASS_PRIOR_H = { res: 8.5, com: 10.5, rel: 9, pub: 12, ind: 8, her: 14, min: 3.2, oth: 8.5 };

// ---------------------------------------------------------------------------------------------
// building extraction

/**
 * Turn raw elements into building records in world metres (not yet chunked).
 * Returns { buildings, parts } where each: { id, cls, rings:[outer, ...holes], tags-derived fields }.
 */
export function extractBuildings(elements) {
  const out = [];
  const consider = (id, tags, rings) => {
    const outers = [];
    const holes = [];
    for (const r of rings) {
      const c = cleanRing(r.pts);
      if (!c || Math.abs(signedArea(c)) < 2.5) continue;
      (r.role === 'inner' ? holes : outers).push(c);
    }
    for (const o of outers) {
      const myHoles = holes.filter((h) => pointInRing(h[0][0], h[0][1], o));
      const ring = signedArea(o) < 0 ? o.slice().reverse() : o;
      const hs = myHoles.map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h)); // holes clockwise
      out.push({ id, tags, outer: ring, holes: hs, part: !!tags['building:part'] && !tags.building });
    }
  };
  for (const el of elements) {
    const t = el.tags;
    if (!t || !(t.building || t['building:part'])) continue;
    if (t.building === 'no') continue;
    if (el.type === 'way' && el.geometry) {
      consider(`w${el.id}`, t, [{ role: 'outer', pts: projectGeom(el.geometry) }]);
    } else if (el.type === 'relation' && el.members) {
      const outerSegs = [], innerSegs = [];
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        const pts = projectGeom(m.geometry);
        (m.role === 'inner' ? innerSegs : outerSegs).push(pts);
      }
      const rings = stitchRings(outerSegs).map((pts) => ({ role: 'outer', pts: pts.concat([pts[0]]) }));
      for (const r of stitchRings(innerSegs)) rings.push({ role: 'inner', pts: r.concat([r[0]]) });
      consider(`r${el.id}`, t, rings);
    }
  }
  return out;
}

/** Spatial hash for neighbourhood queries. */
export class SpatialHash {
  constructor(cell = 60) {
    this.cell = cell;
    this.map = new Map();
  }
  _k(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(x, z, item) {
    const k = this._k(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(item);
  }
  query(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const a = this.map.get(this._k(cx, cz));
        if (a) for (const it of a) fn(it);
      }
  }
}

/**
 * Attach height, levels, roof, class, colour to each building. Missing heights are inferred from
 * the neighbourhood (weighted log-mean of known heights within radius) so nothing ends up a flat
 * box of arbitrary size: the runtime then adds parapets, cornices, roof furniture, per-floor
 * detail on top of this.
 */
export function inferHeights(bldgs, { zonePrior = 9.5, radius = 90 } = {}) {
  const known = new SpatialHash(60);
  for (const b of bldgs) {
    const t = b.tags;
    b.cls = buildingClass(t);
    b.area = Math.abs(signedArea(b.outer));
    const [cx, cz] = centroid(b.outer);
    b.cx = cx;
    b.cz = cz;
    let h = parseLength(t.height);
    let src = 0;
    if (h == null) {
      const lv = parseInt0(t['building:levels']);
      if (lv) { h = lv * 3.3 + parseInt0(t['roof:levels']) * 1.6; src = 1; }
    }
    if (h != null && h >= 1.5 && h <= 400) { b.h = h; b.src = src; known.add(cx, cz, b); }
    else { b.h = null; b.src = 2; }
    b.minH = parseLength(t.min_height) ?? (parseInt0(t['building:min_level']) * 3.3 || 0);
    b.levels = parseInt0(t['building:levels']);
    b.roof = ROOF_MAP[t['roof:shape']] || 'f';
    b.colour = /^#[0-9a-f]{6}$/i.test(t['building:colour'] || '') ? t['building:colour'].toLowerCase() : null;
    b.name = t.name || t['name:en'] || null;
  }
  for (const b of bldgs) {
    if (b.h != null) continue;
    let sw = 0, sl = 0, n = 0;
    known.query(b.cx, b.cz, radius, (o) => {
      if (o.cls === 'min') return;
      const d = Math.hypot(o.cx - b.cx, o.cz - b.cz);
      if (d > radius) return;
      const w = 1 / (d + 25);
      sw += w;
      sl += w * Math.log(o.h);
      n++;
    });
    const prior = CLASS_PRIOR_H[b.cls] ?? zonePrior;
    let h;
    if (sw > 0) {
      const local = Math.exp(sl / sw);
      const wl = Math.min(0.75, 0.25 + 0.05 * n);
      h = Math.exp(wl * Math.log(local) + (1 - wl) * Math.log(Math.max(prior, zonePrior * 0.6)));
    } else {
      h = (prior + zonePrior) / 2;
    }
    // footprint sanity: tiny sheds are single storey, big halls a little taller
    if (b.area < 25) h = Math.min(h, 4.2);
    else if (b.area < 60) h = Math.min(h, 7.5);
    if (b.cls === 'min') h = Math.min(h, 3.6);
    // deterministic jitter so neighbours are not identical, snapped to 0.1 m
    const j = 0.86 + 0.28 * hash01(parseInt(String(b.id).slice(1)) || 1, 7, 3);
    h = Math.max(3, Math.min(60, h * j));
    b.h = Math.round(h * 10) / 10;
  }
  return bldgs;
}

/** Drop outlines that have building:part children inside (OSM 3D convention). */
export function resolveParts(bldgs) {
  const partsHash = new SpatialHash(60);
  for (const b of bldgs) if (b.part) partsHash.add(b.cx ?? centroid(b.outer)[0], b.cz ?? centroid(b.outer)[1], b);
  for (const b of bldgs) {
    if (b.part) continue;
    let has = false;
    partsHash.query(b.cx, b.cz, Math.sqrt(b.area) + 30, (p) => {
      if (!has && pointInRing(p.cx, p.cz, b.outer)) has = true;
    });
    b.hasParts = has;
  }
  return bldgs.filter((b) => !b.hasParts);
}

// ---------------------------------------------------------------------------------------------
// tiling

export const tileOf = (x, z) => [Math.floor(x / TILE), Math.floor(z / TILE)];
export const tileKey = (ix, iz) => `${ix}_${iz}`;

const q = (v, o) => Math.round((v - o) * DM);

/** Encode ring as flat dm ints relative to tile origin. */
function encRing(r, ox, oz) {
  const a = new Array(r.length * 2);
  for (let i = 0; i < r.length; i++) { a[2 * i] = q(r[i][0], ox); a[2 * i + 1] = q(r[i][1], oz); }
  return a;
}

export function chunkBuildings(bldgs, { simplifyTol = 0.15, minArea = 6 } = {}) {
  const tiles = new Map();
  for (const b of bldgs) {
    if (b.area < minArea) continue;
    const [ix, iz] = tileOf(b.cx, b.cz);
    const k = tileKey(ix, iz);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { t: [ix, iz], s: TILE, b: [] }));
    const ox = ix * TILE, oz = iz * TILE;
    const outer = simplifyRing(b.outer, simplifyTol);
    const rec = {
      i: b.id,
      h: b.h,
      k: b.cls,
      s: b.src,
      p: encRing(outer, ox, oz),
    };
    if (b.minH) rec.m = Math.round(b.minH * 10) / 10;
    if (b.levels) rec.l = b.levels;
    if (b.roof !== 'f') rec.r = b.roof;
    if (b.holes.length) rec.q = b.holes.map((h) => encRing(simplifyRing(h, simplifyTol), ox, oz));
    if (b.name) rec.n = b.name;
    if (b.colour) rec.c = b.colour;
    if (b.part) rec.pt = 1;
    if (b.tags.wikidata) rec.w = b.tags.wikidata;
    t.b.push(rec);
  }
  return tiles;
}

// ---------------------------------------------------------------------------------------------
// roads + graph

export const ROAD_WIDTH = {
  motorway: 20, trunk: 16, primary: 14, secondary: 12, tertiary: 10, unclassified: 7, residential: 7,
  living_street: 5.5, service: 4.5, pedestrian: 6, footway: 2.5, path: 2, steps: 2, track: 4, cycleway: 2.5,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 6, road: 6, bridleway: 2, corridor: 2.5,
};
const CAR_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road']);
const SPEED_KMH = { motorway: 60, trunk: 50, primary: 40, secondary: 35, tertiary: 30, unclassified: 25, residential: 20, living_street: 10, service: 12, pedestrian: 5, footway: 5, path: 5, steps: 3, track: 15 };

export function extractHighways(elements) {
  const ways = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags || !el.tags.highway || !el.geometry) continue;
    const hw = el.tags.highway;
    if (/^(proposed|construction|abandoned|razed|platform|elevator)$/.test(hw)) continue;
    const pts = dedupePoints(projectGeom(el.geometry), 0.2);
    if (pts.length < 2) continue;
    const t = el.tags;
    let width = parseLength(t.width);
    if (!(width >= 1.2 && width <= 45)) width = null;
    const lanes = parseInt0(t.lanes);
    if (width == null) width = lanes ? Math.max(lanes * 3.1, ROAD_WIDTH[hw] || 5) : ROAD_WIDTH[hw] || 5;
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
    ways.push({
      id: el.id,
      cls: hw,
      width,
      lanes: lanes || Math.max(1, Math.round(width / 3.3)),
      name: t.name || t['name:en'] || null,
      pts: oneway === -1 ? pts.slice().reverse() : pts,
      nodes: el.nodes ? (oneway === -1 ? el.nodes.slice().reverse() : el.nodes) : null,
      oneway: oneway === 0 ? 0 : 1,
      bridge: !!t.bridge && t.bridge !== 'no',
      tunnel: !!t.tunnel && t.tunnel !== 'no',
      car: CAR_CLASSES.has(hw) && t.access !== 'no' && t.motor_vehicle !== 'no',
      maxspeed: parseInt0(t.maxspeed) || SPEED_KMH[hw] || 20,
      surface: t.surface || null,
      lit: t.lit === 'yes' ? 1 : 0,
    });
  }
  return ways;
}

/** Clip a polyline to tile cells; returns Map tileKey -> array of point arrays. */
export function clipPolylineToTiles(pts) {
  const runs = new Map();
  const push = (ix, iz, p) => {
    const k = tileKey(ix, iz);
    let arr = runs.get(k);
    if (!arr) runs.set(k, (arr = [[]]));
    const cur = arr[arr.length - 1];
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.01) cur.push(p);
  };
  const breakRun = (ix, iz) => {
    const arr = runs.get(tileKey(ix, iz));
    if (arr && arr[arr.length - 1].length) arr.push([]);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const ts = [0, 1];
    const dx = x1 - x0, dz = z1 - z0;
    if (dx !== 0) {
      const a = Math.floor(Math.min(x0, x1) / TILE) + 1, b = Math.floor(Math.max(x0, x1) / TILE);
      for (let k = a; k <= b; k++) { const t = (k * TILE - x0) / dx; if (t > 0 && t < 1) ts.push(t); }
    }
    if (dz !== 0) {
      const a = Math.floor(Math.min(z0, z1) / TILE) + 1, b = Math.floor(Math.max(z0, z1) / TILE);
      for (let k = a; k <= b; k++) { const t = (k * TILE - z0) / dz; if (t > 0 && t < 1) ts.push(t); }
    }
    ts.sort((a, b) => a - b);
    for (let s = 0; s < ts.length - 1; s++) {
      const ta = ts[s], tb = ts[s + 1];
      if (tb - ta < 1e-9) continue;
      const tm = (ta + tb) / 2;
      const [ix, iz] = tileOf(x0 + dx * tm, z0 + dz * tm);
      push(ix, iz, [x0 + dx * ta, z0 + dz * ta]);
      push(ix, iz, [x0 + dx * tb, z0 + dz * tb]);
    }
  }
  // (runs are contiguous per tile for simple monotone crossings; leave breaks unused)
  void breakRun;
  return runs;
}

export function chunkRoads(ways, { simplifyTol = 0.25 } = {}) {
  const tiles = new Map();
  for (const w of ways) {
    const pts = w.pts.length > 3 ? dpOpen(w.pts, simplifyTol) : w.pts;
    for (const [k, runs] of clipPolylineToTiles(pts)) {
      const [ix, iz] = k.split('_').map(Number);
      let t = tiles.get(k);
      if (!t) tiles.set(k, (t = { t: [ix, iz], s: TILE, w: [] }));
      for (const run of runs) {
        if (run.length < 2) continue;
        const rec = { c: w.cls, w: Math.round(w.width * 10) / 10, p: encRing(run, ix * TILE, iz * TILE) };
        if (w.name) rec.n = w.name;
        if (w.oneway) rec.o = 1;
        if (w.bridge) rec.b = 1;
        if (w.tunnel) rec.u = 1;
        if (w.lit) rec.l = 1;
        if (w.surface) rec.sf = w.surface;
        t.w.push(rec);
      }
    }
  }
  return tiles;
}

/**
 * Street graph. Nodes at OSM node ids used by >= 2 highway ways, at way ends, and at signals.
 * Coordinates are decimetre ints in world space (fits in 32-bit; JSON small).
 */
export function buildGraph(ways, signalKeys = new Set()) {
  const key = (w, i) => (w.nodes && w.nodes[i] != null ? `n${w.nodes[i]}` : `c${Math.round(w.pts[i][0] * 10)},${Math.round(w.pts[i][1] * 10)}`);
  const useCount = new Map();
  for (const w of ways) {
    if (w.bridge && false) continue;
    for (let i = 0; i < w.pts.length; i++) {
      const k = key(w, i);
      useCount.set(k, (useCount.get(k) || 0) + 1);
    }
  }
  const nodeIndex = new Map();
  const nodes = [];
  const nodeOf = (k, p) => {
    let n = nodeIndex.get(k);
    if (n === undefined) { n = nodes.length; nodeIndex.set(k, n); nodes.push([Math.round(p[0] * DM), Math.round(p[1] * DM), signalKeys.has(k) ? 1 : 0]); }
    return n;
  };
  const edges = [];
  for (const w of ways) {
    if (w.tunnel && !w.car) continue;
    let start = 0;
    for (let i = 1; i < w.pts.length; i++) {
      const isEnd = i === w.pts.length - 1;
      const k = key(w, i);
      if (isEnd || useCount.get(k) > 1 || signalKeys.has(k)) {
        const seg = w.pts.slice(start, i + 1);
        let len = 0;
        for (let s = 1; s < seg.length; s++) len += Math.hypot(seg[s][0] - seg[s - 1][0], seg[s][1] - seg[s - 1][1]);
        if (len > 0.5) {
          const a = nodeOf(key(w, start), w.pts[start]);
          const b = nodeOf(k, w.pts[i]);
          if (a !== b || len > 8) {
            const mid = seg.length > 2 ? dpOpen(seg, 0.6).slice(1, -1) : [];
            edges.push({
              a, b,
              len: Math.round(len * 10) / 10,
              c: w.cls,
              w: Math.round(w.width * 10) / 10,
              ln: w.lanes,
              v: w.maxspeed,
              o: w.oneway,
              car: w.car ? 1 : 0,
              mid: mid.length ? mid.map((p) => [Math.round(p[0] * DM), Math.round(p[1] * DM)]).flat() : undefined,
              n: w.name || undefined,
            });
          }
        }
        start = i;
      }
    }
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------------------------
// misc features

const WALL_HEIGHT = { city_wall: 6.5, wall: 2.6, retaining_wall: 2.5, fence: 1.5 };

export function extractMisc(elements) {
  const misc = { trees: [], lamps: [], signals: [], walls: [], water: [], green: [], places: [], shops: [], gates: [], landuse: [] };
  for (const el of elements) {
    const t = el.tags;
    if (!t) continue;
    if (el.type === 'node' && el.lat !== undefined) {
      const p = project(el.lat, el.lon);
      if (t.natural === 'tree') misc.trees.push([p.x, p.z]);
      else if (t.highway === 'street_lamp') misc.lamps.push([p.x, p.z]);
      else if (t.highway === 'traffic_signals') misc.signals.push({ id: el.id, x: p.x, z: p.z });
      else if (t.historic === 'city_gate' || t.historic === 'gate') misc.gates.push({ x: p.x, z: p.z, n: t.name || null });
      if (t.shop || t.amenity === 'marketplace') misc.shops.push({ x: p.x, z: p.z, k: t.shop || 'market', n: t.name || null });
      if (t.amenity === 'place_of_worship') misc.places.push({ x: p.x, z: p.z, k: t.religion || 'worship', n: t.name || null });
      continue;
    }
    if (el.type === 'way' && el.geometry) {
      const pts = projectGeom(el.geometry);
      if (pts.length < 2) continue;
      const wallKind = t.barrier && WALL_HEIGHT[t.barrier] ? t.barrier : /^(citywalls|city_wall)$/.test(t.historic || '') ? 'city_wall' : null;
      if (wallKind) {
        misc.walls.push({ k: wallKind, h: parseLength(t.height) || WALL_HEIGHT[wallKind], pts: dedupePoints(pts, 0.2), n: t.name || null });
        continue;
      }
      if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.water) {
        const r = cleanRing(pts, 3);
        if (r) misc.water.push({ pts: signedArea(r) < 0 ? r.slice().reverse() : r, n: t.name || null });
        continue;
      }
      if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.landuse === 'forest' || t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'meadow' || t.leisure === 'pitch') {
        const r = cleanRing(pts, 3);
        if (r) misc.green.push({ k: t.natural || t.landuse || t.leisure, pts: r });
        continue;
      }
      if (t.landuse && /^(residential|commercial|retail|industrial|farmland|cemetery|military|recreation_ground)$/.test(t.landuse)) {
        const r = cleanRing(pts, 3);
        if (r) misc.landuse.push({ k: t.landuse, pts: r });
      }
      if (t.amenity === 'place_of_worship') {
        const r = cleanRing(pts, 3);
        if (r) { const c = centroid(r); misc.places.push({ x: c[0], z: c[1], k: t.religion || 'worship', n: t.name || null }); }
      }
    }
  }
  return misc;
}

export function chunkMisc(misc) {
  const tiles = new Map();
  const get = (x, z) => {
    const [ix, iz] = tileOf(x, z);
    const k = tileKey(ix, iz);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { t: [ix, iz], s: TILE, trees: [], lamps: [], walls: [], water: [], green: [], places: [], shops: [] }));
    return [t, ix * TILE, iz * TILE];
  };
  for (const [x, z] of misc.trees) { const [t, ox, oz] = get(x, z); t.trees.push(q(x, ox), q(z, oz)); }
  for (const [x, z] of misc.lamps) { const [t, ox, oz] = get(x, z); t.lamps.push(q(x, ox), q(z, oz)); }
  for (const w of misc.walls) {
    for (const [k, runs] of clipPolylineToTiles(w.pts)) {
      const [ix, iz] = k.split('_').map(Number);
      const [t, ox, oz] = get(ix * TILE + 1, iz * TILE + 1);
      for (const run of runs) if (run.length > 1) t.walls.push({ k: w.k, h: w.h, p: encRing(run, ox, oz) });
    }
  }
  for (const w of misc.water) { const c = centroid(w.pts); const [t, ox, oz] = get(c[0], c[1]); t.water.push({ p: encRing(w.pts, ox, oz), o: [ox, oz] }); }
  for (const g of misc.green) { const c = centroid(g.pts); const [t, ox, oz] = get(c[0], c[1]); t.green.push({ k: g.k, p: encRing(g.pts, ox, oz) }); }
  for (const p of misc.places) { const [t, ox, oz] = get(p.x, p.z); t.places.push({ x: q(p.x, ox), z: q(p.z, oz), k: p.k, n: p.n }); }
  for (const s of misc.shops) { const [t, ox, oz] = get(s.x, s.z); t.shops.push({ x: q(s.x, ox), z: q(s.z, oz), k: s.k, n: s.n }); }
  return tiles;
}

// ---------------------------------------------------------------------------------------------
// landmark resolution from OSM names

export const LANDMARK_PATTERNS = {
  hawaMahal: /hawa\s*mahal/i,
  cityPalace: /city\s*palace/i,
  jantarMantar: /jantar\s*mantar/i,
  jalMahal: /jal\s*mahal/i,
  badiChaupar: /badi\s*chaupar/i,
  chhotiChaupar: /chh?oti\s*chaupar/i,
  johariBazaar: /johari\s*(bazaar|bazar)/i,
  chandpole: /chand\s*pole|chandpol/i,
  surajpole: /suraj\s*pole|surajpol/i,
  ajmeriGate: /ajmeri\s*gate/i,
  sanganeriGate: /sanganeri\s*gate/i,
  amerFort: /(amer|amber)\s*(fort|palace)/i,
  jaigarh: /jaigarh/i,
  nahargarh: /nahargarh/i,
  albertHall: /albert\s*hall/i,
  govindDevJi: /govind\s*dev/i,
  jamaMasjid: /jama\s*masjid/i,
};

/** Find OSM features whose name matches a landmark; returns { key: [{id,type,name,tags,x,z,ring?}] }. */
export function resolveLandmarks(elements) {
  const found = {};
  for (const el of elements) {
    const t = el.tags;
    if (!t) continue;
    const names = [t.name, t['name:en'], t.alt_name, t.old_name].filter(Boolean).join(' | ');
    if (!names) continue;
    for (const [key, re] of Object.entries(LANDMARK_PATTERNS)) {
      if (!re.test(names)) continue;
      let x, z, ring = null;
      if (el.type === 'node' && el.lat !== undefined) { const p = project(el.lat, el.lon); x = p.x; z = p.z; }
      else if (el.type === 'way' && el.geometry) {
        const pts = projectGeom(el.geometry);
        if (pts.length < 2) continue;
        const c = pts.length > 3 ? centroid(pts.slice(0, -1)) : pts[0];
        x = c[0]; z = c[1];
        if (pts.length >= 4) ring = pts;
      } else if (el.type === 'relation' && el.members) {
        const all = [];
        for (const m of el.members) if (m.geometry) all.push(...projectGeom(m.geometry));
        if (!all.length) continue;
        x = all.reduce((s, p) => s + p[0], 0) / all.length;
        z = all.reduce((s, p) => s + p[1], 0) / all.length;
      } else continue;
      (found[key] ||= []).push({ id: `${el.type[0]}${el.id}`, type: el.type, name: t.name || t['name:en'], x: +x.toFixed(1), z: +z.toFixed(1), kind: t.tourism || t.historic || t.amenity || t.building || t.highway || t.place || null, ring: ring ? ring.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]) : undefined });
    }
  }
  return found;
}
