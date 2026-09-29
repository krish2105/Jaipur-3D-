// Bake raw Overpass JSON (data-raw/osm/*.json, from `npm run fetch:osm`) into the static,
// tile-chunked files the app streams:
//   public/data/osm/manifest.json
//   public/data/osm/b_<ix>_<iz>.json   buildings (heights inferred, rings in dm relative to tile)
//   public/data/osm/r_<ix>_<iz>.json   roads (clipped to tile)
//   public/data/osm/m_<ix>_<iz>.json   misc: trees, lamps, walls, water, green, places, shops
//   public/data/osm/graph.json         street graph for the traffic worker
// Refuses to run when there is no raw data (never fabricates any).
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RAW_DIR } from './lib/net.mjs';
import { ZONES, WALLED_CITY_APPROX } from './lib/osm-zones.mjs';
import { project } from '../src/core/geo.js';
import {
  TILE, extractBuildings, inferHeights, resolveParts, chunkBuildings, extractHighways, chunkRoads, buildGraph,
  extractMisc, chunkMisc, resolveLandmarks, projectGeom, centroid, signedArea,
} from './lib/osm-bake-lib.mjs';

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
  const { elements, osmBase } = loaded;
  log(`loaded ${elements.length} unique OSM elements from ${loaded.files} file(s)`);

  // ---- buildings
  let bl = extractBuildings(elements);
  const coreZone = ZONES.find((z) => z.id === 'core');
  const isCore = (b) => inBBox(b.cx ?? centroid(b.outer)[0], b.cz ?? centroid(b.outer)[1], coreZone.bbox);
  for (const b of bl) { const c = centroid(b.outer); b.cx = c[0]; b.cz = c[1]; b.area = Math.abs(signedArea(b.outer)); }
  bl = resolveParts(bl);
  inferHeights(bl, { zonePrior: 9.5, radius: 90 });
  const bTiles = chunkBuildings(bl, { simplifyTol: 0.15, minArea: 5 });
  log(`buildings: ${bl.length} -> ${bTiles.size} tiles`);

  // ---- roads + graph
  const ways = extractHighways(elements);
  const rTiles = chunkRoads(ways);
  const signals = extractMisc(elements).signals;
  const graph = buildGraph(ways.filter((w) => !w.tunnel), new Set());
  log(`roads: ${ways.length} ways -> ${rTiles.size} tiles; graph ${graph.nodes.length} nodes / ${graph.edges.length} edges (${signals.length} signals)`);

  // ---- misc
  const misc = extractMisc(elements);
  const mTiles = chunkMisc(misc);

  // ---- landmarks + walled-city boundary
  const landmarks = resolveLandmarks(elements);
  const gates = misc.gates;
  let boundary = { source: 'approx-brief', bbox: WALLED_CITY_APPROX };
  const boundaryRel = elements.find((e) => e.type === 'relation' && e.tags?.boundary && /walled|pink|old city|parkota/i.test(e.tags.name || ''));
  if (boundaryRel) {
    const pts = [];
    for (const m of boundaryRel.members || []) if (m.geometry) pts.push(...projectGeom(m.geometry));
    if (pts.length) {
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      boundary = { source: `osm relation r${boundaryRel.id} "${boundaryRel.tags.name}"`, minX, maxX, minZ, maxZ };
    }
  }

  // ---- write
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const tileIndex = {};
  const touch = (k, f, v) => ((tileIndex[k] ||= {})[f] = v);
  let bytes = 0;
  const w = async (name, obj) => { const s = JSON.stringify(obj); bytes += s.length; await writeFile(path.join(outDir, name), s); };
  for (const [k, t] of bTiles) { await w(`b_${k}.json`, t); touch(k, 'b', t.b.length); }
  for (const [k, t] of rTiles) { await w(`r_${k}.json`, t); touch(k, 'r', t.w.length); }
  for (const [k, t] of mTiles) { await w(`m_${k}.json`, t); touch(k, 'm', t.trees.length / 2 + t.lamps.length / 2 + t.walls.length + t.water.length + t.green.length + t.places.length); }
  await w('graph.json', { v: 1, unit: 'dm', nodes: graph.nodes, edges: graph.edges, signals: signals.map((s) => [Math.round(s.x * 10), Math.round(s.z * 10)]) });
  const manifest = {
    version: 1,
    tileSize: TILE,
    unit: 'decimetre ints relative to tile min corner (x east, z south)',
    bakedAt: new Date().toISOString(),
    osmBase,
    attribution: '© OpenStreetMap contributors (ODbL)',
    tiles: tileIndex,
    walledCity: boundary,
    landmarks,
    gates,
    counts: { buildings: bl.length, roadWays: ways.length, graphNodes: graph.nodes.length, graphEdges: graph.edges.length },
    heightSources: { tag: bl.filter((b) => b.src === 0).length, levels: bl.filter((b) => b.src === 1).length, inferred: bl.filter((b) => b.src === 2).length },
  };
  await w('manifest.json', manifest);
  log(`wrote ${Object.keys(tileIndex).length} tiles, ~${(bytes / 1e6).toFixed(2)} MB raw JSON to ${outDir}`);
  void isCore;
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bake().catch((e) => {
    console.error('\nBAKE STOPPED:', e.message || e);
    process.exit(e.code === 'NO_RAW' ? 3 : 1);
  });
}
