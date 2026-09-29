import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticDistrict } from './fixtures/synthetic-district.mjs';
import { bakeElements } from '../scripts/bake-osm.mjs';
import { buildTileGeometry, RoadIndex } from '../src/world/buildingGeometry.js';

test('synthetic district bakes and builds geometry with bazaar frontage + jharokhas', () => {
  const { files, manifest } = bakeElements(syntheticDistrict());
  assert.ok(manifest.counts.buildings > 80, 'buildings: ' + manifest.counts.buildings);
  assert.ok(manifest.heightSources.inferred > 10, 'some heights inferred');
  let jh = 0, faceRoad = 0, tris = 0;
  for (const [name, chunk] of files) {
    if (!name.startsWith('b_')) continue;
    const roads = new RoadIndex();
    for (const [rn, rc] of files) {
      if (!rn.startsWith('r_')) continue;
      const dx = (rc.t[0] - chunk.t[0]) * 500, dz = (rc.t[1] - chunk.t[1]) * 500;
      for (const w of rc.w) { const pts = []; for (let i = 0; i < w.p.length; i += 2) pts.push([w.p[i] / 10 + dx, w.p[i + 1] / 10 + dz]); roads.addPolyline(pts, w.w, w.n || '', w.c); }
    }
    const g = buildTileGeometry(chunk, { detail: true, roads });
    jh += g.inst.jharokha.length / 7;
    faceRoad += g.stats.facingRoad;
    tris += g.triCount;
  }
  assert.ok(faceRoad > 100, 'walls facing the street: ' + faceRoad);
  assert.ok(jh > 5, 'jharokhas placed: ' + jh);
  assert.ok(tris > 5000, 'triangles: ' + tris);
});
