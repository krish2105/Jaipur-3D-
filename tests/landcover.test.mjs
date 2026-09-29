import test from 'node:test';
import assert from 'node:assert/strict';
import { unproject } from '../src/core/geo.js';
import { extractLandcover, rasterizeLandcover, COVER } from '../scripts/lib/landcover.mjs';

const ll = (x, z) => { const p = unproject(x, z); return { lat: p.lat, lon: p.lon }; };
const rect = (x, z, w, d) => [ll(x, z), ll(x + w, z), ll(x + w, z + d), ll(x, z + d), ll(x, z)];

const els = [
  { type: 'way', id: 1, tags: { natural: 'water' }, geometry: rect(100, 100, 200, 200) },
  { type: 'way', id: 2, tags: { leisure: 'park' }, geometry: rect(-300, 100, 100, 100) },
  { type: 'way', id: 3, tags: { natural: 'scrub' }, geometry: rect(-300, -300, 120, 120) },
  { type: 'way', id: 4, tags: { landuse: 'residential' }, geometry: rect(400, 400, 100, 100) },
  { type: 'way', id: 5, tags: { building: 'yes' }, geometry: rect(0, 0, 10, 10) },           // not landcover
  { type: 'way', id: 6, tags: { boundary: 'protected_area', name: 'Some WLS' }, geometry: rect(-1000, -1000, 2000, 2000) }, // a boundary, not a surface
  {
    type: 'relation', id: 7, tags: { type: 'multipolygon', natural: 'water', name: 'Lake with island' },
    members: [
      { type: 'way', role: 'outer', ref: 70, geometry: rect(-600, 600, 300, 300) },
      { type: 'way', role: 'inner', ref: 71, geometry: rect(-500, 700, 100, 100) },
    ],
  },
];

test('extractLandcover classifies ways and multipolygon relations, ignoring buildings and boundaries', () => {
  const polys = extractLandcover(els);
  const by = (c) => polys.filter((p) => p.cls === c);
  assert.equal(by(COVER.WATER).length, 2, 'way + relation');
  assert.equal(by(COVER.PARK).length, 1);
  assert.equal(by(COVER.VEG).length, 1);
  assert.equal(by(COVER.BUILT).length, 1);
  assert.equal(polys.length, 5);
  const rel = by(COVER.WATER).find((p) => p.rings.length === 2);
  assert.ok(rel, 'relation carries its outer and inner ring');
});

test('rasterize: channels per class, holes stay empty, outside is zero, resolution and origin are honoured', () => {
  const polys = extractLandcover(els);
  const g = { x0: -1000, z0: -1000, w: 400, h: 400, texel: 5 }; // covers -1000..1000 m
  const { data } = rasterizeLandcover(polys, g);
  const at = (x, z, ch) => data[(Math.floor((z - g.z0) / g.texel) * g.w + Math.floor((x - g.x0) / g.texel)) * 4 + ch];
  assert.equal(at(200, 200, 2), 255, 'water inside the lake polygon (blue channel)');
  assert.equal(at(200, 200, 0), 0, 'and nothing else there');
  assert.equal(at(-250, 150, 3), 255, 'park (alpha channel)');
  assert.equal(at(-240, -240, 1), 255, 'scrub (green channel)');
  assert.equal(at(450, 450, 0), 255, 'built-up landuse (red channel)');
  assert.equal(at(500, -500, 2), 0, 'unmapped ground is zero');
  assert.equal(at(-450, 750, 2), 0, 'the island (inner ring) is not water');
  assert.equal(at(-550, 650, 2), 255, 'the lake around the island is');
});
