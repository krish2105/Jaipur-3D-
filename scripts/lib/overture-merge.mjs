// Overture Maps building footprints (real, ODbL) -> building records the OSM baker understands.
// Pure and browser-safe (no fs). The input lines come from scripts/fetch-overture.mjs and are ONLY footprints that are not
// already OpenStreetMap buildings (Google Open Buildings, Microsoft ML Buildings); this fills the gaps OSM has in the dense
// bazaar blocks. Nothing here invents a building: every record is a real footprint and is dropped when it duplicates an OSM
// footprint, sits on a street, or is too small to be a building. Heights stay "inferred" unless Overture carries one.
import { project } from '../../src/core/geo.js';
import { signedArea, centroid, pointInRing } from './osm-bake-lib.mjs';

const SUBTYPE_BUILDING = {
  religious: 'religious', commercial: 'commercial', education: 'school', civic: 'civic', industrial: 'industrial', residential: 'residential',
  medical: 'hospital', outbuilding: 'shed', agricultural: 'barn', service: 'service', transportation: 'transportation', entertainment: 'commercial', military: 'yes',
};

/** Overture class/subtype -> the OSM-style tags the baker already maps to a building class. */
export function overtureTags(o) {
  const cls = o.cls && /^[a-z_]+$/.test(o.cls) ? o.cls : null;
  const t = { building: cls || SUBTYPE_BUILDING[o.subtype] || 'yes' };
  if (o.height > 1.5 && o.height <= 400) t.height = String(o.height);
  else if (o.floors > 0 && o.floors < 100) t['building:levels'] = String(o.floors);
  if (o.roof) t['roof:shape'] = o.roof;
  if (o.name) t.name = o.name;
  return t;
}

/** Stable numeric id from the Overture GERS id (FNV-1a), so a rebake of the same release gives the same ids. */
export function overtureId(gers) {
  let h = 2166136261;
  const s = String(gers);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `o${h >>> 0}`;
}

function ringFromCoords(coords) {
  const pts = [];
  for (const c of coords) {
    const p = project(c[1], c[0]);
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q[0], p.z - q[1]) > 0.05) pts.push([p.x, p.z]);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.05) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** GeoJSON Polygon / MultiPolygon -> [{ outer (CCW seen from above), holes (CW) }] in world metres. */
export function polygonsFromGeoJSON(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const out = [];
  for (const rings of polys) {
    let outer = rings[0] && ringFromCoords(rings[0]);
    if (!outer) continue;
    if (signedArea(outer) < 0) outer = outer.slice().reverse();
    const holes = [];
    for (let i = 1; i < rings.length; i++) {
      let h = ringFromCoords(rings[i]);
      if (!h || Math.abs(signedArea(h)) < 2.5) continue;
      if (signedArea(h) > 0) h = h.slice().reverse();
      holes.push(h);
    }
    out.push({ outer, holes });
  }
  return out;
}

const bounds = (r) => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return [x0, z0, x1, z1];
};

/** Uniform grid over bounding boxes: items are visited once per query, in insertion order (deterministic). */
class BoxGrid {
  constructor(cell = 40) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  _k(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(item, x0, z0, x1, z1) {
    const c = this.cell;
    item._s = 0;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++)
      for (let cz = Math.floor(z0 / c); cz <= Math.floor(z1 / c); cz++) {
        const k = this._k(cx, cz);
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(item);
      }
  }
  query(x0, z0, x1, z1, fn) {
    const c = this.cell, st = ++this.stamp;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++)
      for (let cz = Math.floor(z0 / c); cz <= Math.floor(z1 / c); cz++) {
        const a = this.map.get(this._k(cx, cz));
        if (!a) continue;
        for (const it of a) {
          if (it._s === st) continue;
          it._s = st;
          fn(it);
        }
      }
  }
}

const NARROW = /^(footway|path|steps|cycleway|corridor|bridleway|track|elevator|platform|proposed|construction)$/;

/**
 * Build the "is this spot already taken" index: OSM building footprints (incl. wall solids) and street corridors.
 * @param {object[]} osm    building records ({outer, holes, area, cx, cz}) already baked from OSM
 * @param {object[]} roads  highway ways from extractHighways ({pts, width, cls, bridge, tunnel})
 */
export function buildOccupancy(osm, roads) {
  const bGrid = new BoxGrid(40);
  for (const b of osm) {
    const [x0, z0, x1, z1] = bounds(b.outer);
    bGrid.add({ b, x0, z0, x1, z1 }, x0, z0, x1, z1);
  }
  const rGrid = new BoxGrid(30);
  for (const w of roads) {
    if (NARROW.test(w.cls) || w.bridge || w.tunnel) continue;
    const hw = w.width / 2;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], c = w.pts[i + 1];
      rGrid.add({ ax: a[0], az: a[1], bx: c[0], bz: c[1], hw }, Math.min(a[0], c[0]) - hw, Math.min(a[1], c[1]) - hw, Math.max(a[0], c[0]) + hw, Math.max(a[1], c[1]) + hw);
    }
  }
  return {
    /** is (x,z) inside an OSM footprint (and not in one of its courtyards)? */
    inOsm(x, z) {
      let hit = false;
      bGrid.query(x, z, x, z, (e) => {
        if (hit || x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) return;
        if (pointInRing(x, z, e.b.outer) && !(e.b.holes || []).some((h) => pointInRing(x, z, h))) hit = true;
      });
      return hit;
    },
    /** distance from (x,z) to the nearest street CENTRELINE among segments within `reach` (a building that reaches the centreline is wrong whatever the guessed width) */
    centreDist(x, z, reach = 3) {
      let best = 1e9;
      rGrid.query(x - reach, z - reach, x + reach, z + reach, (s) => {
        const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
        let t = l2 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz));
        if (d < best) best = d;
      });
      return best;
    },
    /** distance from (x,z) to the nearest street edge (negative = inside the carriageway), among segments within `reach`. */
    roadClearance(x, z, reach = 8) {
      let best = 1e9;
      rGrid.query(x - reach, z - reach, x + reach, z + reach, (s) => {
        const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
        let t = l2 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz)) - s.hw;
        if (d < best) best = d;
      });
      return best;
    },
  };
}

/** Interior sample points of a footprint on a regular grid (at least one point; the centroid for slivers). */
export function samplePoints(outer, holes, area, max = 96) {
  const [x0, z0, x1, z1] = bounds(outer);
  const step = Math.max(1.2, Math.sqrt(area / max));
  const pts = [];
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let z = z0 + step / 2; z < z1; z += step) {
      if (!pointInRing(x, z, outer) || holes.some((h) => pointInRing(x, z, h))) continue;
      pts.push([x, z]);
    }
  if (!pts.length) pts.push(centroid(outer));
  return pts;
}

/**
 * Convert Overture JSON-lines records into building records, dropping the ones OSM already has or that sit on a street.
 * @param {object[]} lines  parsed lines from data-raw/overture/buildings.jsonl ({id,name,height,floors,cls,subtype,roof,geom})
 * @param {{osm:object[], roads:object[]}} ctx
 * @returns {{ buildings: object[], stats: object }}
 */
export function mergeOverture(lines, { osm, roads }, { minArea = 10, dupFrac = 0.2, roadFrac = 0.3, centreClear = 1.0, simplify = 0.45 } = {}) {
  const occ = buildOccupancy(osm, roads);
  const stats = { input: lines.length, polygons: 0, kept: 0, dropped: { geometry: 0, small: 0, duplicateOfOsm: 0, onStreet: 0 } };
  const out = [];
  const seen = new Set();
  for (const o of lines) {
    let geom = o.geom;
    if (typeof geom === 'string') { try { geom = JSON.parse(geom); } catch { geom = null; } }
    const polys = geom ? polygonsFromGeoJSON(geom) : [];
    if (!polys.length) { stats.dropped.geometry++; continue; }
    const tags = overtureTags(o);
    let part = 0;
    for (const { outer, holes } of polys) {
      stats.polygons++;
      const area = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
      if (!(area >= minArea)) { stats.dropped.small++; continue; }
      const pts = samplePoints(outer, holes, area);
      let inOsm = 0, onRoad = 0, onCentre = false;
      for (const [x, z] of pts) {
        if (occ.inOsm(x, z)) inOsm++;
        if (occ.roadClearance(x, z) < -0.3) onRoad++;
      }
      // outline points too (a thin strip across a street can slip between the interior samples)
      for (let i = 0; i < outer.length && !onCentre; i++) {
        const a = outer[i], b = outer[(i + 1) % outer.length];
        if (occ.centreDist(a[0], a[1]) < centreClear || occ.centreDist((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) < centreClear) onCentre = true;
      }
      for (let i = 0; i < pts.length && !onCentre; i++) if (occ.centreDist(pts[i][0], pts[i][1]) < centreClear) onCentre = true;
      if (inOsm / pts.length >= dupFrac) { stats.dropped.duplicateOfOsm++; continue; }
      if (onCentre || onRoad / pts.length >= roadFrac) { stats.dropped.onStreet++; continue; }
      const [cx, cz] = centroid(outer);
      const id = overtureId(o.id) + (part ? `_${part}` : '');
      part++;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, tags, outer, holes, part: false, area, cx, cz, ov: true, simplify });
    }
  }
  stats.kept = out.length;
  return { buildings: out, stats };
}
