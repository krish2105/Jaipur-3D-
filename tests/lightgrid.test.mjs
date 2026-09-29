import test from 'node:test';
import assert from 'node:assert/strict';
import { LightGridCPU, toHalf, fromHalf } from '../src/festival/lightgrid.js';
import { Bins } from '../src/festival/bins.js';
import { makeBurst, FIREWORK_COLORS } from '../src/festival/fireworks.js';
import { mulberry32 } from '../src/core/rng.js';

test('half floats: round trip within half precision across the range the grid uses', () => {
  for (const v of [0, 0.001, 0.0123, 0.5, 1, 1.5, 3.14159, 10, 100.25, 443.0, 588.5, 2048, 60000]) {
    const r = fromHalf(toHalf(v));
    assert.ok(Math.abs(r - v) <= Math.max(v * 0.001, 6e-8), `${v} -> ${r}`);
  }
  assert.equal(fromHalf(toHalf(1e9)), 65504, 'clamps to the largest finite half');
  assert.equal(fromHalf(toHalf(-2.5)), -2.5);
  assert.ok(Number.isNaN(fromHalf(toHalf(NaN))));
});

const flat = () => 443;

test('LightGridCPU: recentre snaps to whole cells and only moves when the camera drifts 18 % of the size', () => {
  const g = new LightGridCPU({ n: 64, size: 256, groundAt: flat });
  assert.ok(g.needsRecentre(10, 10), 'invalid before the first centre');
  g.recentre(103.7, -58.2);
  assert.ok(Math.abs(g.cx / g.snap - Math.round(g.cx / g.snap)) < 1e-9 && Math.abs(g.cz / g.snap - Math.round(g.cz / g.snap)) < 1e-9);
  assert.equal(g.needsRecentre(103.7 + 20, -58.2 - 20), false, 'small drift: keep the grid (no shimmer)');
  assert.equal(g.needsRecentre(g.cx + 50, g.cz), true, 'drift beyond 18 % of 256 m re-centres');
  assert.equal(g.ground[10], 443);
});

test('LightGridCPU: a splat is centred on the source, smooth, zero at its radius, additive, and clipped at the grid edge', () => {
  const g = new LightGridCPU({ n: 64, size: 256, groundAt: flat });
  g.recentre(0, 0);
  g.clear();
  const c = [0, 0, 0];
  g.splat(2, 2, 1, 0.5, 0.25, 20); // cell size is 4 m: (2, 2) is a cell centre
  const peak = g.sample(2, 2, c).slice();
  assert.ok(peak[0] > 0.9 && Math.abs(peak[1] / peak[0] - 0.5) < 1e-6 && Math.abs(peak[2] / peak[0] - 0.25) < 1e-6, 'colour ratio preserved ' + peak);
  const at10 = g.sample(10, 2, c)[0];
  assert.ok(at10 < peak[0] && at10 > 0, 'falls off');
  assert.equal(g.sample(2 + 22, 2, c)[0], 0, 'zero beyond the radius');
  assert.ok(Math.abs(g.sample(2 - 8, 2, c)[0] - g.sample(2 + 8, 2, c)[0]) < 1e-6, 'symmetric about the source');
  g.splat(2, 2, 1, 0.5, 0.25, 20);
  assert.ok(Math.abs(g.sample(2, 2, c)[0] - 2 * peak[0]) < 1e-6, 'additive');
  assert.equal(g.splat(5000, 5000, 1, 1, 1, 30), 0, 'a source far outside the grid touches nothing');
  const t = g.splat(120, 0, 1, 1, 1, 30); // half outside
  assert.ok(t > 0);
  g.clear();
  assert.equal(g.sample(2, 2, c)[0], 0);
});

test('LightGridCPU.pack writes rgb + ground height as half floats', () => {
  const g = new LightGridCPU({ n: 8, size: 64, groundAt: (x, z) => 400 + x * 0.1 });
  g.recentre(0, 0);
  g.clear();
  g.splat(0, 0, 2, 1, 0.5, 20);
  const dst = new Uint16Array(8 * 8 * 4);
  g.pack(dst);
  let sum = 0;
  for (let k = 0; k < 64; k++) { sum += fromHalf(dst[k * 4]); assert.ok(Math.abs(fromHalf(dst[k * 4 + 3]) - g.ground[k]) < 0.3, 'ground alpha'); }
  assert.ok(sum > 0);
});

test('Bins: within() is exact and nearest() never exceeds the cap and prefers close items', () => {
  const rng = mulberry32(5);
  const n = 3000, data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { data[i * 3] = (rng() - 0.5) * 2000; data[i * 3 + 1] = (rng() - 0.5) * 2000; data[i * 3 + 2] = i; }
  const b = new Bins(data, 3, 0, 1, 64);
  const within = b.within(100, -50, 150);
  const brute = []; for (let i = 0; i < n; i++) if (Math.hypot(data[i * 3] - 100, data[i * 3 + 1] + 50) <= 150) brute.push(i);
  assert.deepEqual(within.slice().sort((a, c) => a - c), brute);
  const out = new Int32Array(60);
  const k = b.nearest(100, -50, 400, 60, out);
  assert.ok(k <= 60 && k >= 30, 'count ' + k);
  const worst = Math.max(...Array.from(out.subarray(0, k)).map((i) => Math.hypot(data[i * 3] - 100, data[i * 3 + 1] + 50)));
  const all = []; for (let i = 0; i < n; i++) { const d = Math.hypot(data[i * 3] - 100, data[i * 3 + 1] + 50); if (d <= 400) all.push(d); }
  all.sort((a, c) => a - c);
  assert.ok(worst <= all[Math.min(all.length - 1, 60 + 20)] * 1.05 + 4.2, 'the chosen items are the near ones');
  assert.equal(b.nearest(100, -50, 30, 500, new Int32Array(500)), b.within(100, -50, 30).length, 'under the cap: everything in range');
});

test('makeBurst: even sphere, valid speeds / lives / colours; rings are planar; deterministic', () => {
  for (const kind of [0, 1, 2, 3]) {
    const b = makeBurst(mulberry32(7), kind, FIREWORK_COLORS[0], 160);
    assert.equal(b.length, 160 * 8);
    let mx = 0, my = 0, mz = 0, smax = 0;
    for (let i = 0; i < 160; i++) {
      const vx = b[i * 8], vy = b[i * 8 + 1], vz = b[i * 8 + 2], life = b[i * 8 + 3];
      assert.ok(Number.isFinite(vx + vy + vz) && life > 1.5 && life < 6, `kind ${kind} life ${life}`);
      const s = Math.hypot(vx, vy, vz);
      smax = Math.max(smax, s); assert.ok(s > 20 && s < 90, `speed ${s}`);
      mx += vx / s; my += vy / s; mz += vz / s;
      assert.ok(b[i * 8 + 4] >= 0 && b[i * 8 + 5] >= 0 && b[i * 8 + 6] >= 0);
    }
    if (kind !== 3) assert.ok(Math.hypot(mx, my, mz) / 160 < 0.08, `sphere is balanced (kind ${kind}): ${Math.hypot(mx, my, mz) / 160}`);
    else {
      // ring: every velocity is orthogonal to one common normal
      const n = [0, 0, 0];
      const a = [b[0], b[1], b[2]], c = [b[8 * 40], b[8 * 40 + 1], b[8 * 40 + 2]];
      n[0] = a[1] * c[2] - a[2] * c[1]; n[1] = a[2] * c[0] - a[0] * c[2]; n[2] = a[0] * c[1] - a[1] * c[0];
      const nl = Math.hypot(...n);
      for (let i = 0; i < 160; i++) assert.ok(Math.abs((b[i * 8] * n[0] + b[i * 8 + 1] * n[1] + b[i * 8 + 2] * n[2]) / nl / Math.hypot(b[i * 8], b[i * 8 + 1], b[i * 8 + 2])) < 1e-3, 'ring is planar');
    }
  }
  assert.deepEqual(Array.from(makeBurst(mulberry32(3), 0, FIREWORK_COLORS[1], 20)), Array.from(makeBurst(mulberry32(3), 0, FIREWORK_COLORS[1], 20)));
});
