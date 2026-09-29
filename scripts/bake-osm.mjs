// Bake raw Overpass JSON (data-raw/osm/*.json, from `npm run fetch:osm`) into the static,
// tile-chunked files the app streams:
//   public/data/osm/manifest.json
//   public/data/osm/b_<ix>_<iz>.json   buildings (heights inferred, rings in dm relative to tile)
//   public/data/osm/r_<ix>_<iz>.json   roads (clipped to tile)
//   public/data/osm/m_<ix>_<iz>.json   misc: trees, lamps, walls, water, green, places, shops
//   public/data/osm/graph.json         street graph for the traffic worker
// Refuses to run when there is no raw data (never fabricates any).
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RAW_DIR } from './lib/net.mjs';
import { bakeElements } from './lib/bake-elements.mjs';
export { bakeElements };
import { ZONES } from './lib/osm-zones.mjs';
import { project } from '../src/core/geo.js';
import { extractLandcover, rasterizeLandcover } from './lib/landcover.mjs';
import { centroid } from './lib/osm-bake-lib.mjs';


const RAW = path.join(RAW_DIR, 'osm');
const OUT = path.resolve(process.env.OSM_OUT || 'public/data/osm');

export async function loadElements(dir) {
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  if (!files.length) return null;
  const byKey = new Map();
  let osmBase = null;
  const zoneOf = new Map();
  for (const f of files.sort()) {
    const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    osmBase = j.osm_base || osmBase;
    for (const el of j.elements || []) {
      const k = `${el.type}/${el.id}`;
      if (!byKey.has(k)) { byKey.set(k, el); zoneOf.set(k, j.zone); }
    }
  }
  return { elements: [...byKey.values()], zoneOf, osmBase, files: files.length };
}

/** grid covering every fetch zone (projected, +150 m margin), aligned to whole texels */
function coverGrid(texel = 10) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const zn of ZONES) for (const [lat, lon] of [[zn.bbox[0], zn.bbox[1]], [zn.bbox[0], zn.bbox[3]], [zn.bbox[2], zn.bbox[1]], [zn.bbox[2], zn.bbox[3]]]) {
    const p = project(lat, lon);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  x0 = Math.floor((x0 - 150) / texel) * texel; z0 = Math.floor((z0 - 150) / texel) * texel;
  return { x0, z0, w: Math.ceil((x1 + 150 - x0) / texel), h: Math.ceil((z1 + 150 - z0) / texel), texel };
}

function inBBox(x, z, bbox) {
  const a = project(bbox[0], bbox[1]), b = project(bbox[2], bbox[3]);
  return x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && z >= Math.min(a.z, b.z) && z <= Math.max(a.z, b.z);
}

export async function bake({ rawDir = RAW, outDir = OUT, quiet = false } = {}) {
  const loaded = await loadElements(rawDir);
  if (!loaded) {
    throw Object.assign(new Error(`No raw OSM data in ${rawDir}. Run "npm run fetch:osm" first (needs overpass-api.de to be reachable). Nothing was baked; no data is fabricated.`), { code: 'NO_RAW' });
  }
  const log = quiet ? () => {} : console.log;
  log(`loaded ${loaded.elements.length} unique OSM elements from ${loaded.files} file(s)`);
  const { files, manifest } = bakeElements(loaded.elements, { osmBase: loaded.osmBase, log });
  // land cover raster over the union of the fetch zones (10 m texels), raw RGBA: R built-up, G vegetation, B water, A parks
  const grid = coverGrid();
  const polys = extractLandcover(loaded.elements);
  const cover = rasterizeLandcover(polys, grid);
  let painted = [0, 0, 0, 0];
  for (let i = 0; i < cover.data.length; i += 4) for (let c = 0; c < 4; c++) if (cover.data[i + c]) painted[c]++;
  const coverGz = gzipSync(Buffer.from(cover.data.buffer), { level: 9 });
  manifest.cover = { file: 'cover.dat', encoding: 'gzip', format: 'rgba8 (gzip), row 0 = north-most (z0), texel centres; R built-up G vegetation B water A parks', ...grid, bytesGz: coverGz.length, polygons: polys.length, paintedTexels: { built: painted[0], veg: painted[1], water: painted[2], park: painted[3] } };
  log(`land cover: ${polys.length} polygons on a ${grid.w}x${grid.h} grid (${grid.texel} m); painted texels built ${painted[0]}, vegetation ${painted[1]}, water ${painted[2]}, parks ${painted[3]}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'cover.dat'), coverGz);
  let bytes = 0;
  for (const [name, obj] of files) { const s = JSON.stringify(obj); bytes += s.length; await writeFile(path.join(outDir, name), s); }
  log(`wrote ${Object.keys(manifest.tiles).length} tiles, ~${(bytes / 1e6).toFixed(2)} MB raw JSON to ${outDir}`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bake().catch((e) => {
    console.error('\nBAKE STOPPED:', e.message || e);
    process.exit(e.code === 'NO_RAW' ? 3 : 1);
  });
}
