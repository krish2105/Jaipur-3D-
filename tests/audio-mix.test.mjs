import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMix, soundDelay, thunderFor, nearestSources, engineParams, hornFor, hornRate, birdRate, crackerRate, bazaarBusy, fillWhite, fillPink, fillBrown, fillPatter, fillImpulse, rms, SPEED_OF_SOUND } from '../src/audio/mix.js';

const base = { hour: 12, sunAlt: 50, rain: 0, wetness: 0, windSpeed: 3, dust: 0.1, storm: 0, overcast: 0, veh: 60, ped: 80, nearPeds: 30, nearVeh: 20, birds: 10, kites: 0, altitude: 2, festival: 'off', festivalStrength: 0 };
const mix = (o) => computeMix({ ...base, ...o });

test('speed of sound: delays are distance / 343 m/s, thunder is later and quieter when far', () => {
  assert.equal(SPEED_OF_SOUND, 343);
  assert.ok(Math.abs(soundDelay(343) - 1) < 1e-12);
  assert.equal(soundDelay(-5), 0);
  const near = thunderFor({ dist: 900, bearing: 1 }), far = thunderFor({ dist: 6500, bearing: 1 });
  assert.ok(far.delay > near.delay * 6 && Math.abs(far.delay - 6500 / 343) < 1e-9);
  assert.ok(far.gain < near.gain && far.crack < near.crack && far.rumble >= near.rumble);
  for (const t of [near, far]) assert.ok(t.gain > 0 && t.gain <= 1 && t.crack >= 0 && t.crack <= 1);
});

test('mix: rain, wind and wet roads follow the weather; birds go quiet in rain and at night; insects only at night', () => {
  const dry = mix({}), wet = mix({ rain: 0.9, wetness: 0.9 });
  assert.equal(dry.rain, 0);
  assert.ok(wet.rain > 0.8, 'rain layer ' + wet.rain);
  assert.ok(wet.swish > dry.swish && wet.crowd < dry.crowd && wet.birds < dry.birds, 'rain: wet-road hiss up, crowds and birds muffled');
  assert.ok(mix({ windSpeed: 12 }).wind > mix({ windSpeed: 2 }).wind);
  const dawn = mix({ hour: 5.8, sunAlt: 2 }), noon = mix({ hour: 13 }), night = mix({ hour: 23, sunAlt: -40 });
  assert.ok(dawn.birds > noon.birds, 'dawn chorus louder than noon: ' + dawn.birds + ' vs ' + noon.birds);
  assert.equal(night.birds, 0);
  assert.equal(noon.insects, 0);
  assert.ok(night.insects > 0.4, 'crickets at night ' + night.insects);
  assert.ok(night.crowd < noon.crowd, 'bazaar is quieter at 23:00');
  for (const m of [dry, wet, dawn, noon, night]) for (const k of ['crowd', 'trafficBed', 'city', 'birds', 'insects', 'wind', 'rain', 'swish', 'festival', 'crackers', 'drums', 'kiteHum', 'bells']) assert.ok(m[k] >= 0 && m[k] <= 1 && Number.isFinite(m[k]), `${k}=${m[k]}`);
});

test('mix: up in the air the city thins out and the wind takes over', () => {
  const street = mix({ altitude: 2, windSpeed: 6 }), drone = mix({ altitude: 420, windSpeed: 6 });
  assert.ok(drone.crowd < street.crowd * 0.35 && drone.city < street.city * 0.4);
  assert.ok(drone.wind > street.wind);
  assert.ok(drone.air > 0.9 && street.air < 0.05);
});

test('mix: festival layers are only on for their festival, after dark for Diwali and by day for Sankranti', () => {
  const off = mix({ hour: 21, sunAlt: -30 });
  assert.equal(off.crackers, 0); assert.equal(off.kiteHum, 0);
  const diwali = mix({ hour: 21, sunAlt: -30, festival: 'diwali', festivalStrength: 1 });
  assert.ok(diwali.crackers > 0.5 && diwali.festival > 0.9);
  assert.equal(mix({ hour: 12, sunAlt: 50, festival: 'diwali', festivalStrength: 1 }).crackers, 0, 'no crackers in full daylight');
  assert.equal(mix({ hour: 21, sunAlt: -30, festival: 'diwali', festivalStrength: 0 }).crackers, 0, 'festival not faded in yet');
  const sk = mix({ hour: 12, festival: 'sankranti', kites: 40, windSpeed: 7 });
  assert.ok(sk.kiteHum > 0.5 && sk.drums > 0);
  assert.equal(mix({ hour: 23, sunAlt: -40, festival: 'sankranti', kites: 40, windSpeed: 7 }).kiteHum, 0, 'no kites at night');
});

test('event rates: horns need traffic and daytime, birds scale with the dawn chorus, crackers with the festival', () => {
  assert.equal(hornRate(0, 1, 0), 0);
  assert.ok(hornRate(40, 1, 0) > hornRate(40, 1, 1) && hornRate(40, 1, 0) > hornRate(5, 1, 0));
  assert.ok(hornRate(1000, 1, 0) <= 2.4, 'capped');
  assert.ok(birdRate(1) > birdRate(0) && birdRate(0) > 0);
  assert.ok(crackerRate(1) > crackerRate(0));
  assert.ok(bazaarBusy(13) > 0.95 && bazaarBusy(3) === 0 && bazaarBusy(23.5) === 0);
});

test('nearestSources: picks the closest n within range, sorted, without allocating per item', () => {
  // stride 4: x, y, z, payload
  const a = new Float32Array(4 * 6);
  const pts = [[50, 0], [3, 4], [-10, 0], [200, 0], [0, 12], [1, 1]];
  pts.forEach(([x, z], i) => { a[i * 4] = x; a[i * 4 + 2] = z; });
  const out = nearestSources(a, 6, 4, 0, 2, 0, 0, 3, 100);
  assert.deepEqual(out.map((o) => o.i), [5, 1, 2]);
  assert.ok(Math.abs(out[1].d - 5) < 1e-6);
  assert.deepEqual(nearestSources(a, 6, 4, 0, 2, 0, 0, 10, 20).map((o) => o.i), [5, 1, 2, 4], 'range limits it; fewer than n is fine');
  assert.equal(nearestSources(a, 0, 4, 0, 2, 0, 0, 3, 100).length, 0);
});

test('engine and horn voices: sane frequencies per vehicle type, faster is higher, buses are the lowest', () => {
  const slow = engineParams(1, 1), fast = engineParams(1, 14);
  assert.ok(fast.f > slow.f && fast.cut > slow.cut);
  assert.ok(engineParams(3, 8).f < engineParams(1, 8).f && engineParams(0, 8).f > engineParams(1, 8).f);
  for (const t of [0, 1, 2, 3]) { const h = hornFor(t, 0.5); assert.ok(h[0] > 150 && h[0] < 1200 && h[2] > 0.1 && h[2] < 2 && h[3] > 0 && h[3] <= 1); }
  assert.ok(hornFor(3, 0)[0] < hornFor(0, 0)[0]);
});

test('buffers: noise generators are deterministic, finite, bounded and have the right character', () => {
  const N = 48000;
  const w = fillWhite(new Float32Array(N), 1), p = fillPink(new Float32Array(N), 2), b = fillBrown(new Float32Array(N), 3);
  for (const a of [w, p, b]) { assert.ok(a.every(Number.isFinite)); assert.ok(Math.max(...a.map(Math.abs)) < 4.5); assert.ok(rms(a) > 0.05); }
  assert.deepEqual(Array.from(fillWhite(new Float32Array(100), 1)), Array.from(w.subarray(0, 100)));
  // spectral tilt: brown has far more low-frequency energy relative to high than white (compare first differences: high-pass proxy)
  const hp = (a) => { let s = 0; for (let i = 1; i < a.length; i++) s += (a[i] - a[i - 1]) ** 2; return Math.sqrt(s / a.length); };
  assert.ok(hp(b) / rms(b) < hp(p) / rms(p) && hp(p) / rms(p) < hp(w) / rms(w), 'brown < pink < white in high-frequency content');
  const patter = fillPatter(new Float32Array(N * 2), N, 420, 4);
  assert.ok(patter.every(Number.isFinite) && rms(patter) > 0.005 && Math.abs(patter[0]) < 1e-3 && Math.abs(patter[patter.length - 1]) < 1e-3, 'loops without a click');
  const imp = fillImpulse(new Float32Array(N), N, 1.0, 5);
  assert.ok(rms(imp.subarray(0, 4800)) > rms(imp.subarray(38000)) * 5, 'impulse decays');
  assert.equal(imp[N - 1], 0);
});
