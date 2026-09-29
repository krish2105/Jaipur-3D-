// JS mirror of the GLSL atmosphere: used for light colours (sun transmittance) and exposure.
// Keep constants in sync with src/render/glsl.js.
import { ATMO_CONSTS as C } from '../render/glsl.js';

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Transmittance (rgb) of direct sunlight reaching the observer through the atmosphere.
 * @param {number} sunAlt radians (geometric altitude)
 * @param {number} mieScale aerosol/dust density multiplier
 * @param {number[]} dustTint per-channel dust extinction tint
 */
export function sunTransmittance(sunAlt, mieScale = 6, dustTint = [1, 1, 1], obsAlt = 450) {
  const r0 = C.Rg + obsAlt;
  // observer at (0, r0); ray direction (cos a, sin a)
  const ca = Math.cos(sunAlt), sa = Math.sin(sunAlt);
  // ray hits the planet? (only matters when sun well below horizon)
  const b = r0 * sa;
  const disc = b * b - (r0 * r0 - C.Rg * C.Rg);
  if (sunAlt < 0 && disc >= 0 && -b - Math.sqrt(disc) > 0) return [0, 0, 0];
  const bb = r0 * sa;
  const cc = r0 * r0 - C.Rt * C.Rt;
  const tEnd = -bb + Math.sqrt(bb * bb - cc);
  const N = 48;
  const dt = tEnd / N;
  const od = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = dt * (i + 0.5);
    const x = t * ca, y = r0 + t * sa;
    const h = Math.hypot(x, y) - C.Rg;
    const dR = Math.exp(-h / C.HR), dM = Math.exp(-h / C.HM) * mieScale;
    const dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
    for (let k = 0; k < 3; k++) od[k] += (C.betaR[k] * dR + C.betaMExt * dM * dustTint[k] + C.betaO[k] * dO) * dt;
  }
  return od.map((v) => Math.exp(-v));
}

/** Rec.709 luma. */
export const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Exposure curve in stops of "scene brightness" keyed on the sun altitude (deg), moon brightness and
 * overcast: bright day ~1, twilight brighter, moonless night large (so lamps and stars read).
 */
export function exposureFor(sunAltDeg, moonAltDeg, moonIllum, overcast = 0) {
  const stops = [
    [-24, 10.0], [-18, 8.5], [-12, 4.2], [-8, 2.2], [-4, 1.55], [0, 1.25], [6, 1.05], [20, 0.95], [90, 0.9],
  ];
  let e = stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (sunAltDeg <= stops[i + 1][0]) {
      const [a0, e0] = stops[i], [a1, e1] = stops[i + 1];
      const t = Math.max(0, Math.min(1, (sunAltDeg - a0) / (a1 - a0)));
      e = Math.exp(lerp(Math.log(e0), Math.log(e1), t));
      break;
    }
  }
  if (sunAltDeg < -6) {
    // moonlight lets the exposure come down a bit
    const m = Math.max(0, Math.sin((moonAltDeg * Math.PI) / 180)) * moonIllum;
    e *= 1 - 0.45 * m;
  }
  return e * (1 + 0.25 * overcast);
}


// --- twilight sky model ------------------------------------------------------------------------
// Single-scattering physically dies ~9 deg below the horizon, while real twilight lasts to ~-18 deg
// (multiple scattering, upper-atmosphere glow). The sky-view LUT is therefore evaluated at a gradually
// narrowing *effective* sun elevation and lifted by a gain that hits a designed display-brightness curve.
// PHYS_ZEN: measured zenith luminance of the LUT (mie 20, gain 1) via scripts/_calib.mjs.
const PHYS_ZEN = [[5, 0.227], [2, 0.173], [0.7, 0.129], [0, 0.0973], [-1, 0.0584], [-2, 0.0335], [-3, 0.016], [-4, 0.00637], [-5, 0.0021], [-6, 5.32e-4], [-7, 1.05e-4], [-8, 1.53e-5], [-9, 1.63e-6]];
// D: designed display luminance of the zenith after exposure (blue hour ~0.07 .. deep night ~0.004)
const TWI_DISPLAY = [[-1.5, 0.12], [-3, 0.092], [-6, 0.072], [-9, 0.05], [-12, 0.033], [-15, 0.02], [-18, 0.011], [-22, 0.004], [-40, 0.002]];

function logInterp(table, x) {
  // table sorted by descending x
  if (x >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x >= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      const t = (x - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t);
    }
  }
  return table[table.length - 1][1];
}

/** @returns {{effAlt:number, gain:number}} effective LUT sun elevation (deg) and radiance gain */
export function twilightParams(altDeg) {
  if (altDeg >= -1.5) return { effAlt: altDeg, gain: 1 };
  const effAlt = Math.max(-8.9, -1.5 + (altDeg + 1.5) * 0.4);
  const D = logInterp(TWI_DISPLAY, altDeg);
  const e = exposureFor(altDeg, -90, 0, 0);
  const target = D / e;
  const phys = logInterp(PHYS_ZEN, effAlt);
  return { effAlt, gain: target / phys };
}
