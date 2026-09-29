// Overhead wires: spans only where a street has facades on both sides, hung at facade height, deterministic. Chunks below are SYNTHETIC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWires, buildingGrid } from '../src/world/wires.js';
import { LinePool, makeLampHeadGeometry, makeLampPostGeometry, makeJharokhaGeometry } from '../src/world/props.js';
import * as THREE from 'three';

const dm = (x, z, w, d) => [x * 10, z * 10, (x + w) * 10, z * 10, (x + w) * 10, (z + d) * 10, x * 10, (z + d) * 10];
const bld = (id, x, z, w, d, h) => ({ i: id, h, k: 'oth', s: 2, p: dm(x, z, w, d) });
const road = (cls, width, z, x0 = 20, x1 = 480) => ({ t: [0, 0], s: 500, w: [{ p: [x0 * 10, z * 10, x1 * 10, z * 10], w: width, c: cls, n: '' }] });
const ground = () => 2;
const both = { t: [0, 0], s: 500, b: [bld('a', 0, 200, 500, 45, 11), bld('b', 0, 255, 500, 45, 9)] }; // street z = 250 (8 m wide), facades at z = 245 and z = 255

test('spans cross a street that has a facade on each side, at facade height, endpoints on the facades', () => {
  const w = buildWires(both, road('residential', 8, 250), ground);
  const nV = w.length / 3;
  assert.ok(nV >= 30, 'several spans along a 460 m street: ' + nV);
  assert.equal(nV % 10, 0, 'each wire is 5 line segments = 10 vertices');
  for (let i = 0; i < w.length; i += 3) {
    assert.ok(w[i + 1] >= 2 + 3.2 - 1e-6 && w[i + 1] <= 2 + 9 - 0.8 + 1e-6, 'height under the lower roof (9 m) and above head height: ' + w[i + 1]);
    assert.ok(w[i + 2] > 244.5 && w[i + 2] < 255.5, 'z between the two facades: ' + w[i + 2]);
  }
});

test('no span where one side has no building, none on footways or very wide roads', () => {
  const oneSide = { t: [0, 0], s: 500, b: [both.b[0]] };
  assert.equal(buildWires(oneSide, road('residential', 8, 250), ground).length, 0);
  assert.equal(buildWires(both, road('footway', 8, 250), ground).length, 0);
  assert.equal(buildWires(both, road('primary', 30, 250), ground).length, 0);
  assert.equal(buildWires(both, { t: [0, 0], w: [] }, ground).length, 0);
  assert.equal(buildWires({ t: [0, 0], b: [] }, road('residential', 8, 250), ground).length, 0);
});

test('deterministic, and capped by maxVerts', () => {
  const a = buildWires(both, road('residential', 8, 250), ground), b = buildWires(both, road('residential', 8, 250), ground);
  assert.equal(Buffer.from(a.buffer).compare(Buffer.from(b.buffer)), 0);
  const capped = buildWires(both, road('residential', 8, 250), ground, { maxVerts: 60 });
  assert.ok(capped.length / 3 <= 60 + 20, 'stops at the cap (finishing the current span, at most two wires): ' + capped.length / 3);
});

test('building grid: point queries and courtyards', () => {
  const g = buildingGrid(both);
  assert.equal(g.at(100, 220).h, 11);
  assert.equal(g.at(100, 250), null);
  assert.equal(g.at(100, 270).h, 9);
});

test('LinePool: ranges are allocated, written in world metres, hidden and merged on release', () => {
  const pool = new LinePool(100, new THREE.LineBasicMaterial());
  const r1 = pool.alloc(20), r2 = pool.alloc(30);
  assert.deepEqual([r1.start, r1.count, r2.start, r2.count], [0, 20, 20, 30]);
  assert.equal(pool.mesh.geometry.drawRange.count, 50);
  const arr = new Float32Array(60).map((_, i) => i);
  pool.write(r1, arr, 1000, 2000);
  assert.deepEqual([pool.pos[0], pool.pos[1], pool.pos[2]], [1000, 1, 2002]);
  pool.release(r1);
  assert.equal(pool.pos[1], -1e5, 'released vertices sit far below the world');
  pool.release(r2);
  assert.deepEqual(pool.free, [[0, 100]], 'free ranges merge back into one');
  assert.equal(pool.alloc(101), null, 'over capacity is refused');
});

test('props: twin-arm lamp and lean oriel geometry', () => {
  const lamp = makeLampPostGeometry(), head = makeLampHeadGeometry(), jh = makeJharokhaGeometry();
  lamp.computeBoundingBox(); head.computeBoundingBox();
  assert.ok(lamp.boundingBox.min.x < -0.8 && lamp.boundingBox.max.x > 0.8, 'arms on both sides of the pole');
  assert.ok(head.boundingBox.min.x < -0.7 && head.boundingBox.max.x > 0.7, 'a head on each arm');
  assert.ok(jh.index.count / 3 <= 140, 'oriel stays lean (it is instanced thousands of times): ' + jh.index.count / 3);
});
