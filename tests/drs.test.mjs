import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicResolution, PerfMonitor } from '../src/core/perf.js';

// feed `seconds` of frames of `ms` each (clamped frame times, like the loop reports them)
function feed(d, ms, seconds) {
  let last = d.scale;
  const n = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) { const c = d.push(ms); if (c !== null) last = c; }
  return last;
}

test('60 fps target: fast frames raise the resolution to its ceiling, slow frames lower it to the floor, on-target frames hold it', () => {
  const d = new DynamicResolution({ min: 0.75, max: 2, targetMs: 1000 / 60, enabled: true });
  d.scale = 1.2;
  feed(d, 16.5, 30);
  assert.ok(Math.abs(d.scale - 1.2) < 1e-9, 'holds at 60 fps: ' + d.scale);
  feed(d, 10, 30);
  assert.equal(d.scale, 2, 'headroom -> ceiling');
  feed(d, 21, 60);
  assert.equal(d.scale, 0.75, 'over budget -> floor');
  assert.ok(d.atFloorSeconds > 0);
});

test('60 fps target reacts to a second averaging just over ~17.7 ms (not only to 19 ms as before)', () => {
  const d = new DynamicResolution({ min: 0.75, max: 2, targetMs: 1000 / 60, enabled: true });
  feed(d, 18.2, 4);
  assert.ok(d.scale < 2, 'stepped down at 18.2 ms: ' + d.scale);
});

test('a 30 fps capped phone: holding the cap does NOT ratchet the resolution down, missing it does, and it probes back up slowly', () => {
  const d = new DynamicResolution({ min: 0.6, max: 1.25, targetMs: 1000 / 30, slowFactor: 1.3, capMs: 1000 / 30, enabled: true });
  // display cadence noise around the cap (33.3-34.7 ms on a 144 Hz phone) must never lower the resolution
  for (let k = 0; k < 40; k++) feed(d, k % 2 ? 34.7 : 33.4, 1);
  assert.equal(d.scale, 1.25, 'stays at the ceiling while the cap is held');
  feed(d, 50, 10); // a heavy scene misses the cap
  const low = d.scale;
  assert.ok(low < 1.25, 'lowered when the cap is missed: ' + low);
  feed(d, 33.4, 7);
  assert.equal(d.scale, low, 'needs 8 s of holding the cap before probing upward');
  feed(d, 33.4, 12);
  assert.ok(d.scale > low, 'probes back up once the cap is held: ' + d.scale);
  feed(d, 33.4, 200);
  assert.equal(d.scale, 1.25, 'recovers to the ceiling (the old rule could only go down)');
});

test('disabled dynamic resolution never changes; PerfMonitor.mark keeps a smoothed per-section time', () => {
  const d = new DynamicResolution({ min: 0.5, max: 2, targetMs: 16.7, enabled: false });
  assert.equal(feed(d, 40, 20), 2);
  const p = new PerfMonitor();
  p.mark('a', 2); p.mark('a', 4); p.mark('b', 1);
  assert.ok(p.cpu.a > 2 && p.cpu.a < 4);
  assert.ok(Math.abs(p.cpuTotal() - (p.cpu.a + p.cpu.b)) < 1e-9);
});
