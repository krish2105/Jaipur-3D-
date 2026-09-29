import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeBolt } from '../src/weather/lightning.js';
import { Weather, WEATHER_PRESETS } from '../src/weather/weather.js';

test('makeBolt: deterministic, connected from cloud to ground, bounded segment count, branches are lower generation-ordered', () => {
  const top = new THREE.Vector3(0, 1200, 0), ground = new THREE.Vector3(300, 0, -2000);
  const a = makeBolt(top, ground, 42), b = makeBolt(top, ground, 42), c = makeBolt(top, ground, 43);
  assert.equal(a.length, b.length);
  assert.ok(a.every((s, i) => s.a.equals(b[i].a) && s.b.equals(b[i].b)), 'same seed -> same bolt');
  assert.ok(a.length !== c.length || a.some((s, i) => !s.a.equals(c[i].a)), 'different seed -> different bolt');
  const main = a.filter((s) => s.gen === 0);
  assert.ok(main.length >= 32, 'main channel is finely segmented: ' + main.length);
  assert.ok(main[0].a.equals(top), 'starts at the cloud');
  assert.ok(main[main.length - 1].b.distanceTo(ground) < 1e-6, 'ends at the strike point');
  for (let i = 1; i < main.length; i++) assert.ok(main[i].a.distanceTo(main[i - 1].b) < 1e-6, 'channel is continuous');
  assert.ok(a.length <= 420, 'segment cap: ' + a.length);
  assert.ok(a.some((s) => s.gen >= 1), 'has branches');
});

test('Weather flash: peaks at the strike, has several return strokes, then decays to zero', () => {
  const w = new Weather('monsoon');
  assert.equal(w.flash, 0);
  w.strikeNow(0.3);
  assert.equal(w.bolts.length, 1);
  assert.equal(w.bolts[0].id, 1);
  const seen = [];
  const dt = 1 / 120;
  for (let t = 0; t < 1.5; t += dt) { w.update(dt, 1); seen.push(w.flash); }
  const peak = Math.max(...seen);
  assert.ok(peak > 0.9, 'peak ' + peak);
  // count local maxima above 0.3: several strokes, not one smooth decay
  let strokes = 0;
  for (let i = 2; i < seen.length - 2; i++) if (seen[i] > 0.3 && seen[i] >= seen[i - 1] && seen[i] > seen[i + 1] && seen[i] > seen[i - 2]) strokes++;
  assert.ok(strokes >= 2, 'multi-stroke flash, strokes: ' + strokes);
  assert.ok(seen[seen.length - 1] < 0.01, 'decayed');
  w.strikeNow(0.7);
  assert.equal(w.bolts[w.bolts.length - 1].id, 2, 'ids increase');
});

test('weather presets: dust storm is denser and windier than haze; monsoon is wet, cloudy and has lightning', () => {
  const { clear, dust, loo, monsoon } = WEATHER_PRESETS;
  assert.ok(loo.dust > dust.dust && dust.dust > clear.dust);
  assert.ok(loo.windSpeed > dust.windSpeed && dust.windSpeed > clear.windSpeed);
  assert.ok(loo.fogGain > dust.fogGain);
  assert.ok(monsoon.rain > 0.5 && monsoon.cloudCover > 0.9 && monsoon.lightningRate > 0);
  assert.equal(clear.rain, 0);
});
