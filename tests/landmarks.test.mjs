import test from 'node:test';
import assert from 'node:assert/strict';
import { windowCounts, HAWA_WINDOWS } from '../src/world/landmarks/hawaMahal.js';

test('Hawa Mahal window distribution sums to exactly 953', () => {
  const c = windowCounts();
  assert.equal(c.reduce((a, b) => a + b, 0), HAWA_WINDOWS);
  assert.equal(HAWA_WINDOWS, 953);
  assert.ok(c[0] > c[4], 'pyramidal: lower storeys carry more windows');
});

import { buildHawaMahal } from '../src/world/landmarks/hawaMahal.js';
import * as THREE from 'three';
test('Hawa Mahal builds with exactly 953 instanced windows and sane height', () => {
  const mat = new THREE.MeshStandardMaterial();
  const g = buildHawaMahal(mat, mat);
  const inst = g.children.find((c) => c.isInstancedMesh);
  assert.equal(inst.count, 953);
  assert.ok(g.userData.heightM > 24 && g.userData.heightM < 34, 'height ' + g.userData.heightM);
  // all windows must sit within the facade footprint
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  let maxX = 0;
  for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m); p.setFromMatrixPosition(m); maxX = Math.max(maxX, Math.abs(p.x)); }
  assert.ok(maxX <= 18, 'window x extent ' + maxX);
});

import { buildJantarMantar } from '../src/world/landmarks/jantarMantar.js';
import { buildJalMahal } from '../src/world/landmarks/jalMahal.js';
test('Jantar Mantar and Jal Mahal build; Samrat Yantra reaches ~27 m; Jal Mahal shows only the top floor', () => {
  const mat = new THREE.MeshStandardMaterial();
  const jm = buildJantarMantar(mat);
  const box = new THREE.Box3().setFromObject(jm);
  assert.ok(box.max.y > 24 && box.max.y < 32, 'Samrat height ' + box.max.y);
  assert.ok(box.max.x - box.min.x > 90, 'compound width');
  const jal = buildJalMahal(mat);
  const jb = new THREE.Box3().setFromObject(jal);
  assert.ok(jb.max.y < 20 && jb.max.y > 8, 'Jal Mahal visible height ' + jb.max.y);
  assert.ok(jb.min.y < -5, 'submerged storeys extend below the waterline');
});

function windingStats(obj) {
  let bad = 0, total = 0;
  obj.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh && false) return;
    const g = o.geometry;
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array, idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
      const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      total++;
      if ((nx * nrm[3 * a] + ny * nrm[3 * a + 1] + nz * nrm[3 * a + 2]) / l < 0.15) bad++;
    }
  });
  return { bad, total };
}
test('landmark meshes: triangle winding agrees with normals (no inside-out faces)', () => {
  const mat = new THREE.MeshStandardMaterial();
  for (const [name, obj] of [['hawa', buildHawaMahal(mat, mat)], ['jantar', buildJantarMantar(mat)], ['jal', buildJalMahal(mat)]]) {
    const { bad, total } = windingStats(obj);
    assert.ok(total > 100, name + ' has triangles');
    assert.ok(bad / total < 0.015, `${name}: ${bad}/${total} triangles wound against their normals`);
  }
});
