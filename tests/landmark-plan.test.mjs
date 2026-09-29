import test from 'node:test';
import assert from 'node:assert/strict';
import { orientedBox, facingNormal, yawForNormal, locate, buildExclusion, isExcluded, pointInRing } from '../src/world/landmarks/plan.js';
import { project } from '../src/core/geo.js';

const rot = (pts, a, cx = 0, cz = 0) => pts.map(([x, z]) => [cx + x * Math.cos(a) - z * Math.sin(a), cz + x * Math.sin(a) + z * Math.cos(a)]);
const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

test('orientedBox recovers size, centre and axis of a rotated rectangle', () => {
  const ring = rot(rect(46, 9), 0.3, 120, -40);
  const b = orientedBox(ring);
  assert.ok(Math.abs(b.len - 46) < 1e-6 && Math.abs(b.dep - 9) < 1e-6, `${b.len} x ${b.dep}`);
  assert.ok(Math.abs(b.cx - 120) < 1e-6 && Math.abs(b.cz + 40) < 1e-6);
  // long axis is +-(cos .3, sin .3)
  assert.ok(Math.abs(Math.abs(b.ux * Math.cos(0.3) + b.uz * Math.sin(0.3)) - 1) < 1e-9);
});

test('facade normal picks the east side and the yaw maps model +z onto it', () => {
  // a long N-S building (long axis along z): facade normal must be +-x, and we want east (+x)
  const b = orientedBox(rot(rect(9, 46), 0.1));
  const [nx, nz] = facingNormal(b, 1, 0);
  assert.ok(nx > 0.9, `normal ${nx},${nz}`);
  const yaw = yawForNormal(nx, nz);
  // three.js: rotation about Y by yaw maps (0,0,1) -> (sin yaw, 0, cos yaw)
  assert.ok(Math.abs(Math.sin(yaw) - nx) < 1e-9 && Math.abs(Math.cos(yaw) - nz) < 1e-9);
});

test('locate: OSM ring wins; fallback coordinate otherwise', () => {
  const ring = rot(rect(40, 10), 0.2, 50, 60);
  const closed = ring.concat([ring[0]]);
  const man = { landmarks: { hawaMahal: [{ id: 'w1', name: 'Hawa Mahal', x: 0, z: 0, ring: closed }] } };
  const a = locate(man, 'hawaMahal');
  assert.equal(a.source, 'osm');
  assert.ok(Math.abs(a.x - 50) < 1e-6 && Math.abs(a.z - 60) < 1e-6);
  const b = locate({ landmarks: {} }, 'jalMahal');
  const p = project(26.9537, 75.8463);
  assert.equal(b.source, 'fallback');
  assert.ok(Math.abs(b.x - p.x) < 1e-6 && Math.abs(b.z - p.z) < 1e-6);
  assert.equal(locate({ landmarks: {} }, 'nothing'), null);
});

test('exclusion drops the footprint by id, buildings inside the inflated ring and buildings inside a fallback disc', () => {
  const ring = rect(30, 10).map(([x, z]) => [x + 200, z + 200]);
  const ex = buildExclusion([
    { key: 'hawaMahal', id: 'w7', x: 200, z: 200, ring },
    { key: 'jalMahal', x: 1000, z: 1000, ring: null },
  ], { margin: 3, discRadius: { jalMahal: 50 } });
  const rec = (i, x, z) => ({ i, p: [x * 10, z * 10, x * 10 + 10, z * 10, x * 10 + 10, z * 10 + 10] });
  assert.ok(isExcluded(rec('w7', 0, 0), 0, 0, ex), 'by id');
  assert.ok(isExcluded(rec('w8', 198, 198), 0, 0, ex), 'inside the ring');
  assert.ok(isExcluded(rec('w9', 216, 202), 0, 0, ex), 'inside the margin (ring half-width 15 + 3)');
  assert.ok(!isExcluded(rec('w10', 300, 300), 0, 0, ex), 'far away is kept');
  assert.ok(isExcluded(rec('w11', 1020, 1000), 0, 0, ex), 'inside the disc');
  assert.ok(!isExcluded(rec('w12', 1100, 1000), 0, 0, ex), 'outside the disc');
  // tile origin offsets are applied
  assert.ok(isExcluded(rec('w13', 8, 8), 190, 190, ex), 'tile-local coordinates are offset by the tile origin');
  assert.ok(pointInRing(0, 0, rect(4, 4)));
});

import { hawaPose, rectRing, coverFraction, addFootprints, isExcludedFull } from '../src/world/landmarks/plan.js';

test('hawaPose: facade sits on the block edge facing east, at the node position along the facade', () => {
  // block 110 (N-S-ish) x 55 (E-W-ish) centred (6,-25), long axis tilted 0.25 rad from north, node 4 m from the east edge
  const ux = Math.sin(0.25), uz = -Math.cos(0.25); // long axis
  const nx = Math.cos(0.25), nz = Math.sin(0.25);   // east-pointing normal
  const node = { x: 6 + ux * 30 + nx * 23.6, z: -25 + uz * 30 + nz * 23.6 };
  const man = { sites: { hawaMahal: { node, block: { id: 'r1', box: { cx: 6, cz: -25, ux, uz, len: 110, dep: 55 }, ring: [] } } } };
  const p = hawaPose(man);
  assert.equal(p.source, 'osm');
  assert.ok(p.nx > 0.9, 'normal points east: ' + p.nx);
  // facade point is on the east edge (27.5 m from the centre along the normal) and at the node's position along the facade
  const dn = (p.x - 6) * p.nx + (p.z + 25) * p.nz, du = (p.x - 6) * ux + (p.z + 25) * uz;
  assert.ok(Math.abs(dn - 27.5) < 1e-6, 'on the east edge: ' + dn);
  assert.ok(Math.abs(du - 30) < 1e-6, 'at the node along the facade: ' + du);
  assert.ok(Math.abs(Math.sin(p.yaw) - p.nx) < 1e-9);
  // fallback
  const f = hawaPose({ landmarks: {} });
  assert.equal(f.source, 'fallback');
  assert.ok(f.nx === 1 && f.nz === 0);
});

test('footprint overlap: small buildings under the model go, a big block that only touches it stays', () => {
  const foot = rectRing(0, 0, 1, 0, 40, 26);
  const ex = addFootprints({ ids: [], rings: [], discs: [] }, [foot], 0.6);
  const toRec = (ring) => ({ i: 'x', p: ring.flatMap(([x, z]) => [Math.round(x * 10), Math.round(z * 10)]) });
  const small = rectRing(3, 2, 1, 0, 8, 6);
  const block = rectRing(0, 0, 1, 0, 110, 55);           // contains the footprint but only ~ 18 % of it is covered
  const straddle = rectRing(25, 0, 1, 0, 20, 10);          // half in, half out
  assert.ok(coverFraction(small, foot) > 0.99);
  assert.ok(coverFraction(block, foot) < 0.25);
  assert.ok(isExcludedFull(toRec(small), 0, 0, ex));
  assert.ok(!isExcludedFull(toRec(block), 0, 0, ex));
  assert.ok(!isExcludedFull(toRec(straddle), 0, 0, ex), 'exactly half covered is below the 60 % threshold');
});
