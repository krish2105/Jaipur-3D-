// Browser-safe (no fs): raw Overpass elements -> tile-chunked data. Shared by scripts/bake-osm.mjs, tests and the lab.
import { WALLED_CITY_APPROX } from './osm-zones.mjs';
import {
  TILE, extractBuildings, inferHeights, resolveParts, chunkBuildings, extractHighways, chunkRoads, buildGraph,
  extractMisc, chunkMisc, resolveLandmarks, resolveSites, projectGeom, centroid, signedArea, wallSolids,
} from './osm-bake-lib.mjs';

/** Pure: raw Overpass elements -> { files: Map<name, object>, manifest }. No I/O (used by the lab and tests). */
export function bakeElements(elements, { osmBase = null, log = () => {} } = {}) {
  // ---- buildings
  let bl = extractBuildings(elements);
  for (const b of bl) { const c = centroid(b.outer); b.cx = c[0]; b.cz = c[1]; b.area = Math.abs(signedArea(b.outer)); }
  bl = resolveParts(bl);
  inferHeights(bl, { zonePrior: 9.5, radius: 90 });
  // city walls: OSM footprints (area=yes) and lines become 6 m x 3 m solids, baked with the buildings
  const misc = extractMisc(elements);
  const walls = wallSolids(misc.walls);
  bl.push(...walls);
  const bTiles = chunkBuildings(bl, { simplifyTol: 0.15, minArea: 5 });
  log(`buildings: ${bl.length} (${walls.length} wall solids) -> ${bTiles.size} tiles`);

  // ---- roads + graph
  const ways = extractHighways(elements);
  const rTiles = chunkRoads(ways);
  const signals = misc.signals;
  const graph = buildGraph(ways.filter((w) => !w.tunnel), new Set());
  log(`roads: ${ways.length} ways -> ${rTiles.size} tiles; graph ${graph.nodes.length} nodes / ${graph.edges.length} edges (${signals.length} signals)`);

  // ---- misc
  const mTiles = chunkMisc(misc);

  // ---- landmarks + walled-city boundary
  const landmarks = resolveLandmarks(elements);
  const sites = resolveSites(elements);
  const r1 = (v) => Math.round(v * 10) / 10;
  const gates = misc.gates.map((g) => ({ ...g, x: r1(g.x), z: r1(g.z), ring: g.ring ? g.ring.map((p) => [r1(p[0]), r1(p[1])]) : undefined }));
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

  const files = new Map();
  const tileIndex = {};
  const touch = (k, f, v) => ((tileIndex[k] ||= {})[f] = v);
  for (const [k, t] of bTiles) { files.set(`b_${k}.json`, t); touch(k, 'b', t.b.length); }
  for (const [k, t] of rTiles) { files.set(`r_${k}.json`, t); touch(k, 'r', t.w.length); }
  for (const [k, t] of mTiles) { files.set(`m_${k}.json`, t); touch(k, 'm', t.trees.length / 2 + t.lamps.length / 2 + t.walls.length + t.water.length + t.green.length + t.places.length); }
  files.set('graph.json', { v: 1, unit: 'dm', nodes: graph.nodes, edges: graph.edges, signals: signals.map((s) => [Math.round(s.x * 10), Math.round(s.z * 10)]) });
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
    sites,
    gates,
    counts: { buildings: bl.length, roadWays: ways.length, graphNodes: graph.nodes.length, graphEdges: graph.edges.length },
    heightSources: { tag: bl.filter((b) => b.src === 0).length, levels: bl.filter((b) => b.src === 1).length, inferred: bl.filter((b) => b.src === 2).length },
  };
  files.set('manifest.json', manifest);
  return { files, manifest };
}

