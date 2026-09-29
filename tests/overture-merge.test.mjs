// Overture footprint merge. The footprints below are SYNTHETIC (same lon/lat shape as an Overture GeoJSON row), never baked into public/data.
// The last test checks the invariants on the real baked chunks in public/data/osm when they include Overture footprints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { elements } from './fixtures/overpass-synthetic.mjs';
import { unproject } from '../src/core/geo.js';
import { mergeOverture, overtureId, overtureTags, polygonsFromGeoJSON } from '../scripts/lib/overture-merge.mjs';
import { extractBuildings, extractHighways, centroid, signedArea, resolveParts, pointInRing } from '../scripts/lib/osm-bake-lib.mjs';
import { bakeElements, OVERTURE_ATTRIBUTION } from '../scripts/lib/bake-elements.mjs';

const ll = (x, z) => { const p = unproject(x, z); return [p.lon, p.lat]; };
const rectRing = (x, z, w, d) => [ll(x, z), ll(x, z + d), ll(x + w, z + d), ll(x + w, z), ll(x, z)]; // clockwise, closed, GeoJSON order (lon, lat)
const poly = (...rings) => ({ type: 'Polygon', coordinates: rings });
const row = (id, geom, extra = {}) => ({ id, name: null, height: null, floors: null, cls: null, subtype: null, roof: null, ds: 'Google Open Buildings', geom, ...extra });

function osmContext() {
  let b = extractBuildings(elements);
  for (const x of b) { const c = centroid(x.outer); x.cx = c[0]; x.cz = c[1]; x.area = Math.abs(signedArea(x.outer)); }
  b = resolveParts(b);
  return { osm: b, roads: extractHighways(elements) };
}

test('GeoJSON polygons become CCW outers and CW holes in world metres; MultiPolygon gives one entry per polygon', () => {
  const g = { type: 'MultiPolygon', coordinates: [[rectRing(100, 150, 20, 20), rectRing(105, 155, 5, 5).reverse()], [rectRing(200, 150, 10, 10)]] };
  const ps = polygonsFromGeoJSON(g);
  assert.equal(ps.length, 2);
  assert.ok(signedArea(ps[0].outer) > 0, 'outer CCW');
  assert.equal(ps[0].holes.length, 1);
  assert.ok(signedArea(ps[0].holes[0]) < 0, 'hole CW');
  assert.ok(Math.abs(signedArea(ps[0].outer) - 400) < 2, 'area survives projection');
  assert.equal(ps[0].outer.length, 4, 'closing point dropped');
  assert.deepEqual(polygonsFromGeoJSON({ type: 'Point', coordinates: [0, 0] }), []);
});

test('merge keeps free sites and drops duplicates of OSM, footprints on a street, slivers and bad geometry', () => {
  const rows = [
    row('free', poly(rectRing(100, 150, 20, 15))),
    row('dup-of-osm', poly(rectRing(11, 10.5, 20, 10))), // OSM way 1 is rect(10,10,20,10)
    row('on-street', poly(rectRing(100, -4, 20, 8))), // primary road along z = 0, 14 m wide
    row('reaches-centre', poly(rectRing(300, -0.4, 20, 30))), // only 22 % of it is on the carriageway, but it covers the centreline: wrong whatever the guessed width
    row('by-footway', poly(rectRing(21, 47, 9, 6))), // straddles the footway (z = 50): a footway is not a carriageway, keep
    row('sliver', poly(rectRing(300, 300, 2, 2))),
    row('point', { type: 'Point', coordinates: [75.8, 26.9] }),
  ];
  const { buildings, stats } = mergeOverture(rows, osmContext());
  assert.deepEqual(buildings.map((b) => b.id).sort(), [overtureId('by-footway'), overtureId('free')].sort());
  assert.deepEqual(stats.dropped, { geometry: 1, small: 1, duplicateOfOsm: 1, onStreet: 2 });
  assert.equal(stats.kept, 2);
  const free = buildings.find((b) => b.id === overtureId('free'));
  assert.ok(free.ov && free.tags.building === 'yes' && !free.part);
  assert.ok(Math.abs(free.area - 300) < 2 && Math.abs(free.cx - 110) < 0.5 && Math.abs(free.cz - 157.5) < 0.5);
});

test('a hole (courtyard) is kept and does not count as covered by the OSM building around it', () => {
  const rows = [row('court', poly(rectRing(100, 150, 30, 30), rectRing(110, 160, 10, 10)))];
  const { buildings } = mergeOverture(rows, osmContext());
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].holes.length, 1);
  assert.ok(Math.abs(buildings[0].area - 800) < 3, 'area = outer minus hole');
});

test('class, height, floors and roof come from Overture properties when present, nothing is made up otherwise', () => {
  assert.deepEqual(overtureTags(row('a', null)), { building: 'yes' });
  assert.deepEqual(overtureTags(row('a', null, { subtype: 'religious' })), { building: 'religious' });
  assert.equal(overtureTags(row('a', null, { cls: 'temple' })).building, 'temple');
  assert.equal(overtureTags(row('a', null, { height: 14.5, floors: 4 })).height, '14.5');
  assert.equal(overtureTags(row('a', null, { floors: 4 }))['building:levels'], '4');
  assert.equal(overtureTags(row('a', null, { roof: 'hipped' }))['roof:shape'], 'hipped');
  assert.equal(overtureTags(row('a', null, { cls: 'Weird; DROP' })).building, 'yes', 'unexpected class strings are ignored');
});

test('ids are stable, deterministic and merging twice gives identical records', () => {
  assert.equal(overtureId('cc1cba96-15b9-4587-98f4-ffaa21891cfe'), overtureId('cc1cba96-15b9-4587-98f4-ffaa21891cfe'));
  assert.notEqual(overtureId('a'), overtureId('b'));
  const rows = [row('one', poly(rectRing(100, 150, 12, 12))), row('two', poly(rectRing(130, 150, 12, 12)))];
  const a = mergeOverture(rows, osmContext()), b = mergeOverture(rows, osmContext());
  assert.equal(JSON.stringify(a.buildings), JSON.stringify(b.buildings));
});

test('bakeElements: Overture footprints are chunked with o=1, take their own height if they have one, and the attribution names Overture', () => {
  const rows = [row('h', poly(rectRing(100, 150, 20, 15)), { height: 13 }), row('plain', poly(rectRing(140, 150, 20, 15)))];
  const withOv = bakeElements(elements, { overture: { lines: rows, meta: { release: 'test-release', fetchedAt: 'test' } } });
  const base = bakeElements(elements);
  const recs = [...withOv.files].filter(([n]) => n.startsWith('b_')).flatMap(([, t]) => t.b);
  const ov = recs.filter((r) => r.o);
  assert.equal(ov.length, 2);
  assert.equal(withOv.manifest.counts.buildingsOverture, 2);
  assert.equal(withOv.manifest.counts.buildings, base.manifest.counts.buildings + 2);
  assert.equal(withOv.manifest.overture.release, 'test-release');
  assert.equal(withOv.manifest.overture.license, 'ODbL-1.0');
  assert.equal(withOv.manifest.attribution, OVERTURE_ATTRIBUTION);
  assert.match(withOv.manifest.attribution, /OpenStreetMap contributors/);
  assert.match(withOv.manifest.attribution, /Overture Maps Foundation/);
  const h = ov.find((r) => r.i === overtureId('h'));
  assert.equal(h.h, 13); assert.equal(h.s, 0, 'a real Overture height is not labelled inferred');
  assert.equal(ov.find((r) => r.i === overtureId('plain')).s, 2, 'no height in the data -> inferred');
  // the OSM-only bake is untouched
  assert.ok(![...base.files].filter(([n]) => n.startsWith('b_')).flatMap(([, t]) => t.b).some((r) => r.o));
  assert.equal(base.manifest.attribution, '© OpenStreetMap contributors (ODbL)');
  assert.equal(base.manifest.counts.buildingsOverture, 0);
  assert.equal(base.manifest.overture, undefined);
});

test('real baked chunks: Overture records are counted in the manifest and never sit on top of an OSM footprint', async (t) => {
  const dir = new URL('../public/data/osm/', import.meta.url);
  const man = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  if (!man.overture) return t.skip('public/data/osm was baked without Overture footprints');
  const DM = 10, tiles = [];
  for (const k of Object.keys(man.tiles)) if (man.tiles[k].b) tiles.push(JSON.parse(await readFile(new URL(`b_${k}.json`, dir), 'utf8')));
  const ringOf = (r, ox, oz) => { const out = []; for (let i = 0; i < r.p.length; i += 2) out.push([ox + r.p[i] / DM, oz + r.p[i + 1] / DM]); return out; };
  let ov = 0;
  const osmRings = [], ovRecs = [];
  for (const c of tiles) {
    const ox = c.t[0] * c.s, oz = c.t[1] * c.s;
    for (const r of c.b) {
      const ring = ringOf(r, ox, oz);
      if (r.o) { ov++; ovRecs.push({ r, ring }); } else osmRings.push(ring);
    }
  }
  assert.equal(ov, man.counts.buildingsOverture);
  assert.equal(ov, man.overture.kept);
  assert.ok(ov > 1000, 'real Overture footprints present: ' + ov);
  // invariant: no Overture centroid lies inside an OSM footprint (grid-hashed to keep the test fast)
  const cell = 50, grid = new Map();
  for (const ring of osmRings) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) { const k = `${cx}_${cz}`; (grid.get(k) || grid.set(k, []).get(k)).push(ring); }
  }
  let inside = 0;
  for (const { ring } of ovRecs) {
    const [cx, cz] = centroid(ring);
    for (const o of grid.get(`${Math.floor(cx / cell)}_${Math.floor(cz / cell)}`) || []) if (pointInRing(cx, cz, o)) { inside++; break; }
  }
  assert.ok(inside / ov < 0.01, `${inside} of ${ov} Overture centroids inside an OSM footprint`);
});
