// Audio mixing model and procedural buffers (pure: no Web Audio objects, node-testable).
//  * computeMix(state)    one place that says how loud each layer of the soundscape is, from the ONE simulation state
//                         (clock hour, sun, weather, street life, festival, camera height)
//  * soundDelay / thunder scheduling helpers (speed of sound, distances are the simulated ones)
//  * nearest-voice picking and the rate models for horns / birds / crackers
//  * buffer generators (white / pink / brown noise, rain patter, impulse response) that fill Float32Arrays
// APPROX: every gain, rate and spectrum here is art direction (no recordings are used, nothing is sampled from the real Jaipur).
import { mulberry32 } from '../core/rng.js';

export const SPEED_OF_SOUND = 343;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const soundDelay = (distM) => Math.max(0, distM) / SPEED_OF_SOUND;

/** how much of the day the bazaars are busy 0..1 (people, shops): same shape as the shop shutters */
export function bazaarBusy(h) {
  const up = smooth(8.8, 11.0, h), down = 1 - smooth(20.5, 22.8, h);
  return Math.min(up, down);
}

/**
 * @param {object} s {
 *   hour (IST), sunAlt (deg), rain 0..1, wetness 0..1, windSpeed (m/s), dust 0..1, storm 0..1, overcast 0..1,
 *   veh, ped (drawn agents near the camera), nearPeds (within ~45 m), nearVeh (within ~60 m), birds, kites,
 *   altitude (camera m above ground), festival ('off'|'diwali'|'sankranti'), festivalStrength 0..1
 * }
 * @returns {object} layer gains 0..1 (before the master) plus a few shaping parameters
 */
export function computeMix(s) {
  const night = smooth(2, -8, s.sunAlt);           // 0 day .. 1 night
  const day = 1 - night;
  const alt = Math.max(0, s.altitude || 0);
  const ground = 1 / (1 + alt / 90);                // street sounds thin out with height
  const air = clamp01(alt / 260);                   // more wind, less city, up in the air
  const busy = bazaarBusy(s.hour);
  const rain = clamp01(s.rain);
  const storm = clamp01(s.storm) * clamp01(s.dust);
  // rain hides a lot: birds and crowds are muffled, traffic hiss rises on wet roads
  const mask = 1 - 0.55 * rain - 0.35 * storm;

  const crowd = clamp01(Math.sqrt(Math.min(1, (s.nearPeds || 0) / 60)) * (0.25 + 0.75 * busy) * (0.7 + 0.3 * day)) * ground * mask;
  const trafficBed = clamp01(Math.sqrt(Math.min(1, (s.veh || 0) / 120)) * (0.35 + 0.65 * (1 - 0.6 * night))) * (0.4 + 0.6 * ground) * (1 - 0.4 * air);
  const city = clamp01(0.32 * day + 0.16 * night) * (0.5 + 0.5 * busy) * ground * (0.7 + 0.3 * mask);

  const birdHour = smooth(4.8, 6.2, s.hour) * (1 - smooth(9.5, 11.5, s.hour)) + 0.35 * smooth(15.5, 17.2, s.hour) * (1 - smooth(18.3, 19.2, s.hour)) + 0.12 * day;
  const birds = clamp01(birdHour) * day * mask * (1 - air) * (1 - 0.6 * clamp01(s.windSpeed / 14));
  const insects = night * (1 - rain) * (1 - 0.7 * clamp01(s.windSpeed / 10)) * ground * 0.9;

  const wind = clamp01(s.windSpeed / 16) * (0.35 + 0.65 * air) + clamp01(storm) * 0.35;
  const rainG = Math.pow(rain, 1.15);
  const swish = clamp01(s.wetness) * trafficBed * 0.9;  // tyres on wet roads

  let festival = 0, crackers = 0, drums = 0, kiteHum = 0;
  if (s.festival === 'diwali') {
    festival = clamp01(s.festivalStrength) * smooth(4, -6, s.sunAlt);
    crackers = festival * (0.4 + 0.6 * smooth(19.2, 21.0, s.hour)) * ground * mask;
    drums = festival * 0.4 * ground * mask;
  } else if (s.festival === 'sankranti') {
    festival = 1 * day;
    drums = 0.5 * day * ground * mask;
    kiteHum = clamp01((s.kites || 0) / 40) * clamp01(s.windSpeed / 8) * day * (0.5 + 0.5 * ground);
  }
  const bells = Math.max(smooth(5.0, 5.6, s.hour) * (1 - smooth(6.6, 7.2, s.hour)), smooth(17.4, 17.9, s.hour) * (1 - smooth(19.0, 19.6, s.hour))) * ground * mask * 0.8;
  return { night, day, ground, air, busy, crowd, trafficBed, city, birds, insects, wind, rain: rainG, swish, festival, crackers, drums, kiteHum, bells, mask };
}

/** poisson-ish event rates per second */
export function hornRate(nearVeh, busy, night) { return Math.min(2.4, (nearVeh || 0) * 0.018 * (0.4 + 0.6 * busy) * (1 - 0.65 * night)); }
export function birdRate(birds) { return 0.05 + 1.6 * birds; }
export function crackerRate(crackers) { return 0.25 + 4.5 * crackers; }

/** indices of the (up to) n nearest sources from a flat array (stride floats each; x at ox, z at oz), within maxDist. Returns [{i, d}] sorted by distance. */
export function nearestSources(arr, count, stride, ox, oz, cx, cz, n, maxDist, out = []) {
  out.length = 0;
  const md2 = maxDist * maxDist;
  for (let i = 0; i < count; i++) {
    const dx = arr[i * stride + ox] - cx, dz = arr[i * stride + oz] - cz, d2 = dx * dx + dz * dz;
    if (d2 > md2) continue;
    if (out.length < n) { out.push({ i, d: d2 }); if (out.length === n) out.sort((a, b) => a.d - b.d); }
    else if (d2 < out[n - 1].d) { let k = n - 1; while (k > 0 && out[k - 1].d > d2) { out[k] = out[k - 1]; k--; } out[k] = { i, d: d2 }; }
  }
  if (out.length < n) out.sort((a, b) => a.d - b.d);
  for (const o of out) o.d = Math.sqrt(o.d);
  return out;
}

/** thunder for a bolt at (dist, bearing) seen by a camera: delay, loudness and crack strength (closer = sharper) */
export function thunderFor(bolt) {
  const d = bolt.dist;
  return { delay: soundDelay(d), gain: clamp01(1.25 / Math.sqrt(1 + d / 600)), crack: clamp01(1 - d / 3500), rumble: 2.2 + Math.min(5, d / 1200), bearing: bolt.bearing };
}

/** engine voice parameters for a vehicle type (0 bike, 1 car, 2 auto-rickshaw, 3 bus) at speed v (m/s) */
export function engineParams(type, v) {
  const s = Math.min(1, v / 14);
  switch (type) {
    case 0: return { f: 78 + 130 * s, gain: 0.5, cut: 900 + 900 * s, buzz: 0.55 };
    case 2: return { f: 52 + 70 * s, gain: 0.85, cut: 700 + 500 * s, buzz: 0.9 };   // a rattling 3-wheeler
    case 3: return { f: 30 + 45 * s, gain: 1.0, cut: 380 + 250 * s, buzz: 0.25 };
    default: return { f: 42 + 68 * s, gain: 0.7, cut: 520 + 520 * s, buzz: 0.35 };
  }
}

/** two-tone horn per vehicle type: [f1, f2, seconds, gain] */
export function hornFor(type, r) {
  if (type === 0) return [880 + 220 * r, 0, 0.16 + 0.18 * r, 0.35];
  if (type === 3) return [235, 300, 0.7 + 0.9 * r, 0.9];
  if (type === 2) return [520 + 60 * r, 0, 0.14 + 0.12 * r, 0.6];
  return [410 + 40 * r, 500 + 50 * r, 0.22 + 0.5 * r, 0.65];
}

// ---- buffers ---------------------------------------------------------------------------------------

export function fillWhite(out, seed = 1) {
  const r = mulberry32(seed);
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
}
/** Paul Kellet's economy pink filter, normalised to about +-1 */
export function fillPink(out, seed = 2) {
  const r = mulberry32(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return out;
}
export function fillBrown(out, seed = 3) {
  const r = mulberry32(seed);
  let last = 0;
  for (let i = 0; i < out.length; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; out[i] = last * 3.5; }
  return out;
}
/** loopable rain patter: sparse short bright clicks with random amplitudes (density in clicks per second) */
export function fillPatter(out, sampleRate, density = 420, seed = 4) {
  const r = mulberry32(seed);
  out.fill(0);
  const n = Math.floor((out.length / sampleRate) * density);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * out.length), len = Math.floor(sampleRate * (0.0015 + 0.004 * r())), a = 0.25 + 0.75 * r() * r();
    for (let i = 0; i < len && at + i < out.length; i++) out[at + i] += a * (r() * 2 - 1) * Math.exp(-i / (len * 0.28));
  }
  // make it loop: fade the edges into each other
  const f = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < f; i++) { const w = i / f; out[i] *= w; out[out.length - 1 - i] *= w; }
  return out;
}
/** exponentially decaying noise impulse response (a narrow, hard-walled street) */
export function fillImpulse(out, sampleRate, seconds = 1.1, seed = 5) {
  const r = mulberry32(seed);
  const n = Math.min(out.length, Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = 0;
  const tail = Math.max(1, Math.floor(n * 0.06)); // short fade so the response ends at exactly zero (no click when the convolver's tail stops)
  for (let i = 0; i < n; i++) { const t = i / sampleRate; out[i] = (r() * 2 - 1) * Math.exp(-t * 4.6 / seconds) * (i < 800 ? i / 800 : 1) * (i > n - tail ? (n - 1 - i) / tail : 1); }
  return out;
}
export const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };
