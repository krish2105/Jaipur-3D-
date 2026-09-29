import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { catmullRom, polylineLengths, polylineAt, stickVector, stepMove, look, forward, headingOf, wrapAngle, smoothstep01 } from '../src/camera/math.js';
import { chainRoute, densestSpot } from '../src/camera/routes.js';
import { StreetGraph } from '../src/sim/graph.js';

test('catmullRom passes through its control points and is continuous', () => {
  const P = [[0, 0, 0], [10, 5, 0], [20, 0, 10], [30, 8, 10]];
  for (let i = 0; i < P.length; i++) { const q = catmullRom(P, i / (P.length - 1)); for (let k = 0; k < 3; k++) assert.ok(Math.abs(q[k] - P[i][k]) < 1e-9, `point ${i}`); }
  let prev = catmullRom(P, 0), maxJump = 0;
  for (let i = 1; i <= 300; i++) { const q = catmullRom(P, i / 300); maxJump = Math.max(maxJump, Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q; }
  assert.ok(maxJump < 0.5, 'smooth: biggest step ' + maxJump);
  assert.deepEqual(catmullRom([[3, 4]], 0.5), [3, 4]);
  assert.deepEqual(catmullRom(P, -1), catmullRom(P, 0)); assert.deepEqual(catmullRom(P, 2), catmullRom(P, 1));
});

test('headings: forward vector follows the compass convention (0 = north = -z, east = +x)', () => {
  const n = forward(0, 0), e = forward(Math.PI / 2, 0), up = forward(0, Math.PI / 2);
  assert.ok(Math.abs(n[2] + 1) < 1e-9 && Math.abs(n[0]) < 1e-9);
  assert.ok(Math.abs(e[0] - 1) < 1e-9);
  assert.ok(Math.abs(up[1] - 1) < 1e-9);
  assert.ok(Math.abs(headingOf(1, 0) - Math.PI / 2) < 1e-9 && Math.abs(headingOf(0, -1)) < 1e-9);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9 || Math.abs(wrapAngle(3 * Math.PI) + Math.PI) < 1e-9);
  assert.equal(smoothstep01(-1), 0); assert.equal(smoothstep01(2), 1);
});

test('polyline sampling: arc length, tangent, clamping', () => {
  const pts = Float32Array.from([0, 0, 10, 0, 10, 20]);
  const cum = polylineLengths(pts);
  assert.deepEqual(Array.from(cum), [0, 10, 30]);
  const a = polylineAt(pts, cum, 5), b = polylineAt(pts, cum, 20), c = polylineAt(pts, cum, 99);
  assert.ok(Math.abs(a.x - 5) < 1e-6 && a.dx === 1 && a.dz === 0);
  assert.ok(Math.abs(b.x - 10) < 1e-6 && Math.abs(b.z - 10) < 1e-6 && b.dz === 1);
  assert.ok(c.x === 10 && c.z === 20, 'clamped to the end');
});

test('touch stick: dead zone, clamping, direction', () => {
  assert.deepEqual(stickVector(2, 1, 60), { x: 0, y: 0 });
  const r = stickVector(60, 0, 60);
  assert.ok(Math.abs(r.x - 1) < 1e-9 && r.y === 0);
  const over = stickVector(300, 0, 60);
  assert.ok(Math.abs(over.x - 1) < 1e-9, 'clamped to 1');
  const up = stickVector(0, -40, 60);
  assert.ok(up.y < 0 && up.y > -1 && up.x === 0, 'dragging up is negative y (forward)');
  const diag = stickVector(100, 100, 60);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9);
});

test('stepMove: flying accelerates smoothly, never goes below the ground clearance, walking follows terrain at eye height', () => {
  const ground = (x) => 100 + 0.05 * x; // a slope
  const s = { pos: [0, 200, 0], vel: [0, 0, 0], yaw: Math.PI / 2, pitch: 0 }; // heading east
  for (let i = 0; i < 60; i++) stepMove(s, { fwd: 1, right: 0, up: 0, boost: 0, slow: 0 }, 1 / 60, { mode: 'fly', speed: 30, groundAt: ground });
  assert.ok(s.pos[0] > 15 && s.pos[0] < 30 && Math.abs(s.pos[2]) < 1e-6, 'moved east: ' + s.pos[0]);
  assert.ok(s.vel[0] > 15 && s.vel[0] < 30);
  // dive into the ground: clamped
  const d = { pos: [0, 110, 0], vel: [0, 0, 0], yaw: 0, pitch: -1.4 };
  for (let i = 0; i < 240; i++) stepMove(d, { fwd: 1, right: 0, up: 0, boost: 1, slow: 0 }, 1 / 60, { mode: 'fly', speed: 30, groundAt: ground, minHeight: 2.5 });
  assert.ok(d.pos[1] >= ground(d.pos[0]) + 2.5 - 1e-9, 'never below ground + 2.5 m');
  // walking uphill keeps 1.7 m eye height
  const w = { pos: [0, 101.7, 0], vel: [0, 0, 0], yaw: Math.PI / 2, pitch: 0.5 };
  for (let i = 0; i < 600; i++) stepMove(w, { fwd: 1, right: 0, up: 1, boost: 0, slow: 0 }, 1 / 60, { mode: 'walk', speed: 5, groundAt: ground, eye: 1.7 });
  assert.ok(Math.abs(w.pos[1] - (ground(w.pos[0]) + 1.7)) < 0.15, 'eye height on a slope: ' + (w.pos[1] - ground(w.pos[0])));
  // strafing and boost / slow
  const q = { pos: [0, 50, 0], vel: [0, 0, 0], yaw: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) stepMove(q, { fwd: 0, right: 1, up: 0, boost: 0, slow: 1 }, 1 / 60, { mode: 'fly', speed: 30, groundAt: () => 0 });
  assert.ok(q.pos[0] > 0 && q.pos[0] < 12, 'slow strafe east is short: ' + q.pos[0]);
});

test('look: yaw wraps, pitch is limited, dragging right turns right', () => {
  const s = { yaw: 0, pitch: 0 };
  look(s, 100, 0); assert.ok(s.yaw > 0);
  look(s, 0, -10000); assert.equal(s.pitch, 1.5);
  look(s, 0, 100000); assert.equal(s.pitch, -1.5);
  look(s, 1e6, 0); assert.ok(s.yaw >= -Math.PI && s.yaw <= Math.PI);
});

test('chainRoute: a name chains connected edges into one ordered polyline (synthetic graph)', () => {
  // three edges of "Test Route" in a line, plus an unrelated edge
  const g = new StreetGraph({ v: 1, unit: 'dm', nodes: [[0, 0, 0], [1000, 0, 0], [2000, 0, 0], [3000, 0, 0], [0, 900, 0]], edges: [
    { a: 1, b: 2, len: 100, c: 'tertiary', w: 8, ln: 2, v: 20, o: 0, car: 1, n: 'Test Route' },
    { a: 0, b: 1, len: 100, c: 'tertiary', w: 8, ln: 2, v: 20, o: 0, car: 1, n: 'Test Route' },
    { a: 2, b: 3, len: 100, c: 'tertiary', w: 8, ln: 2, v: 20, o: 0, car: 1, n: 'Test Route' },
    { a: 0, b: 4, len: 90, c: 'tertiary', w: 8, ln: 2, v: 20, o: 0, car: 1, n: 'Other' }], signals: [] });
  const r = chainRoute(g, /test route/i);
  assert.equal(r.length / 2, 4);
  const xs = [r[0], r[2], r[4], r[6]];
  assert.ok(JSON.stringify(xs) === '[0,100,200,300]' || JSON.stringify(xs) === '[300,200,100,0]', 'ordered along the street: ' + xs);
  assert.equal(chainRoute(g, /nothing/).length, 0);
});

test('densestSpot picks the busiest stretch and a unit street direction perpendicular to the span', () => {
  const sp = [];
  const add = (x, z) => sp.push(x, 5, z - 6, x, 5, z + 6, 0.3, 0); // spans across the z axis, street runs along x
  for (let i = 0; i < 8; i++) add(1000 + i * 12, 0);
  add(-500, 0); add(-900, 300);
  const s = densestSpot(Float32Array.from(sp));
  assert.ok(s.mx > 990 && s.mx < 1100 && s.dense >= 8);
  assert.ok(Math.abs(Math.hypot(s.tx, s.tz) - 1) < 1e-9 && Math.abs(Math.abs(s.tx) - 1) < 1e-6, 'street direction along x');
  assert.equal(densestSpot(new Float32Array(0)), null);
});

const REAL = existsSync('public/data/osm/graph.json');
test('real Jaipur graph: Johari Bazaar chains into a long, continuous route for the camera', { skip: !REAL }, () => {
  const g = new StreetGraph(JSON.parse(readFileSync('public/data/osm/graph.json', 'utf8')));
  for (const [re, min] of [[/johari/i, 400], [/tripolia/i, 400], [/chandpol/i, 400]]) {
    const r = chainRoute(g, re);
    assert.ok(r.length / 2 > 10, `${re} points: ${r.length / 2}`);
    const cum = polylineLengths(r);
    assert.ok(cum[cum.length - 1] > min, `${re} route length ${cum[cum.length - 1].toFixed(0)} m`);
    let maxGap = 0;
    for (let i = 1; i < r.length / 2; i++) maxGap = Math.max(maxGap, Math.hypot(r[i * 2] - r[i * 2 - 2], r[i * 2 + 1] - r[i * 2 - 1]));
    // continuity: two consecutive points are joined by one OSM edge segment, so no gap can exceed the longest edge of that name (a jump between unconnected edges would)
    let longest = 0;
    for (let e = 0; e < g.edgeCount; e++) if (g.name[e] && re.test(g.name[e])) longest = Math.max(longest, g.len[e]);
    assert.ok(maxGap <= longest + 1, `${re} continuous: largest gap ${maxGap.toFixed(0)} m vs longest edge ${longest.toFixed(0)} m`);
  }
});
