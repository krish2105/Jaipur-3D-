import test from 'node:test';
import assert from 'node:assert/strict';
import { idmAccel, IDM_DEFAULT } from '../src/sim/idm.js';

test('IDM: accelerates on a free road and stops accelerating at the desired speed', () => {
  assert.ok(idmAccel(0, 14, Infinity, 0) > 1.4);
  assert.ok(Math.abs(idmAccel(14, 14, Infinity, 0)) < 1e-9);
  assert.ok(idmAccel(16, 14, Infinity, 0) < 0, 'above the desired speed it brakes');
});

test('IDM: equilibrium gap for following at speed v is about s0 + v*T (net acceleration ~ 0 near it)', () => {
  const v = 10, v0 = 14, T = IDM_DEFAULT.T, s0 = IDM_DEFAULT.s0;
  // at equilibrium with a leader at the same speed: 1 - (v/v0)^4 = (s*/gap)^2  =>  gap = s* / sqrt(1 - (v/v0)^4)
  const sStar = s0 + v * T;
  const gapEq = sStar / Math.sqrt(1 - Math.pow(v / v0, 4));
  assert.ok(Math.abs(idmAccel(v, v0, gapEq, v)) < 1e-9);
  assert.ok(idmAccel(v, v0, gapEq * 0.6, v) < -0.5, 'too close -> brakes');
  assert.ok(idmAccel(v, v0, gapEq * 2.5, v) > 0, 'far -> accelerates');
});

test('IDM: brakes hard for a stopped obstacle, never harder than the emergency limit, and can always stop in time from a sane speed', () => {
  assert.ok(idmAccel(14, 14, 8, 0) <= -IDM_DEFAULT.brakeLimit + 1e-9, 'saturated at the limit');
  // simulate approaching a wall from 60 m at 14 m/s
  let v = 14, x = 0;
  const wall = 60, dt = 1 / 30;
  for (let i = 0; i < 30 * 30; i++) {
    const a = idmAccel(v, 14, wall - x - 0, 0);
    v = Math.max(0, v + a * dt);
    x += v * dt;
    assert.ok(x < wall, 'never reaches the wall, step ' + i);
    if (v < 0.01) break;
  }
  assert.ok(v < 0.05, 'stopped: ' + v);
  assert.ok(wall - x >= 0.5, 'stops with a gap of ' + (wall - x).toFixed(2));
});
