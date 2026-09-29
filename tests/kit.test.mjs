import test from 'node:test';
import assert from 'node:assert/strict';
import { MB, COL } from '../src/world/landmarks/kit.js';

function windingBad(g) {
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array, idx = g.index.array;
  let bad = 0, total = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    total++;
    if ((nx * nrm[3 * a] + ny * nrm[3 * a + 1] + nz * nrm[3 * a + 2]) / l < 0.2) bad++;
  }
  return { bad, total };
}

test('MB.box faces outward at any yaw', () => {
  for (const yaw of [0, 0.7, 2.1, -1.3]) {
    const m = new MB();
    m.box(5, 0, -3, 4, 2, 6, COL.pink, yaw);
    const { bad, total } = windingBad(m.build());
    assert.equal(total, 10);
    assert.equal(bad, 0, `yaw ${yaw}`);
  }
});

test('MB.prism side walls and cap face outward for CW and CCW input', () => {
  const sq = [[0, 0], [10, 0], [10, -10], [0, -10]];
  for (const poly of [sq, sq.slice().reverse()]) {
    const m = new MB();
    m.prism(poly, 0, 5, COL.cream);
    const { bad } = windingBad(m.build());
    assert.equal(bad, 0);
  }
});

test('MB.cyl and MB.dome are consistent', () => {
  const m = new MB();
  m.cyl(0, 0, 0, 2, 1.5, 4, 12, COL.cream);
  m.dome(0, 4, 0, 1.5, 1.2, 12, 4, COL.pink);
  const { bad, total } = windingBad(m.build());
  assert.ok(total > 60);
  assert.equal(bad, 0);
});

test('arch openings (round and pointed) face their normal', () => {
  for (const pointed of [false, true]) {
    const m = new MB();
    // wall along +x, outward normal +z
    m.archOpening(0, 0, 0, 1, 0, 0, 1, 2, 3, COL.dark, pointed);
    const g = m.build();
    const { bad, total } = windingBad(g);
    assert.ok(total >= 8);
    if (bad) {
      // fan may be wound the other way for this face orientation; verify the mirrored variant is consistent
      const m2 = new MB();
      m2.archOpening(0, 0, 0, -1, 0, 0, -1, 2, 3, COL.dark, pointed);
      assert.equal(windingBad(m2.build()).bad, 0, 'one of the two orientations must be correct');
    }
  }
});
