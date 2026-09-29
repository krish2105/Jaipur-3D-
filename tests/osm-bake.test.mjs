import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { elements } from './fixtures/overpass-synthetic.mjs';
import * as L from '../scripts/lib/osm-bake-lib.mjs';
import { bake } from '../scripts/bake-osm.mjs';

test('parseLength handles units', () => {
  assert.equal(L.parseLength('12 m'), 12);
  assert.equal(L.parseLength('12.5'), 12.5);
  assert.ok(Math.abs(L.parseLength('40 ft') - 12.192) < 1e-6);
  assert.equal(L.parseLength('tall'), null);
});

test('rings are stitched and oriented; holes assigned', () => {
  const b = L.extractBuildings(elements);
  const rel = b.find((x) => x.id === 'r9');
  assert.ok(rel, 'multipolygon relation assembled');
  assert.ok(L.signedArea(rel.outer) > 0, 'outer ring CCW');
  assert.equal(rel.holes.length, 1);
  assert.ok(L.signedArea(rel.holes[0]) < 0, 'hole CW');
  assert.ok(Math.abs(L.signedArea(rel.outer) - 30 * 30) < 4);
});

test('heights: tag > levels > inferred from neighbourhood; parts replace outline', () => {
  let b = L.extractBuildings(elements);
  for (const x of b) { const c = L.centroid(x.outer); x.cx = c[0]; x.cz = c[1]; x.area = Math.abs(L.signedArea(x.outer)); }
  b = L.resolveParts(b);
  assert.ok(!b.find((x) => x.id === 'w5'), 'outline with building:part removed');
  L.inferHeights(b);
  const by = Object.fromEntries(b.map((x) => [x.id, x]));
  assert.equal(by.w1.h, 12); assert.equal(by.w1.src, 0);
  assert.ok(Math.abs(by.w2.h - 9.9) < 1e-6); assert.equal(by.w2.src, 1);
  assert.equal(by.w3.src, 2);
  assert.ok(by.w3.h > 4 && by.w3.h < 20, 'inferred height plausible: ' + by.w3.h);
  assert.equal(by.w4.cls, 'rel');
});

test('polyline clipping splits at tile borders without gaps', () => {
  const runs = L.clipPolylineToTiles([[-100, 0], [700, 0]]);
  assert.equal(runs.size, 3);
  let len = 0;
  for (const r of runs.values()) for (const run of r) for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
  assert.ok(Math.abs(len - 800) < 1e-6);
});

test('graph splits at shared nodes', () => {
  const ways = L.extractHighways(elements).filter((w) => w.car);
  const g = L.buildGraph(ways);
  assert.ok(g.edges.length >= 3);
  assert.ok(g.edges.every((e) => e.len > 0));
});

test('landmark resolution finds named features', () => {
  const lm = L.resolveLandmarks(elements);
  assert.ok(lm.hawaMahal && lm.hawaMahal[0].ring);
});

test('bake() end to end on the synthetic fixture writes chunks + manifest', async () => {
  const raw = await mkdtemp(path.join(tmpdir(), 'raw-'));
  const out = await mkdtemp(path.join(tmpdir(), 'out-'));
  await writeFile(path.join(raw, 'core_0_0.json'), JSON.stringify({ zone: 'core', tile: [0, 0], osm_base: '2000-01-01T00:00:00Z', elements }));
  const m = await bake({ rawDir: raw, outDir: out, quiet: true });
  const files = await readdir(out);
  assert.ok(files.includes('manifest.json') && files.includes('graph.json'));
  assert.ok(files.some((f) => f.startsWith('b_')));
  assert.ok(m.counts.buildings >= 6);
  const bt = JSON.parse(await readFile(path.join(out, files.find((f) => f.startsWith('b_0_0'))), 'utf8'));
  assert.ok(bt.b.length >= 4 && bt.b[0].p.length >= 8);
});

test('bake() refuses to run without raw data (never fabricates)', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'empty-'));
  await assert.rejects(() => bake({ rawDir: empty, outDir: empty, quiet: true }), /No raw OSM data/);
});
