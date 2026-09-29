import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvState, computeEnv } from '../src/sky/environment.js';
import { WEATHER_PRESETS } from '../src/weather/weather.js';
import { fromIST, PRESET_DATES, moonPosition, sunEvents } from '../src/astro/astro.js';
import { landmarkSources } from '../src/festival/landmarkLights.js';
import { hawaOutline } from '../src/world/landmarks/hawaMahal.js';

const clear = { ...WEATHER_PRESETS.clear, wetness: 0, puddles: 0 };
const envAt = (y, mo, d, h, w = clear) => { const e = new EnvState(); computeEnv(e, fromIST(y, mo, d, Math.floor(h), Math.round((h % 1) * 60)), w); return e; };

test('Diwali 2026 (Sun 8 Nov, Kartik Amavasya) is moonless from dusk to dawn: no moon disc lighting, key light is dark', () => {
  const p = PRESET_DATES.diwali;
  assert.deepEqual([p.y, p.mo, p.d], [2026, 11, 8]);
  for (const h of [18.5, 19, 19.7, 20.5, 21.5, 22.5, 23.5]) {
    const e = envAt(p.y, p.mo, p.d, h);
    assert.ok(e.moonIllum < 0.03, `IST ${h}: moon illumination ${e.moonIllum} (new moon 9 Nov 07:02 UTC)`);
    assert.ok(e.moonColor.r + e.moonColor.g + e.moonColor.b < 0.02, `IST ${h}: moonlight ${e.moonColor.r}`);
    if (h >= 19) { assert.ok(e.sunAlt < -10 && e.night > 0.95, `IST ${h}: dark sky ${e.sunAlt}`); assert.ok(e.keyColor.r + e.keyColor.g + e.keyColor.b < 0.02, 'no key light: the city lights are the light'); }
  }
  // the thin crescent (about 1 %) that exists is below the horizon after sunset
  const m = moonPosition(fromIST(2026, 11, 8, 20, 0));
  assert.ok(m.illum < 0.03);
});

test('Makar Sankranti 2027 (14 Jan): a sunny day with sun well up at 11:00 and sunset before 18:30', () => {
  const p = PRESET_DATES.sankranti;
  assert.deepEqual([p.y, p.mo, p.d], [2027, 1, 14]);
  const e = envAt(p.y, p.mo, p.d, 11, { ...WEATHER_PRESETS.winter, wetness: 0, puddles: 0 });
  assert.ok(e.sunAlt > 30 && e.sunAlt < 50, 'sun at 11:00: ' + e.sunAlt);
  const ev = sunEvents(fromIST(p.y, p.mo, p.d, 12));
  const sunset = new Date(ev.sunset + 5.5 * 3600e3).getUTCHours() + new Date(ev.sunset + 5.5 * 3600e3).getUTCMinutes() / 60;
  assert.ok(sunset > 17 && sunset < 18.5, 'sunset (IST hours) ' + sunset);
  assert.ok(WEATHER_PRESETS.winter.windSpeed >= 6, 'kite weather has a fresh breeze');
});

test('landmarkSources: every planned landmark kind gets floodlights near its model, in warm colours', () => {
  const items = [
    { key: 'hawaMahal', kind: 'hawa', x: 36, z: -50, nx: 1, nz: 0, ux: 0, uz: -1, yaw: 1.57 },
    { key: 'chandraMahal', kind: 'chandra', x: -200, z: -300, yaw: 0.5, len: 47, dep: 23 },
    { key: 'mubarakMahal', kind: 'mubarak', x: -240, z: -280, yaw: 0.2, len: 27, dep: 27 },
    { key: 'gate:1', kind: 'gate', x: 500, z: 100, yaw: 0, len: 20, dep: 10 },
    { key: 'jantarMantar', kind: 'jm', x: -200, z: -140, site: { ring: [[-100, -180], [-100, -100], [-300, -100], [-300, -180]] } },
    { key: 'jalMahal', kind: 'jal', x: 900, z: -3000 },
    { key: 'x', kind: 'unknown', x: 0, z: 0 },
  ];
  const s = landmarkSources(items);
  assert.equal(s.length % 7, 0);
  for (const it of items.slice(0, 6)) {
    let n = 0;
    for (let o = 0; o < s.length; o += 7) {
      if (Math.hypot(s[o] - it.x, s[o + 1] - it.z) < (it.kind === 'jm' ? 160 : 90)) { n++; assert.ok(s[o + 2] >= s[o + 3] && s[o + 3] >= s[o + 4] && s[o + 4] > 0, 'warm (r >= g >= b > 0)'); assert.ok(s[o + 5] >= 20 && s[o + 5] <= 50); assert.equal(s[o + 6], 3); }
    }
    assert.ok(n >= 1, `${it.kind} has a floodlight near it`);
  }
  assert.equal(landmarkSources([]).length, 0);
  assert.equal(landmarkSources(null).length, 0);
  // Hawa Mahal: the street-side lights stand on the facade side (+n), not behind it
  const hawa = [];
  for (let o = 0; o < 5 * 7; o += 7) hawa.push([s[o], s[o + 1]]);
  assert.ok(hawa.every(([x]) => x > 36), 'in front of the east-facing facade');
});

test('Hawa Mahal festival outline: bulbs sit on the top edge of each of the five storeys, diyas on the plinth, inside the modelled widths', () => {
  const { bulbs, diyas } = hawaOutline();
  assert.ok(bulbs.length > 150 && bulbs.length < 260, 'bulbs ' + bulbs.length);
  const ys = [...new Set(bulbs.map((p) => p[1].toFixed(2)))].map(Number).sort((a, b) => a - b);
  assert.equal(ys.length, 5, 'one string per storey: ' + ys);
  for (let i = 1; i < 5; i++) assert.ok(ys[i] - ys[i - 1] > 4 && ys[i] - ys[i - 1] < 5, 'storey spacing 4.5 m');
  const widthAt = (y) => Math.max(...bulbs.filter((p) => Math.abs(p[1] - y) < 0.01).map((p) => Math.abs(p[0]))) * 2;
  assert.ok(widthAt(ys[0]) > 34 && widthAt(ys[0]) <= 36.1 && widthAt(ys[4]) > 7 && widthAt(ys[4]) <= 9.1, 'pyramidal: the strings narrow toward the top');
  assert.ok(diyas.length > 25 && diyas.every((p) => p[1] < 0.2 && Math.abs(p[0]) < 18), 'diyas at the base');
});
