import test from 'node:test';
import assert from 'node:assert/strict';
import { elements } from './fixtures/overpass-synthetic.mjs';
import * as L from '../scripts/lib/osm-bake-lib.mjs';
import { buildTileGeometry, RoadIndex, KIND } from '../src/world/buildingGeometry.js';

function chunkFromFixture() {
  let b = L.extractBuildings(elements);
  for (const x of b) { const c = L.centroid(x.outer); x.cx = c[0]; x.cz = c[1]; x.area = Math.abs(L.signedArea(x.outer)); }
  b = L.resolveParts(b);
  L.inferHeights(b);
  const tiles = L.chunkBuildings(b);
  return tiles.get('0_0');
}

function checkWinding(g) {
  let bad = 0, total = 0;
  const { pos, nrm, idx } = g;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue; // degenerate sliver (ok)
    const dot = (nx * nrm[4 * a] + ny * nrm[4 * a + 1] + nz * nrm[4 * a + 2]) / (len * 127);
    total++;
    if (dot < 0.2) bad++;
  }
  return { bad, total };
}

test('tile geometry: every triangle faces the way its vertex normal says (detail LOD)', () => {
  const chunk = chunkFromFixture();
  const g = buildTileGeometry(chunk, { detail: true });
  const { bad, total } = checkWinding(g);
  assert.ok(total > 100, 'has geometry: ' + total);
  assert.equal(bad, 0, `${bad}/${total} triangles wound against their normal`);
});

test('tile geometry: far LOD is cheaper and also consistent', () => {
  const chunk = chunkFromFixture();
  const near = buildTileGeometry(chunk, { detail: true });
  const far = buildTileGeometry(chunk, { detail: false });
  assert.ok(far.triCount < near.triCount);
  assert.equal(checkWinding(far).bad, 0);
});

test('wall UVs are real metres: u spans the wall length, v spans building height', () => {
  const chunk = chunkFromFixture();
  const g = buildTileGeometry(chunk, { detail: false });
  // first building in the fixture is 20 m x 10 m, height 12 m (tag): find a wall vertex pair with u=20 at v=12
  let found20 = false, foundH = false;
  for (let i = 0; i < g.vertexCount; i++) {
    if (Math.abs(g.uv[2 * i] - 20) < 0.06) found20 = true;
    if (Math.abs(g.uv[2 * i + 1] - 12) < 0.06 && g.a1[4 * i + 2] === Math.round((KIND.WALL / 16) * 255)) foundH = true;
  }
  assert.ok(found20, 'a 20 m wall has u=20');
  assert.ok(foundH, 'a 12 m building has wall v=12');
});

test('courtyard holes get inner walls', () => {
  const chunk = chunkFromFixture();
  const withHole = chunk.b.find((b) => b.q);
  assert.ok(withHole, 'fixture has a hole');
  const one = buildTileGeometry({ ...chunk, b: [withHole] }, { detail: false });
  const noHole = buildTileGeometry({ ...chunk, b: [{ ...withHole, q: undefined }] }, { detail: false });
  assert.ok(one.vertexCount > noHole.vertexCount, 'hole adds wall vertices');
});

test('road index flags walls facing a street and bazaar streets', () => {
  const idx = new RoadIndex();
  idx.addPolyline([[0, 0], [100, 0]], 14, 'Test Bazaar', 'tertiary');
  assert.ok(idx.query(50, 8).face);
  assert.ok(idx.query(50, 8).bazaar);
  assert.ok(!idx.query(50, 60).face);
});

test('instance heights (jharokhas, chhatris) are ABSOLUTE: they sit on the building, wherever the ground is', () => {
  const chunk = chunkFromFixture();
  // put every building on ground that is 120 m up: instances must follow (city.js must not add the terrain height a second time)
  const ground = new Float32Array(chunk.b.length * 2);
  for (let i = 0; i < chunk.b.length; i++) { ground[i * 2] = 120; ground[i * 2 + 1] = 1.3; }
  const roads = new RoadIndex();
  roads.addPolyline([[-100, 0], [700, 0]], 12, 'Test Bazaar Road', 'primary');
  const g = buildTileGeometry(chunk, { detail: true, roads, ground });
  const all = [...g.inst.jharokha.filter((_, i) => i % 7 === 1), ...g.inst.chhatri.filter((_, i) => i % 5 === 1)];
  assert.ok(all.length > 0, 'the fixture produces instances');
  for (const y of all) assert.ok(y >= 120 && y < 120 + 80, 'instance y is an absolute height on the building: ' + y);
  // and the mesh itself agrees: its lowest wall vertex is near the base
  let minY = 1e9;
  for (let i = 1; i < g.pos.length; i += 3) minY = Math.min(minY, g.pos[i]);
  assert.ok(minY > 120 - 5 && minY < 120, 'mesh base ' + minY);
});
