// Shared environment uniforms + global shader-chunk patches.
//
//  * Every material automatically receives the ENV uniforms (Material.prototype.onBeforeCompile hook);
//    materials with their own onBeforeCompile must call addEnvUniforms(shader).
//  * Fog is replaced by aerial perspective: height-exponential extinction integrated analytically along the
//    view ray, modulated by layered noise (dust plumes), in-scattering coloured by the sky LUT + forward
//    Mie glow toward the sun. It is never a flat colour tint.
//  * Cloud shadows multiply the direct sun light inside the light loop (works with CSM's chunk too).
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_CLOUD_FN } from './glsl.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);

/** Uniform objects shared by reference across every program. */
export const ENV = {
  uTime: { value: 0 },
  uSunDir: { value: V3(0, 1, 0) },
  uSunRad: { value: V3(1, 1, 1) }, // direct sun colour*intensity (used for haze glow)
  uMoonDir: { value: V3(0, -1, 0) },
  uMoonRad: { value: V3(0, 0, 0) },
  uSkyLUT: { value: null },
  uSkyAux: { value: V4(0, 0, 0, 0) }, // x: night sky glow gain, y: overcast darkening, z: ground bounce luma, w: unused
  uFog: { value: V4(2.2e-4, 1 / 1500, 0, 0) }, // x extinction @baseY (1/m), y height falloff (1/m), z baseY (m), w dust factor
  uFog2: { value: V4(0, 0, 0, 1) }, // x noise scale, y noise strength, z mist, w quality (0 = no noise)
  uWindV: { value: new THREE.Vector2(6, 2) }, // wind velocity (m/s)
  uNoise: { value: null },
  uCloud: { value: V4(0.35, 1.0, 1500, 1800) },
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
  uCloudFx: { value: V4(0.6, 0, 0, 0) },
  uWet: { value: V4(0, 0, 0, 0) }, // x wetness, y rain intensity, z puddles, w lightning flash
  uFxT: { value: 0 }, // real-time seconds (not the simulation clock): ripples, rain, anything that must not speed up with the sim
  uNight: { value: 0 }, // 0 day .. 1 full night (window glow, lamps)
  uFestival: { value: 0 }, // 0..1 festival lighting strength
  uLightGrid: { value: null },
  uLightGridP: { value: V4(0, 0, 400, 0) }, // x,y centre (world x,z), z size (m), w enabled
};

export function addEnvUniforms(shader) {
  for (const k in ENV) shader.uniforms[k] = ENV[k];
}

// ------------------------------------------------------------------------------------------------
const ENV_DECL = /* glsl */ `
#ifndef ENV_DECL_DONE
#define ENV_DECL_DONE
${GLSL_COMMON}
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunRad;
uniform vec3 uMoonDir;
uniform vec3 uMoonRad;
uniform sampler2D uSkyLUT;
uniform vec4 uSkyAux;
uniform vec4 uFog;
uniform vec4 uFog2;
uniform vec2 uWindV;
uniform vec4 uWet;
uniform float uNight;
uniform float uFxT;
uniform float uFestival;
uniform sampler2D uLightGrid;
uniform vec4 uLightGridP;
${GLSL_CLOUD_FN}
float envMiePhase(float c, float g){
  float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-3), 1.5);
}
// sky colour in world direction (from the sky-view LUT, sun-relative parameterisation)
vec3 envSkyAt(vec3 dir){
  float e = asin(clamp(dir.y, -1.0, 1.0));
  vec2 dh = dir.xz, sh = uSunDir.xz;
  float ld = length(dh), ls = length(sh);
  float phi = (ld < 1e-4 || ls < 1e-4) ? 0.0 : acos(clamp(dot(dh, sh) / (ld * ls), -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(e) * sqrt(abs(e) / (PI * 0.5));
  vec3 c = texture2D(uSkyLUT, vec2(clamp(phi / PI, 0.002, 0.998), clamp(v, 0.003, 0.997))).rgb;
  // faint night-sky glow (airglow / starlight / moon-scattered)
  c += vec3(0.0035, 0.0055, 0.011) * uSkyAux.x;
  // city light dome / horizon airglow: the horizon never goes pure black at night
  c += vec3(0.014, 0.013, 0.016) * uSkyAux.x * pow(1.0 - abs(dir.y), 6.0);
  return c;
}
#endif
`;

// ------------------------------------------------------------------------------------------------
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 fVec = vEnvWP - cameraPosition;
    float fDist = length(fVec);
    vec3 fDir = fVec / max(fDist, 1e-3);
    float fk = uFog.y;
    float fy0 = cameraPosition.y - uFog.z;
    float fy1 = vEnvWP.y - uFog.z;
    float fdy = fy1 - fy0;
    float fopt = (abs(fk * fdy) < 1e-3)
      ? uFog.x * exp(-fk * fy0) * fDist
      : uFog.x * (exp(-fk * fy0) - exp(-fk * fy1)) / (fk * fdy) * fDist;
    if (uFog2.w > 0.5 && uFog2.y > 0.001) {
      // layered dust plumes: sample noise at three points along the ray, strongly stratified in y
      float acc = 0.0;
      for (int i = 0; i < 3; i++) {
        vec3 fp = cameraPosition + fDir * fDist * (0.2 + 0.3 * float(i));
        float lay = 0.5 + 0.5 * sin(fp.y * 0.011 + 6.0 * vnoise(fp.xz * 0.0006 + uWindV * uTime * 0.0006));
        float pl = vnoise(fp.xz * uFog2.x + uWindV * (uTime * 0.0004) + fp.y * 0.0009);
        acc += mix(1.0, (0.35 + 1.3 * pl) * (0.55 + 0.9 * lay), uFog2.y);
      }
      fopt *= acc * 0.3333;
    }
    // Aravalli mist: extra extinction concentrated on the hills
    // (a band that hugs the ridge flanks, ~40-190 m above the city datum, plus a faint ground layer; the plain and the city stay readable)
    float mistBand = exp(-pow((fy1 - 110.0) / 75.0, 2.0)) + 0.12 * exp(-max(fy1, 0.0) / 50.0);
    fopt += uFog2.z * 2.6e-4 * fDist * mistBand;
    float fTr = exp(-fopt);
    vec3 fSky = envSkyAt(normalize(vec3(fDir.x, max(fDir.y, 0.0) * 0.5 + 0.005, fDir.z)));
    float fmu = dot(fDir, uSunDir);
    vec3 fGlow = uSunRad * (envMiePhase(fmu, 0.72) * 0.55 * (0.35 + uFog.w * 1.6));
    vec3 fLight = fSky + fGlow;
    gl_FragColor.rgb = gl_FragColor.rgb * fTr + fLight * (1.0 - fTr);
  }
#endif
`;

const CLOUD_SHADOW_INJECT = /* glsl */ `
  { vec3 envWP = cameraPosition + geometryPosition * mat3(viewMatrix); directLight.color *= cloudSunShadow(envWP, uSunDir); }
`;

let patched = false;

/** Patch ShaderChunks. Call once at startup BEFORE constructing CSM, and call patchLightChunk() after CSM. */
export function installEnvironmentHooks() {
  if (patched) return;
  patched = true;

  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vEnvWP;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvEnvWP = cameraPosition + mvPosition.xyz * mat3( viewMatrix );\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vEnvWP;\n#endif\n${ENV_DECL}`;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;

  // give every material the ENV uniforms (materials that set their own onBeforeCompile must call addEnvUniforms)
  THREE.Material.prototype.onBeforeCompile = envHook;
  THREE.Material.prototype.customProgramCacheKey = function customKey() {
    return this.onBeforeCompile.toString() + (this.userData.programKey || '');
  };
}

function envHook(shader) {
  addEnvUniforms(shader);
}

/** Insert the cloud-shadow term into the directional-light loops of the (possibly CSM-replaced) chunk. */
export function patchLightChunk() {
  let s = THREE.ShaderChunk.lights_fragment_begin;
  if (s.includes('cloudSunShadow')) return;
  // declarations must exist wherever the light loop is compiled
  THREE.ShaderChunk.lights_pars_begin = ENV_DECL + THREE.ShaderChunk.lights_pars_begin;
  s = s.replace(/getDirectionalLightInfo\( directionalLight, directLight \);/g, (m) => m + CLOUD_SHADOW_INJECT);
  THREE.ShaderChunk.lights_fragment_begin = s;
}

export { ENV_DECL };
