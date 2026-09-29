// Derives the complete lighting/atmosphere state for a frame from (clock, weather).
// Pure data out: sun/moon directions & colours, atmosphere parameters, exposure, fog, ambient flags.
import * as THREE from 'three';
import { sunPosition, moonPosition, dirFromAltAz, localSiderealRad } from '../astro/astro.js';
import { sunTransmittance, exposureFor } from './atmosphere.js';

const RAD = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const SUN_IRRADIANCE = 6.2; // scene-linear direct sun strength at zenith (three DirectionalLight intensity)
export const MOON_IRRADIANCE = 0.62;

export class EnvState {
  constructor() {
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunAlt = 0; // deg (apparent)
    this.moonAlt = 0;
    this.moonIllum = 0;
    this.moonPhase = 0;
    this.moonQ = 0;
    this.moonWaxing = true;
    this.sunTrans = [1, 1, 1];
    this.cloudSunTrans = [1, 1, 1];
    this.sunColor = new THREE.Color(); // colour*intensity of direct sun (linear)
    this.moonColor = new THREE.Color();
    this.keyDir = new THREE.Vector3(0, 1, 0); // direction TO the main light
    this.keyColor = new THREE.Color();
    this.night = 0; // 0 day .. 1 dark
    this.twilight = 0; // 0..1 how deep into twilight (bell shaped)
    this.exposure = 1;
    this.mieScale = 30;
    this.dustTint = [1, 1, 1];
    this.lstRad = 0;
    this.starGain = 0;
    this.skyAux = { nightGlow: 0, overcast: 0, ground: 0.2 };
    this.fog = { density: 1e-4, falloff: 1 / 1200, glow: 0.5, noise: 0, mist: 0 };
    this.cloud = { cover: 0.2, density: 1, base: 1800, thick: 1400, shadow: 0.6, cirrus: 0.2, storm: 0 };
    this.ambientBoost = 1;
  }
}

/**
 * @param {EnvState} out
 * @param {number} ms sim time (UTC ms)
 * @param {object} w Weather.s blended state
 * @param {{lightning?:number, festival?:number}} extra
 */
export function computeEnv(out, ms, w, extra = {}) {
  const sun = sunPosition(ms);
  const moon = moonPosition(ms);
  out.sunAlt = sun.altApparent / RAD;
  out.moonAlt = moon.altApparent / RAD;
  out.moonIllum = moon.illum;
  out.moonPhase = moon.phase;
  out.moonQ = moon.q;
  out.moonWaxing = moon.waxing;
  const d = [0, 0, 0];
  dirFromAltAz(sun.altApparent, sun.az, d);
  out.sunDir.set(d[0], d[1], d[2]);
  dirFromAltAz(moon.altApparent, moon.az, d);
  out.moonDir.set(d[0], d[1], d[2]);
  out.lstRad = localSiderealRad(ms);

  const overcast = Math.min(1, w.overcast);
  out.mieScale = w.mieScale;
  out.dustTint = w.dustTint;

  // Direct sun: atmospheric transmittance (ground observer) x cloud/dust attenuation
  out.sunTrans = sunTransmittance(sun.altApparent, w.mieScale, w.dustTint, 450);
  out.cloudSunTrans = sunTransmittance(Math.max(sun.altApparent, -1.4 * RAD), Math.max(6, w.mieScale * 0.5), w.dustTint, 2800);
  const horizonFade = smooth(-2.2, 1.2, out.sunAlt); // sun disc slips below horizon
  const directAtten = (1 - 0.93 * overcast) * (1 - 0.55 * w.storm * w.dust);
  const sunMag = SUN_IRRADIANCE * horizonFade * directAtten;
  out.sunColor.setRGB(out.sunTrans[0] * sunMag, out.sunTrans[1] * sunMag, out.sunTrans[2] * sunMag);

  // Moon: cool white, scaled by phase and altitude, faded by clouds
  const moonUp = smooth(-1.0, 4.0, out.moonAlt);
  const moonMag = MOON_IRRADIANCE * Math.pow(moon.illum, 1.15) * moonUp * (1 - 0.85 * overcast) * smooth(3, -6, out.sunAlt);
  out.moonColor.setRGB(0.72 * moonMag, 0.84 * moonMag, 1.0 * moonMag);

  // Key light = whichever dominates; blend direction across the switch so it never pops.
  const sl = out.sunColor.r * 0.3 + out.sunColor.g * 0.59 + out.sunColor.b * 0.11;
  const ml = out.moonColor.r * 0.3 + out.moonColor.g * 0.59 + out.moonColor.b * 0.11;
  const wS = sl / (sl + ml * 2.5 + 1e-6);
  out.keyDir.copy(out.sunDir).multiplyScalar(wS).addScaledVector(out.moonDir, 1 - wS);
  if (out.keyDir.lengthSq() < 1e-6) out.keyDir.copy(out.sunDir);
  out.keyDir.normalize();
  // never light from below the horizon
  if (out.keyDir.y < 0.02) { out.keyDir.y = 0.02; out.keyDir.normalize(); }
  out.keyColor.setRGB(out.sunColor.r * wS + out.moonColor.r * (1 - wS), out.sunColor.g * wS + out.moonColor.g * (1 - wS), out.sunColor.b * wS + out.moonColor.b * (1 - wS));
  if (sl + ml < 1e-4) out.keyColor.setRGB(0, 0, 0);

  out.night = smooth(1.5, -10, out.sunAlt);
  out.twilight = Math.exp(-Math.pow((out.sunAlt + 5) / 6.5, 2));
  out.exposure = exposureFor(out.sunAlt, out.moonAlt, moon.illum, overcast) * (1 - 0.18 * w.dust);

  // stars are visible only in real darkness, less under moonlight, haze and cloud
  const moonWash = 1 - 0.85 * moon.illum * moonUp;
  out.starGain = smooth(-7, -17, out.sunAlt) * moonWash * (1 - overcast) * (1 - 0.7 * Math.min(1, w.dust)) * 0.75;

  out.skyAux.nightGlow = out.night * (0.6 + 0.9 * moon.illum * moonUp) * (1 - 0.5 * overcast);
  out.skyAux.overcast = overcast;
  out.skyAux.ground = 0.18;

  // Fog/haze: extinction consistent with the LUT's aerosol, with an extra local gain for boundary-layer haze.
  const betaM = 4.44e-6 * w.mieScale * Math.exp(-443 / 1200);
  const betaR = 1.2e-5 * Math.exp(-443 / 8000);
  out.fog.density = (betaM + betaR) * w.fogGain;
  out.fog.falloff = w.fogFalloff;
  out.fog.glow = 0.35 + 0.65 * Math.min(1, w.dust + 0.3);
  out.fog.noise = Math.min(1, 0.15 + w.dust * 0.85);
  out.fog.mist = w.mist;

  out.cloud.cover = w.cloudCover;
  out.cloud.density = w.cloudDensity;
  out.cloud.base = w.cloudBase;
  out.cloud.thick = w.cloudThick;
  out.cloud.shadow = 0.78 * (1 - 0.6 * overcast);
  out.cloud.cirrus = w.cirrus;
  out.cloud.storm = w.storm;
  return out;
}
