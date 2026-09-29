import test from 'node:test';
import assert from 'node:assert/strict';
import { KiteSim, KITE } from '../src/festival/kites.js';

const flat = () => 443;
const DT = 1 / 30;
function sim(o = {}) {
  return new KiteSim({ count: 1, seed: 11, groundAt: flat, roofs: null, ...o });
}
function run(s, seconds, cx = 0, cz = 0) { for (let k = 0; k < seconds * 30; k++) s.step(DT, cx, cz); }

test('a launched kite pays out its string, flies downwind of the flyer at a sane elevation and never blows up', () => {
  const s = sim();
  s.setWind(6.5, 2.6);
  s.launch(0, 0, 0);
  const p0 = s.pay[0];
  run(s, 10);
  assert.ok(s.pay[0] > p0 + 30, 'payout grows ~4.5 m/s: ' + s.pay[0]);
  run(s, 70);
  assert.equal(s.state[0], 0, 'still flying');
  const ax = s.anchor[0], ay = s.anchor[1], az = s.anchor[2];
  const dx = s.kp[0] - ax, dy = s.kp[1] - ay, dz = s.kp[2] - az;
  for (const v of [dx, dy, dz]) assert.ok(Number.isFinite(v));
  const wl = Math.hypot(6.5, 2.6), along = (dx * 6.5 + dz * 2.6) / wl;
  const d = Math.hypot(dx, dy, dz), elev = (Math.asin(dy / d) * 180) / Math.PI;
  assert.ok(along > 0.25 * s.len[0], `kite is downwind of the flyer: ${along.toFixed(1)} m of ${s.len[0].toFixed(0)} m string`);
  assert.ok(elev > 25 && elev < 82, 'elevation angle ' + elev.toFixed(1));
  assert.ok(d <= s.pay[0] * 1.06, `kite stays on its tether: ${d.toFixed(1)} of ${s.pay[0].toFixed(1)}`);
  const L = s.stringLength(0);
  assert.ok(L <= s.pay[0] * 1.08 && L >= d * 0.99, `string length conserved (payout ${s.pay[0].toFixed(1)}, measured ${L.toFixed(1)})`);
  assert.ok(s.kp[1] - ay > 15, 'kite climbs well above the roof: ' + (s.kp[1] - ay));
});

test('gustier / stronger wind pulls the kite lower and flatter or higher, but always downwind and finite (no NaN over 5 minutes)', () => {
  for (const [wx, wz] of [[2, 0], [7, -3], [11, 4]]) {
    const s = sim({ count: 4, seed: 3 });
    s.setWind(wx, wz);
    s.reset(0, 0, 5);
    run(s, 120);
    for (let i = 0; i < 4; i++) for (const v of [s.kp[i * 3], s.kp[i * 3 + 1], s.kp[i * 3 + 2]]) assert.ok(Number.isFinite(v) && Math.abs(v) < 5000, `wind ${wx},${wz}: kite ${i} position ${v}`);
  }
});

test('cut strings: the kite drifts down, lands, and a new kite is launched from another anchor', () => {
  const s = sim({ count: 1, seed: 5 });
  s.setWind(6.5, 1.5);
  s.nextCut = 1e9; // no random cut: this test cuts by hand
  s.launch(0, 0, 0);
  run(s, 40);
  const y0 = s.kp[1];
  assert.equal(s.cut(0), true);
  assert.equal(s.cut(0), false, 'cutting twice does nothing');
  assert.equal(s.state[0], 1);
  run(s, 2);
  const yCut = s.kp[1];
  run(s, 60);
  assert.ok(s.stats.launched >= 2 || s.state[0] === 2, 'kite landed and was relaunched (or waits to relaunch)');
  assert.ok(y0 > 15 && yCut <= y0 + 5, 'it did not go up after the cut');
});

test('deterministic for a seed; different seeds differ', () => {
  const mk = (seed) => { const s = sim({ count: 6, seed }); s.setWind(4, 2); s.reset(0, 0, 3); run(s, 20); return Array.from(s.kp); };
  assert.deepEqual(mk(9), mk(9));
  assert.notDeepEqual(mk(9), mk(10));
});

test('flyers stand on real roofs when footprint anchors are supplied (else on open ground), 45-300 m from the camera', () => {
  const roofs = new Float32Array(4 * 400);
  for (let i = 0; i < 400; i++) { roofs[i * 4] = ((i * 37) % 900) - 450; roofs[i * 4 + 1] = ((i * 91) % 900) - 450; roofs[i * 4 + 2] = 6 + (i % 5); roofs[i * 4 + 3] = 60 + (i % 7) * 10; }
  const s = sim({ count: 12, seed: 2, roofs });
  s.reset(0, 0, 1);
  for (let i = 0; i < 12; i++) {
    const ax = s.anchor[i * 3], ay = s.anchor[i * 3 + 1], az = s.anchor[i * 3 + 2];
    const k = [...Array(400).keys()].find((j) => roofs[j * 4] === ax && roofs[j * 4 + 1] === az);
    assert.ok(k !== undefined, 'anchor is exactly a roof anchor');
    assert.ok(Math.abs(ay - (443 + roofs[k * 4 + 2] + 1.15)) < 1e-4, 'hands 1.15 m above the roof top');
  }
  const g = sim({ count: 8, seed: 2 });
  g.reset(100, -50, 1);
  for (let i = 0; i < 8; i++) { const d = Math.hypot(g.anchor[i * 3] - 100, g.anchor[i * 3 + 2] + 50); assert.ok(d >= 54 && d <= 296, 'ground flyer at ' + d); }
});

test('kites that drift out of reach are recycled next to the camera', () => {
  const s = sim({ count: 3, seed: 8 });
  s.reset(0, 0, 1);
  const before = s.stats.recycled;
  run(s, 1, 3000, 3000); // camera teleports 4 km away
  assert.ok(s.stats.recycled >= before + 3);
  for (let i = 0; i < 3; i++) assert.ok(Math.hypot(s.anchor[i * 3] - 3000, s.anchor[i * 3 + 2] - 3000) < 400);
});

test('pose basis is orthonormal for flying and tumbling kites', () => {
  const s = sim({ count: 3, seed: 6 });
  s.setWind(6.5, 2.6);
  s.reset(0, 0, 8);
  s.cut(1);
  run(s, 3);
  const o = new Array(9);
  for (let i = 0; i < 3; i++) {
    s.pose(i, o);
    const dot = (a, b) => o[a] * o[b] + o[a + 1] * o[b + 1] + o[a + 2] * o[b + 2];
    assert.ok(Math.abs(dot(0, 0) - 1) < 1e-5 && Math.abs(dot(3, 3) - 1) < 1e-5 && Math.abs(dot(6, 6) - 1) < 1e-5);
    assert.ok(Math.abs(dot(0, 3)) < 1e-5 && Math.abs(dot(0, 6)) < 1e-5 && Math.abs(dot(3, 6)) < 1e-5);
  }
});

test('kite fighting: over ten minutes some kites are cut, most stay aloft, the population size is constant', () => {
  const s = sim({ count: 30, seed: 4 });
  s.setWind(6.5, 2.6);
  s.reset(0, 0, 5);
  let maxCut = 0;
  for (let k = 0; k < 600 * 30; k++) { s.step(DT, 0, 0); if (k % 30 === 0) { const c = s.counts(); assert.equal(c[0] + c[1] + c[2], 30); maxCut = Math.max(maxCut, c[1]); } }
  assert.ok(s.stats.cut >= 3, 'cuts: ' + s.stats.cut);
  assert.ok(maxCut <= 12, 'not a sky full of falling kites: ' + maxCut);
  assert.ok(s.counts()[0] >= 18, 'most kites are flying: ' + s.counts());
  assert.ok(KITE.mass > 0);
});
