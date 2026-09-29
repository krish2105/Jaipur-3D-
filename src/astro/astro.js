// Sun and moon positions for Jaipur (real latitude/longitude, real date, real moon phase).
//  * Sun: low-precision Meeus/NOAA series (< 0.01 deg).
//  * Moon: Meeus ch. 47 truncated series (main periodic terms, ~0.1-0.3 deg), topocentric parallax.
//  * Everything is pure and node-testable (see tests/astro.test.mjs).
// Angles in radians unless a name ends in Deg. Azimuth is measured from north, clockwise (east = +90).

export const JAIPUR = { lat: 26.9235, lon: 75.8265 }; // deg (matches src/core/geo.js origin)
export const IST_OFFSET_H = 5.5;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;
const norm360 = (d) => ((d % 360) + 360) % 360;

export const julianDate = (ms) => ms / 86400000 + 2440587.5;

export function gmstDeg(jd) {
  const d = jd - 2451545.0;
  const T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
}

function eclipticToEquatorial(lam, beta, eps) {
  const sl = Math.sin(lam), cl = Math.cos(lam);
  const ra = Math.atan2(sl * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), cl);
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * sl);
  return { ra: (ra + TAU) % TAU, dec };
}

function equatorialToHorizontal(ra, dec, jd, latDeg = JAIPUR.lat, lonDeg = JAIPUR.lon) {
  const lst = (gmstDeg(jd) + lonDeg) * RAD;
  const H = lst - ra;
  const lat = latDeg * RAD;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H));
  // parallactic angle (orientation of the equatorial "up" relative to zenith)
  const q = Math.atan2(Math.sin(H), Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(H));
  return { alt, az: (az + TAU) % TAU, H, q };
}

/** Bennett-style refraction (radians added to true altitude), valid near/below horizon too. */
export function refraction(altRad) {
  const h = altRad * DEG;
  if (h < -1.5) return 0;
  const R = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD); // arcminutes
  return Math.max(0, (R / 60) * RAD);
}

export function sunEquatorial(jd) {
  const n = jd - 2451545.0;
  const L = norm360(280.460 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dist = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g); // AU
  return { ...eclipticToEquatorial(lam, 0, eps), lam, dist, eps };
}

export function sunPosition(ms, lat = JAIPUR.lat, lon = JAIPUR.lon) {
  const jd = julianDate(ms);
  const s = sunEquatorial(jd);
  const h = equatorialToHorizontal(s.ra, s.dec, jd, lat, lon);
  return { alt: h.alt, altApparent: h.alt + refraction(h.alt), az: h.az, ra: s.ra, dec: s.dec, lam: s.lam, dist: s.dist, jd };
}

// --- Moon (Meeus 47, truncated) ---------------------------------------------------------------
// [D, M, M', F, sinL (1e-6 deg), cosR (1e-3 km)]
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149], [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210], [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056], [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
];
// [D, M, M', F, sinB (1e-6 deg)]
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359],
];

export function moonEquatorial(jd) {
  const T = (jd - 2451545.0) / 36525;
  const Lp = norm360(218.3164477 + 481267.88123421 * T) * RAD;
  const D = norm360(297.8501921 + 445267.1114034 * T) * RAD;
  const M = norm360(357.5291092 + 35999.0502909 * T) * RAD;
  const Mp = norm360(134.9633964 + 477198.8675055 * T) * RAD;
  const F = norm360(93.2720950 + 483202.0175233 * T) * RAD;
  const A1 = norm360(119.75 + 131.849 * T) * RAD;
  const A2 = norm360(53.09 + 479264.290 * T) * RAD;
  const A3 = norm360(313.45 + 481266.484 * T) * RAD;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    const arg = d * D + m * M + mp * Mp + f * F;
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += cb * e * Math.sin(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(Lp) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lp - Mp) - 115 * Math.sin(Lp + Mp);
  const lam = (Lp * DEG + sl / 1e6) * RAD;
  const beta = (sb / 1e6) * RAD;
  const dist = 385000.56 + sr / 1000; // km
  // nutation ignored (< 0.005 deg); mean obliquity
  const eps = (23.439291 - 0.0130042 * T) * RAD;
  return { ...eclipticToEquatorial(lam, beta, eps), lam, beta, dist };
}

/**
 * Moon position + phase for the observer.
 *  phase: 0 new .. 0.5 full .. 1 (fraction of the synodic cycle); illum: lit fraction 0..1.
 */
export function moonPosition(ms, lat = JAIPUR.lat, lon = JAIPUR.lon) {
  const jd = julianDate(ms);
  const m = moonEquatorial(jd);
  const s = sunEquatorial(jd);
  const h = equatorialToHorizontal(m.ra, m.dec, jd, lat, lon);
  // topocentric parallax (altitude only, adequate for visuals)
  const par = Math.asin(6378.14 / m.dist);
  const altTopo = h.alt - par * Math.cos(h.alt);
  // phase
  const cosPsi = Math.sin(m.dec) * Math.sin(s.dec) + Math.cos(m.dec) * Math.cos(s.dec) * Math.cos(m.ra - s.ra);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const AU = 149597870.7;
  const inc = Math.atan2(s.dist * AU * Math.sin(psi), m.dist - s.dist * AU * Math.cos(psi));
  const illum = (1 + Math.cos(inc)) / 2;
  const elong = norm360((m.lam - s.lam) * DEG); // 0 new, 180 full
  return { alt: altTopo, altApparent: altTopo + refraction(altTopo), az: h.az, q: h.q, ra: m.ra, dec: m.dec, dist: m.dist, illum, phase: elong / 360, elongDeg: elong, waxing: elong < 180 };
}

/** Unit direction in the app's world frame: +x east, +y up, -z north. */
export function dirFromAltAz(alt, az, out = [0, 0, 0]) {
  const c = Math.cos(alt);
  out[0] = c * Math.sin(az);
  out[1] = Math.sin(alt);
  out[2] = -c * Math.cos(az);
  return out;
}

/** Local sidereal time (radians) for star-field rotation. */
export function localSiderealRad(ms, lon = JAIPUR.lon) {
  return ((gmstDeg(julianDate(ms)) + lon) % 360) * RAD;
}

// --- events ------------------------------------------------------------------------------------

/** Find sun altitude crossing within [t0,t1] (ms) by bisection; dir=+1 rising, -1 setting. */
function crossing(fn, t0, t1, target) {
  let a = t0, b = t1;
  const fa = fn(a) - target;
  const fb = fn(b) - target;
  if (fa * fb > 0) return null;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    const fm = fn(m) - target;
    if (fa * fm <= 0) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** Local (IST) midnight at or before ms. */
export function istMidnight(ms) {
  const off = IST_OFFSET_H * 3600000;
  return Math.floor((ms + off) / 86400000) * 86400000 - off;
}

/** Sunrise, sunset, solar noon and twilight times (ms) for the IST day containing ms. */
export function sunEvents(ms, lat = JAIPUR.lat, lon = JAIPUR.lon) {
  const day0 = istMidnight(ms);
  const alt = (t) => sunPosition(t, lat, lon).alt;
  const noonSearch = () => {
    let best = day0 + 12 * 3600000, bv = -9;
    for (let t = day0 + 9 * 3600000; t <= day0 + 15 * 3600000; t += 60000) { const v = alt(t); if (v > bv) { bv = v; best = t; } }
    return best;
  };
  const noon = noonSearch();
  const H = 0.833 * RAD; // standard sunrise: centre 50' below the horizon
  const ev = {
    solarNoon: noon,
    sunrise: crossing(alt, day0 + 3 * 3600000, noon, -H),
    sunset: crossing(alt, noon, day0 + 23 * 3600000, -H),
    civilDawn: crossing(alt, day0, noon, -6 * RAD),
    civilDusk: crossing(alt, noon, day0 + 24 * 3600000, -6 * RAD),
    astroDawn: crossing(alt, day0, noon, -18 * RAD),
    astroDusk: crossing(alt, noon, day0 + 24 * 3600000, -18 * RAD),
    noonAlt: alt(noon),
  };
  // Asr (standard/Shafi'i: shadow = object + noon shadow)
  const dec = sunPosition(noon, lat, lon).dec;
  const asrAlt = Math.atan(1 / (1 + Math.tan(Math.abs(lat * RAD - dec))));
  ev.asr = crossing(alt, noon, ev.sunset, asrAlt);
  return ev;
}

/** Prayer-time approximations (sun geometry only): used to schedule the azaan. */
export function prayerTimes(ms) {
  const e = sunEvents(ms);
  return { fajr: e.astroDawn, dhuhr: e.solarNoon + 5 * 60000, asr: e.asr, maghrib: e.sunset + 2 * 60000, isha: e.astroDusk };
}

export const toIST = (ms) => {
  const d = new Date(ms + IST_OFFSET_H * 3600000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
};
export const fromIST = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_H * 3600000;
export const fmtIST = (ms) => {
  const t = toIST(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.y}-${p(t.mo)}-${p(t.d)} ${p(t.h)}:${p(t.mi)}`;
};

/** Reference dates (IST) for the festival / seasonal presets. Sources are cited in docs/LANDMARK_FACTS.md. */
export const PRESET_DATES = {
  diwali: { y: 2026, mo: 11, d: 8 },   // Kartik Amavasya, Sun 8 Nov 2026 (new moon 9 Nov 07:02 UTC): moonless
  teej: { y: 2026, mo: 8, d: 15 },     // Hariyali Teej, Sat 15 Aug 2026 (3-day-old crescent, monsoon)
  sankranti: { y: 2027, mo: 1, d: 14 }, // Makar Sankranti (14/15 Jan 2027)
  summer: { y: 2026, mo: 5, d: 20 },   // loo season
};
