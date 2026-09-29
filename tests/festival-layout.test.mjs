import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { StreetGraph } from '../src/sim/graph.js';
import { FootprintIndex } from '../src/festival/footprints.js';
import { planLamps, planFestival, streetTheme } from '../src/festival/layout.js';

// SYNTHETIC fixtures (tests only, never baked): one 200 m east-west street called "Johari Bazar" between two rows of buildings
function street({ name = 'Johari Bazar', w = 8, cls = 'tertiary' } = {}) {
  return new StreetGraph({ v: 1, unit: 'dm', nodes: [[-1000, 0, 0], [1000, 0, 0]], edges: [{ a: 0, b: 1, len: 200, c: cls, w, ln: 2, v: 20, o: 0, car: 1, n: name }], signals: [] });
}
const flat = () => 0;

test('FootprintIndex: ray casts hit the nearest facade edge, miss beyond range', () => {
  const fp = new FootprintIndex();
  // one building [10..30] x [5..15]
  fp.addChunk({ t: [0, 0], s: 500, b: [{ i: 'a', h: 9, p: [100, 50, 300, 50, 300, 150, 100, 150] }] });
  const h = fp.raycast(20, 0, 0, 1, 20);
  assert.ok(h && Math.abs(h.t - 5) < 1e-6 && Math.abs(h.z - 5) < 1e-6 && h.h === 9, JSON.stringify(h));
  assert.equal(fp.raycast(20, 0, 0, 1, 3), null, 'out of range');
  assert.equal(fp.raycast(20, 0, 0, -1, 30), null, 'nothing behind');
  assert.equal(fp.roofs.length, 1);
  assert.ok(Math.abs(fp.roofs[0].area - 200) < 1e-6);
  // adding the same tile again is a no-op
  assert.equal(fp.addChunk({ t: [0, 0], s: 500, b: [] }), 0);
});

test('planLamps: poles stand beside the road and their arms point at it', () => {
  const g = street({ w: 8, cls: 'tertiary', name: 'Some Road' });
  const lamps = planLamps(g, { radius: 3000, seed: 1 });
  assert.ok(lamps.length / 3 >= 4, 'lamps along a 200 m street: ' + lamps.length / 3);
  for (let i = 0; i < lamps.length; i += 3) {
    const x = lamps[i], z = lamps[i + 1], yaw = lamps[i + 2];
    assert.ok(Math.abs(Math.abs(z) - (4 + 0.7)) < 1e-3, 'offset from the road centre line: ' + z);
    assert.ok(x > -101 && x < 101);
    // model +x maps to world (cos yaw, -sin yaw); the arm must point toward z = 0
    const az = -Math.sin(yaw);
    assert.ok(z * az < 0 && Math.abs(az) > 0.99, 'arm points back to the road');
  }
  assert.equal(planLamps(street({ cls: 'footway' }), {}).length, 0, 'no lamps on footways');
  assert.deepEqual(Array.from(planLamps(g, { seed: 1 })), Array.from(lamps), 'deterministic');
});

test('streetTheme: named bazaars are decorated, elevated roads and unnamed streets are not', () => {
  assert.equal(streetTheme('Johari Bazar').theme, 0);
  assert.equal(streetTheme('Tripolia Bazaar').theme, 1);
  assert.equal(streetTheme('Elevated Hawa Sadak'), null);
  assert.equal(streetTheme(null), null);
  assert.equal(streetTheme('Mirza Ismail Road'), null);
});

test('planFestival: strings hang between the two facades, above head height, on the street side of the wall', () => {
  const g = street();
  const fp = new FootprintIndex();
  // two rows of 20 x 10 m buildings, 10 m tall, at z = +6..16 and z = -16..-6 along x = -100..100 (world metres)
  for (let k = 0; k < 8; k++) {
    const x0 = -100 + k * 25;
    fp.addRing([x0, 6, x0 + 20, 6, x0 + 20, 16, x0, 16], 10, 'n' + k);
    fp.addRing([x0, -16, x0 + 20, -16, x0 + 20, -6, x0, -6], 10, 's' + k);
  }
  assert.equal(fp.segmentCount, 8 * 4 * 2);
  const plan = planFestival(g, fp, flat, { radius: 500, seed: 3 });
  assert.ok(plan.stats.spans >= 6, 'spans: ' + JSON.stringify(plan.stats));
  const sp = plan.spans;
  for (let i = 0; i < sp.length; i += 8) {
    const zA = sp[i + 2], zB = sp[i + 5];
    assert.ok(Math.abs(Math.abs(zA) - 6) < 0.9 && Math.abs(Math.abs(zB) - 6) < 0.9 && zA * zB < 0, 'anchors on opposite facades, street side: ' + zA + ' ' + zB);
    assert.ok(sp[i + 1] >= 3 && sp[i + 1] <= 8.1 && sp[i + 4] >= 3 && sp[i + 4] <= 8.1, 'anchor heights');
  }
  // bulbs: colours are valid, string bulbs sit between the facades, roofline bulbs at the parapet, diyas near the ground
  let strings = 0, roof = 0, diya = 0;
  for (let i = 0; i < plan.bulbs.length; i += 8) {
    const y = plan.bulbs[i + 1], z = plan.bulbs[i + 2], kind = plan.bulbs[i + 7];
    assert.ok(plan.bulbs[i + 3] >= 0 && plan.bulbs[i + 4] >= 0 && plan.bulbs[i + 5] >= 0);
    if (kind === 0) { strings++; assert.ok(Math.abs(z) < 6.9 && y > 2.5 && y < 8.2, 'string bulb inside the street slot ' + y + ' ' + z); }
    else if (kind === 1) { roof++; assert.ok(Math.abs(y - 10.2) < 1e-4); }
    else { diya++; assert.ok(y < 0.1); }
  }
  assert.ok(strings > 60 && roof > 10 && diya > 5, `bulbs by kind ${strings} ${roof} ${diya}`);
  assert.ok(plan.sources.length / 7 >= plan.stats.spans, 'a light-grid source per span at least');
  // deterministic
  const again = planFestival(g, fp, flat, { radius: 500, seed: 3 });
  assert.deepEqual(Array.from(again.bulbs.subarray(0, 80)), Array.from(plan.bulbs.subarray(0, 80)));
  // with no buildings nothing is invented: no floating strings
  const empty = planFestival(g, new FootprintIndex(), flat, { radius: 500 });
  assert.equal(empty.stats.spans, 0);
  assert.equal(empty.bulbs.length, 0);
});

const REAL = existsSync('public/data/osm/graph.json') && existsSync('public/data/osm/manifest.json');
test('real baked Jaipur data: bazaar strings, facades and lamps come out sane', { skip: !REAL }, () => {
  const g = new StreetGraph(JSON.parse(readFileSync('public/data/osm/graph.json', 'utf8')));
  const man = JSON.parse(readFileSync('public/data/osm/manifest.json', 'utf8'));
  const fp = new FootprintIndex();
  for (const key of Object.keys(man.tiles)) {
    const [ix, iz] = key.split('_').map(Number);
    const f = `public/data/osm/b_${ix}_${iz}.json`;
    if (man.tiles[key].b && existsSync(f)) fp.addChunk(JSON.parse(readFileSync(f, 'utf8')));
  }
  assert.ok(fp.roofs.length > 5000, 'footprints loaded: ' + fp.roofs.length);
  const t0 = performance.now();
  const plan = planFestival(g, fp, () => 443, { radius: 1900 });
  const ms = performance.now() - t0;
  assert.ok(plan.stats.edges > 20, 'festival edges: ' + JSON.stringify(plan.stats));
  assert.ok(plan.stats.spans > 15, 'spans on real streets (OSM maps facades on both sides of few bazaar stretches): ' + JSON.stringify(plan.stats));
  assert.ok(plan.stats.roofSegs > 60, 'roofline runs on mapped facades: ' + plan.stats.roofSegs);
  assert.ok(plan.stats.bulbs < 60000 && plan.stats.bulbs > 1000, 'bulb count ' + plan.stats.bulbs);
  assert.ok(ms < 5000, 'layout time ' + ms);
  // every anchor is on a real facade: within 0.4 m of some OSM footprint edge
  const dist2seg = (x, z) => {
    let best = 1e9;
    const c = fp.cell;
    for (let i = Math.floor((x - 1) / c); i <= Math.floor((x + 1) / c); i++) for (let j = Math.floor((z - 1) / c); j <= Math.floor((z + 1) / c); j++) {
      for (const s of fp.grid.get(i * 65536 + j) || []) {
        const ex = fp.sx1[s] - fp.sx0[s], ez = fp.sz1[s] - fp.sz0[s];
        const t = Math.max(0, Math.min(1, ((x - fp.sx0[s]) * ex + (z - fp.sz0[s]) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(x - (fp.sx0[s] + ex * t), z - (fp.sz0[s] + ez * t)));
      }
    }
    return best;
  };
  for (let i = 0; i < plan.spans.length; i += 8 * 5) {
    assert.ok(dist2seg(plan.spans[i], plan.spans[i + 2]) < 0.4 && dist2seg(plan.spans[i + 3], plan.spans[i + 5]) < 0.4, 'anchor off the facade');
  }
  const lamps = planLamps(g, { radius: 3600 });
  assert.ok(lamps.length / 3 > 2000 && lamps.length / 3 < 40000, 'generated lamps: ' + lamps.length / 3);
});
