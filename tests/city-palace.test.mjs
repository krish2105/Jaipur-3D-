import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildChandraMahal, buildMubarakMahal, buildGatehouse, poseFromBox } from '../src/world/landmarks/cityPalace.js';

const mat = new THREE.MeshStandardMaterial();

function windingStats(obj) {
  let bad = 0, total = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position.array, nrm = g.attributes.normal.array, idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
      const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      total++;
      if ((nx * nrm[3 * a] + ny * nrm[3 * a + 1] + nz * nrm[3 * a + 2]) / l < 0.15) bad++;
    }
  });
  return { bad, total };
}

test('Chandra Mahal has seven levels and stays inside its OSM footprint (+ small overhangs)', () => {
  const g = buildChandraMahal(mat, { len: 47.2, dep: 23.1 });
  assert.equal(g.userData.levels, 7);
  const box = new THREE.Box3().setFromObject(g);
  assert.ok(box.max.y > 28 && box.max.y < 50, 'height ' + box.max.y);
  assert.ok(box.max.x - box.min.x < 47.2 + 3 && box.max.x - box.min.x > 40, 'width ' + (box.max.x - box.min.x));
  assert.ok(box.max.z - box.min.z < 23.1 + 3.5, 'depth ' + (box.max.z - box.min.z));
});

test('Mubarak Mahal is a two-level square courtyard building of the OSM size', () => {
  const g = buildMubarakMahal(mat, { len: 27.5, dep: 27.1 });
  const box = new THREE.Box3().setFromObject(g);
  assert.ok(box.max.y > 12 && box.max.y < 22, 'height ' + box.max.y);
  assert.ok(Math.abs(box.max.x - box.min.x - 27.5) < 3);
});

test('gatehouse scales to its footprint and every model is wound consistently (no inside-out faces)', () => {
  const gate = buildGatehouse(mat, { len: 45, dep: 12 });
  const box = new THREE.Box3().setFromObject(gate);
  assert.ok(box.max.x - box.min.x > 44 && box.max.x - box.min.x < 50);
  for (const [name, obj] of [['chandra', buildChandraMahal(mat)], ['mubarak', buildMubarakMahal(mat)], ['gate', gate]]) {
    const { bad, total } = windingStats(obj);
    assert.ok(total > 200, name + ' has triangles');
    assert.ok(bad / total < 0.015, `${name}: ${bad}/${total} triangles wound against their normals`);
  }
});

test('poseFromBox orients the facade (+z) toward the requested side', () => {
  const box = { cx: 5, cz: 7, ux: -0.97, uz: -0.24, len: 47, dep: 23 };
  const p = poseFromBox(box, [0, 1]); // face south (+z world)
  // three.js: local +z -> (sin yaw, cos yaw)
  assert.ok(Math.cos(p.yaw) > 0.9, 'facade points south: ' + Math.cos(p.yaw));
  const q = poseFromBox(box, [0, -1]);
  assert.ok(Math.cos(q.yaw) < -0.9);
});
