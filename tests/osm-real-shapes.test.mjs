// Tag shapes seen in the REAL Jaipur Overpass data (observed 2026-09-29), reproduced with SYNTHETIC geometry.
// They guard the baker against regressions on the things the first tiny synthetic fixture never exercised:
//  * gates are mapped as building outlines tagged historic=city_gate (not as nodes)
//  * the city wall is barrier=city_wall + area=yes (a polygon footprint, not a line)
//  * landmark names are shared by bus routes, bus stops and shops, which must not win over the monument itself
import test from 'node:test';
import assert from 'node:assert/strict';
import { unproject } from '../src/core/geo.js';
import * as L from '../scripts/lib/osm-bake-lib.mjs';
import { bakeElements } from '../scripts/lib/bake-elements.mjs';

const ll = (x, z) => { const p = unproject(x, z); return { lat: p.lat, lon: p.lon }; };
const rect = (x, z, w, d) => [ll(x, z), ll(x + w, z), ll(x + w, z + d), ll(x, z + d), ll(x, z)];

const elements = [
  // the real gate: a building outline
  { type: 'way', id: 547207098, tags: { building: 'yes', historic: 'city_gate', name: 'Ajmeri Gate' }, geometry: rect(-1000, 700, 40, 20) },
  { type: 'way', id: 442768311, tags: { building: 'yes', historic: 'city_gate', layer: '-1', name: 'Man Gate', 'name:alt': 'New gate' }, geometry: rect(300, 200, 30, 12) },
  // noise that shares the name
  { type: 'node', id: 1812540125, lat: ll(-949, 910).lat, lon: ll(-949, 910).lon, tags: { highway: 'bus_stop', name: 'Ajmeri Gate', public_transport: 'platform' } },
  { type: 'relation', id: 16329395, tags: { type: 'route', route: 'bus', name: 'Bus 11: Goner - Ajmeri Gate' }, members: [{ type: 'way', role: '', ref: 1, geometry: [ll(-500, 900), ll(-400, 900)] }] },
  { type: 'node', id: 4580149089, lat: ll(-1519, 811).lat, lon: ll(-1519, 811).lon, tags: { amenity: 'ice_cream', name: 'Jal Mahal Ice Cream Parlour' } },
  // the real monument
  { type: 'way', id: 100, tags: { building: 'yes', historic: 'monument', tourism: 'attraction', name: 'Hawa Mahal' }, geometry: rect(100, 100, 30, 8) },
  { type: 'node', id: 101, lat: ll(80, 90).lat, lon: ll(80, 90).lon, tags: { shop: 'gift', name: 'Hawa Mahal Souvenirs' } },
  // city wall as area polygons
  { type: 'way', id: 627340468, tags: { area: 'yes', barrier: 'city_wall' }, geometry: rect(-200, 500, 60, 3) },
  // a linear wall
  { type: 'way', id: 627340999, tags: { barrier: 'city_wall' }, geometry: [ll(0, 600), ll(300, 600)] },
  // Badi Chaupar: locality node beats roads and bus stops
  { type: 'node', id: 3860839961, lat: ll(21, 102).lat, lon: ll(21, 102).lon, tags: { place: 'locality', name: 'Badi Chaupar' } },
  { type: 'way', id: 862954968, tags: { highway: 'primary', name: 'Badi Chaupar' }, geometry: [ll(0, 85), ll(60, 85)] },
];

test('landmark resolution: monuments win over bus stops, routes and shops', () => {
  const lm = L.resolveLandmarks(elements);
  assert.equal(lm.ajmeriGate[0].id, 'w547207098', 'city_gate outline is the primary Ajmeri Gate');
  assert.ok(!lm.ajmeriGate.some((x) => /^r16329395$/.test(x.id)), 'bus route relation is excluded');
  assert.ok(!lm.ajmeriGate.some((x) => x.id === 'n1812540125'), 'bus stop is excluded');
  assert.ok(!lm.jalMahal, 'an ice-cream parlour is not the Jal Mahal');
  assert.equal(lm.hawaMahal[0].id, 'w100');
  assert.ok(!lm.hawaMahal.some((x) => x.id === 'n101'), 'a souvenir shop is not the Hawa Mahal');
  assert.equal(lm.badiChaupar[0].id, 'n3860839961', 'the locality node is the junction position');
});

test('gates: city_gate outlines (ways) are collected with name, centre and ring', () => {
  const misc = L.extractMisc(elements);
  const names = misc.gates.map((g) => g.n).sort();
  assert.deepEqual(names, ['Ajmeri Gate', 'Man Gate']);
  const g = misc.gates.find((x) => x.n === 'Ajmeri Gate');
  assert.ok(Math.abs(g.x - -980) < 1 && Math.abs(g.z - 710) < 1, `centre ${g.x},${g.z}`);
  assert.ok(g.ring && g.ring.length >= 4);
  assert.equal(g.alt, undefined);
  assert.equal(misc.gates.find((x) => x.n === 'Man Gate').alt, 'New gate');
});

test('walls: area polygons are kept as closed footprints, lines stay open', () => {
  const misc = L.extractMisc(elements);
  const area = misc.walls.find((w) => w.closed);
  const line = misc.walls.find((w) => !w.closed);
  assert.ok(area && area.pts.length >= 4, 'area=yes city_wall becomes a closed wall footprint');
  assert.ok(line && line.pts.length === 2);
  assert.equal(area.h, 6, 'city wall height is 6 m');
});

test('bake: gates reach the manifest; city walls are extruded as 6 m solids (areas keep their OSM thickness, lines get 3 m)', () => {
  const { files, manifest } = bakeElements(elements);
  assert.equal(manifest.gates.length, 2);
  assert.ok(manifest.gates.every((g) => Number.isFinite(g.x) && Number.isFinite(g.z) && g.n));
  const walls = [...files.entries()].filter(([n]) => n.startsWith('b_')).flatMap(([, t]) => t.b.filter((b) => b.wl));
  assert.equal(walls.length, 2, 'one closed footprint + one buffered line');
  assert.ok(walls.every((w) => w.h === 6), 'city wall is 6 m high');
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return Math.abs(a) / 2 / 100; };
  const areas = walls.map((w) => area(w.p)).sort((a, b) => a - b);
  assert.ok(Math.abs(areas[0] - 60 * 3) < 6, 'area footprint 60 x 3 m keeps its own outline, got ' + areas[0]);
  assert.ok(Math.abs(areas[1] - 300 * 3) < 30, 'line wall 300 m long buffered to 3 m thick, got ' + areas[1]);
});

test('bufferPolyline: straight line and an L-turn produce a valid ring of the right width', () => {
  const r = L.bufferPolyline([[0, 0], [100, 0]], 1.5);
  assert.equal(r.length, 4);
  assert.ok(Math.abs(Math.abs(L.signedArea(r)) - 300) < 1e-6);
  const l = L.bufferPolyline([[0, 0], [100, 0], [100, 100]], 1.5);
  assert.ok(l.length === 6);
  const a = Math.abs(L.signedArea(l));
  assert.ok(a > 590 && a < 610, 'L-shaped wall area ~ 200 m x 3 m, got ' + a);
});

// ---- Jantar Mantar site: compound wall + the instruments mapped inside it (shapes seen in real OSM) --------------------------
const jm = [
  { type: 'node', id: 1, lat: ll(-200, -140).lat, lon: ll(-200, -140).lon, tags: { historic: 'archaeological_site', name: 'Jantar Mantar' } },
  { type: 'way', id: 2, tags: { barrier: 'wall' }, geometry: [ll(-300, -100), ll(-100, -100), ll(-100, -200), ll(-300, -200), ll(-300, -100)] },
  { type: 'way', id: 3, tags: { barrier: 'wall' }, geometry: [ll(500, 500), ll(520, 500), ll(520, 520), ll(500, 520), ll(500, 500)] }, // some other wall
  { type: 'way', id: 4, tags: { amenity: 'clock', area: 'yes', 'building:levels': '9', display: 'sundial', man_made: 'observatory', name: 'Vrihat Samrat Yantra' }, geometry: rect(-181, -131, 44.4, 41) },
  { type: 'way', id: 5, tags: { building: 'yes', man_made: 'observatory', name: 'Ram Yantra' }, geometry: rect(-259, -133, 8.4, 8.4) },
  { type: 'way', id: 6, tags: { area: 'yes', man_made: 'observatory', name: 'Rashi Valaya Yantra' }, geometry: rect(-234, -121, 40.6, 34.6) },
  { type: 'way', id: 7, tags: { building: 'yes', name: "Observer's room" }, geometry: rect(-207, -160, 4.5, 3.7) },
  { type: 'way', id: 8, tags: { landuse: 'grass' }, geometry: rect(-190, -110, 30, 20) },
  { type: 'way', id: 9, tags: { man_made: 'observatory', name: 'Elsewhere Yantra' }, geometry: rect(700, 700, 5, 5) }, // outside the compound
];

test('sites: Jantar Mantar compound ring + instruments inside it, classified, with real footprints', () => {
  const s = L.resolveSites(jm);
  assert.ok(s.jantarMantar, 'site found');
  const jmSite = s.jantarMantar;
  assert.equal(jmSite.wallId, 'w2', 'the wall polygon that contains the site node and has a compound-sized area');
  assert.ok(Math.abs(jmSite.area - 200 * 100) < 5);
  assert.equal(jmSite.instruments.length, 4, 'samrat, ram, rashi, observer room (grass and outside features excluded)');
  const by = Object.fromEntries(jmSite.instruments.map((i) => [i.cls, i]));
  assert.ok(by.samrat && Math.abs(by.samrat.len - 44.4) < 0.2 && Math.abs(by.samrat.dep - 41) < 0.2);
  assert.ok(by.ram && by.rashi && by.observer);
  assert.ok(Math.abs(by.samrat.x - -158.8) < 0.5 && Math.abs(by.samrat.z - -110.5) < 0.5, `samrat centre ${by.samrat.x},${by.samrat.z}`);
});

test('sites: absent when OSM has no Jantar Mantar node (nothing is invented)', () => {
  assert.deepEqual(L.resolveSites(elements), {});
});

// ---- Hawa Mahal site: OSM has only a node; the pose comes from the smallest building polygon that contains it ---------------------
test('sites: Hawa Mahal node -> smallest enclosing building polygon (way or multipolygon) with an oriented box', () => {
  const rot = (pts, a) => pts.map(([x, z]) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)]);
  const blockPts = rot([[-27.5, -55], [27.5, -55], [27.5, 55], [-27.5, 55]], 0.25).map(([x, z]) => ll(x + 6, z - 25));
  const els = [
    { type: 'node', id: 542886858, lat: ll(36, -48).lat, lon: ll(36, -48).lon, tags: { historic: 'monument', tourism: 'attraction', name: 'Hawa Mahal' } },
    { type: 'relation', id: 1460207, tags: { type: 'multipolygon', building: 'yes', name: 'Saraogi Mansion' }, members: [{ type: 'way', role: 'outer', ref: 1, geometry: blockPts.concat([blockPts[0]]) }] },
    { type: 'way', id: 77, tags: { building: 'yes' }, geometry: rect(300, 300, 20, 20) },       // elsewhere
    { type: 'way', id: 78, tags: { building: 'yes' }, geometry: rect(-500, -500, 400, 400) },  // huge, also contains the node: must lose to the smaller one
  ];
  const s = L.resolveSites(els);
  assert.ok(s.hawaMahal, 'Hawa Mahal site present');
  assert.equal(s.hawaMahal.block.id, 'r1460207');
  assert.ok(Math.abs(s.hawaMahal.block.box.len - 110) < 0.5 && Math.abs(s.hawaMahal.block.box.dep - 55) < 0.5);
  assert.ok(Math.abs(s.hawaMahal.node.x - 36) < 0.2 && Math.abs(s.hawaMahal.node.z - -48) < 0.2);
  assert.ok(s.hawaMahal.block.ring.length >= 4);
});

test('sites: Hawa Mahal absent -> nothing invented', () => {
  assert.equal(L.resolveSites(elements).hawaMahal, undefined);
});

// ---- walls that enclose a region (seen in real data: a city_wall area polygon around a whole hilltop) ------------------------------
test('walls: a fat closed area polygon and a closed loop become 3 m thick RING walls (outer + hole), never a solid slab', () => {
  const sq = (s) => [[0, 0], [s, 0], [s, s], [0, s], [0, 0]].map(([x, z]) => ll(x + 2000, z + 2000));
  const els = [
    { type: 'way', id: 1, tags: { area: 'yes', barrier: 'city_wall' }, geometry: sq(200) },  // fat area polygon
    { type: 'way', id: 2, tags: { barrier: 'city_wall' }, geometry: sq(100).map((p) => ({ lat: p.lat - 0.01, lon: p.lon })) }, // closed loop line
  ];
  const misc = L.extractMisc(els);
  const solids = L.wallSolids(misc.walls);
  assert.equal(solids.length, 2);
  for (const s of solids) {
    assert.equal(s.holes.length, 1, 'ring wall has a hole');
    assert.ok(L.signedArea(s.outer) > 0 && L.signedArea(s.holes[0]) < 0, 'outer CCW, hole CW');
  }
  const a = solids.map((s) => Math.abs(L.signedArea(s.outer)) - Math.abs(L.signedArea(s.holes[0]))).sort((x, y) => x - y);
  assert.ok(Math.abs(a[0] - 4 * 100 * 3) < 60, 'loop of side 100 m: ring area ~ perimeter x 3 m, got ' + a[0]);
  assert.ok(Math.abs(a[1] - 4 * 200 * 3) < 120, 'polygon of side 200 m: ring area ~ perimeter x 3 m, got ' + a[1]);
});

test('offsetRing: square offset outward by d grows its area by ~ perimeter*d', () => {
  const r = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const out = L.offsetRing(r, 1);
  const inn = L.offsetRing(r, -1);
  const A = (x) => Math.abs(L.signedArea(x));
  assert.ok(Math.abs(A(out) - 144) < 1e-6 && Math.abs(A(inn) - 64) < 1e-6, `${A(out)} ${A(inn)}`);
});
