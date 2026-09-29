import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/astro/astro.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +- ${tol}, got ${a}`);

test('Meeus example: Moon 1992-04-12 00:00 TD -> lam ~133.167, beta ~-3.229, dist ~368409.7', () => {
  // Meeus ex. 47.a: JDE 2448724.5
  const m = A.moonEquatorial(2448724.5);
  near(m.lam * 180 / Math.PI, 133.162655, 0.02, 'lambda');
  near(m.beta * 180 / Math.PI, -3.229126, 0.02, 'beta');
  near(m.dist, 368409.7, 20, 'distance');
});

test('sunrise/sunset at Jaipur are plausible on known dates', () => {
  const ev = A.sunEvents(A.fromIST(2026, 11, 8, 12));
  const sr = A.toIST(ev.sunrise), ss = A.toIST(ev.sunset);
  // published Jaipur values: sunrise ~06:4x, sunset ~17:3x IST in early Nov
  assert.ok(sr.h === 6 && sr.mi >= 35 && sr.mi <= 55, `sunrise ${sr.h}:${sr.mi}`);
  assert.ok(ss.h === 17 && ss.mi >= 25 && ss.mi <= 45, `sunset ${ss.h}:${ss.mi}`);
  const j = A.sunEvents(A.fromIST(2027, 1, 14, 12));
  const jr = A.toIST(j.sunrise);
  assert.ok(jr.h === 7 && jr.mi >= 10 && jr.mi <= 30, `Jan sunrise ${jr.h}:${jr.mi}`);
});

test('Diwali 2026 evening is (nearly) moonless: thin crescent, illumination < 3%', () => {
  const ms = A.fromIST(2026, 11, 8, 19, 0);
  const m = A.moonPosition(ms);
  assert.ok(m.illum < 0.03, `illum ${m.illum}`);
  assert.ok(m.alt < 0.05, `moon should be at/below horizon after sunset, alt=${m.alt}`);
});

test('New moon 2026-11-09 07:02 UTC: elongation ~0', () => {
  const m = A.moonPosition(Date.UTC(2026, 10, 9, 7, 2));
  const e = m.elongDeg > 180 ? m.elongDeg - 360 : m.elongDeg;
  assert.ok(Math.abs(e) < 0.6, `elong ${e}`);
  assert.ok(m.illum < 0.005, `illum ${m.illum}`);
});

test('Full moon 2026-11-24 14:53 UTC: illumination ~100%', () => {
  const m = A.moonPosition(Date.UTC(2026, 10, 24, 14, 53));
  assert.ok(m.illum > 0.995, `illum ${m.illum}`);
});

test('Teej 2026-08-15 evening: young waxing crescent (new moon 2026-08-12)', () => {
  const m = A.moonPosition(A.fromIST(2026, 8, 15, 19, 0));
  assert.ok(m.waxing);
  assert.ok(m.illum > 0.05 && m.illum < 0.25, `illum ${m.illum}`);
});

test('Sun at noon in Jaipur on solstice/equinox altitudes', () => {
  const eq = A.sunEvents(A.fromIST(2026, 3, 20, 12));
  near(eq.noonAlt * 180 / Math.PI, 90 - 26.92, 1.2, 'equinox noon altitude');
  const js = A.sunEvents(A.fromIST(2026, 6, 21, 12));
  near(js.noonAlt * 180 / Math.PI, 90 - 26.92 + 23.44, 1.0, 'June solstice noon altitude');
});

test('world direction frame: sun at az 90 (east) points +x', () => {
  const d = A.dirFromAltAz(0, Math.PI / 2);
  near(d[0], 1, 1e-9); near(d[2], 0, 1e-9);
  const n = A.dirFromAltAz(0, 0);
  near(n[2], -1, 1e-9); // north = -z
});
