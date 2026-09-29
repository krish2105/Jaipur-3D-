// Land cover from OSM polygons -> a small RGBA raster the terrain shader samples.
//   R built-up landuse (residential, commercial, industrial ...)
//   G vegetation (forest, wood, scrub, orchard, farmland ...)
//   B open water (lakes, reservoirs, ponds; ways AND multipolygon relations)
//   A parks / gardens / grass / sports pitches
// Only what OSM maps is painted; unmapped ground stays 0 and keeps the terrain's own shading. Nothing is inferred.
import { projectGeom, stitchRings, signedArea } from './osm-bake-lib.mjs';

export const COVER = { BUILT: 'built', VEG: 'veg', WATER: 'water', PARK: 'park' };
const CHANNEL = { [COVER.BUILT]: 0, [COVER.VEG]: 1, [COVER.WATER]: 2, [COVER.PARK]: 3 };

const BUILT = /^(residential|commercial|retail|industrial|institutional|construction|railway|garages|education|religious|military|brownfield|depot)$/;
const VEG = /^(forest|orchard|farmland|farmyard|vineyard|plant_nursery|greenhouse_horticulture|allotments)$/;
const PARKLU = /^(grass|meadow|recreation_ground|village_green|cemetery|flowerbed)$/;

/** the land-cover class of a tag set, or null (buildings, boundaries and everything that is not a surface are ignored) */
export function coverClass(t) {
  if (t.building || t['building:part'] || t.boundary || t.highway || t.barrier) return null;
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank' || t.natural === 'wetland') return COVER.WATER;
  if (/^(park|garden|pitch|playground|golf_course|stadium|track|dog_park|nature_reserve)$/.test(t.leisure || '') || PARKLU.test(t.landuse || '') || t.natural === 'grassland') return COVER.PARK;
  if (t.natural === 'wood' || t.natural === 'scrub' || t.natural === 'heath' || VEG.test(t.landuse || '')) return COVER.VEG;
  if (BUILT.test(t.landuse || '')) return COVER.BUILT;
  return null;
}

function closed(pts, tol = 3) {
  if (pts.length < 4) return null;
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) > tol) return null;
  return pts.slice(0, -1);
}

/** -> [{cls, rings:[[x,z]...]}] in world metres (outer and inner rings together; filled with the even-odd rule) */
export function extractLandcover(elements) {
  const out = [];
  for (const el of elements) {
    const t = el.tags;
    if (!t) continue;
    const cls = coverClass(t);
    if (!cls) continue;
    if (el.type === 'way' && el.geometry) {
      const r = closed(projectGeom(el.geometry));
      if (r && Math.abs(signedArea(r)) > 20) out.push({ cls, rings: [r] });
    } else if (el.type === 'relation' && el.members) {
      const outer = [], inner = [];
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        (m.role === 'inner' ? inner : outer).push(projectGeom(m.geometry));
      }
      const rings = stitchRings(outer).concat(stitchRings(inner));
      if (rings.length) out.push({ cls, rings });
    }
  }
  return out;
}

/**
 * @param {Array} polys from extractLandcover
 * @param {{x0:number, z0:number, w:number, h:number, texel:number}} g grid: origin (min corner, metres), size in texels, metres per texel
 * @returns {{data: Uint8Array}} RGBA, row 0 = z0 (north-most row first because z grows south); painted at texel centres
 */
export function rasterizeLandcover(polys, g) {
  const data = new Uint8Array(g.w * g.h * 4);
  for (const p of polys) {
    const ch = CHANNEL[p.cls];
    let zmin = 1e18, zmax = -1e18;
    for (const r of p.rings) for (const q of r) { if (q[1] < zmin) zmin = q[1]; if (q[1] > zmax) zmax = q[1]; }
    const j0 = Math.max(0, Math.floor((zmin - g.z0) / g.texel)), j1 = Math.min(g.h - 1, Math.floor((zmax - g.z0) / g.texel));
    for (let j = j0; j <= j1; j++) {
      const z = g.z0 + (j + 0.5) * g.texel;
      const xs = [];
      for (const r of p.rings) {
        for (let i = 0, n = r.length; i < n; i++) {
          const a = r[i], b = r[(i + 1) % n];
          if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.texel - 0.5)), i1 = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.x0) / g.texel - 0.5));
        for (let i = i0; i <= i1; i++) data[(j * g.w + i) * 4 + ch] = 255;
      }
    }
  }
  return { data };
}
