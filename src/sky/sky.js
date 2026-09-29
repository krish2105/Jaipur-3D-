// Sky system: atmosphere sky-view LUT, sky pass (sun, moon, stars, clouds), cloud noise, IBL cube.
import * as THREE from 'three';
import { ENV, ENV_DECL } from '../render/env.js';
import { GLSL_ATMOSPHERE, GLSL_COMMON } from '../render/glsl.js';
import { twilightParams } from './atmosphere.js';

const FULLSCREEN = new THREE.BufferGeometry();
FULLSCREEN.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------------------------------------------------------------------------------------------
// tileable noise texture (rgba8): r perlin-worley fbm, g/b/a worley at increasing frequency
const NOISE_FRAG = /* glsl */ `
${GLSL_COMMON}
varying vec2 vUv;
float ph(vec2 p, float per){ return hash12(mod(p, per)); }
float pnoise(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph(i, per), ph(i + vec2(1, 0), per), u.x), mix(ph(i + vec2(0, 1), per), ph(i + vec2(1, 1), per), u.x), u.y);
}
float pfbm(vec2 p, float per){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * pnoise(p, per); p *= 2.0; per *= 2.0; a *= 0.5; } return s / 0.96875; }
float worley(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y)); vec2 o = hash22(mod(i + g, per) + 11.0);
    d = min(d, length(g + o - f));
  }
  return d;
}
void main(){
  vec2 uv = vUv;
  float pf = pfbm(uv * 6.0, 6.0);
  float w1 = 1.0 - worley(uv * 8.0, 8.0);
  float r = clamp(pf * 0.85 + w1 * 0.4 - 0.12, 0.0, 1.0);
  float g = clamp(1.0 - worley(uv * 5.0, 5.0), 0.0, 1.0);
  float b = clamp(1.0 - worley(uv * 13.0, 13.0), 0.0, 1.0);
  float a = clamp(1.0 - worley(uv * 29.0, 29.0), 0.0, 1.0);
  gl_FragColor = vec4(r, g, b, a);
}
`;

// ---------------------------------------------------------------------------------------------
// sky-view LUT: u = azimuth from sun (0..pi), v = elevation (sqrt-mapped, 0.5 = horizon)
const LUT_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_ATMOSPHERE}
varying vec2 vUv;
uniform float uSunElev;
uniform float uMieScale;
uniform vec3 uDustTint;
uniform float uObsAlt;
uniform float uMS;
uniform float uSunIrr;
uniform float uOvercast;
uniform float uTwiGain;
void main(){
  float phi = vUv.x * PI;
  float vv = vUv.y - 0.5;
  float e = sign(vv) * (2.0 * abs(vv)) * (2.0 * abs(vv)) * PI * 0.5;
  vec3 d = vec3(cos(e) * cos(phi), sin(e), cos(e) * sin(phi));
  vec3 s = vec3(cos(uSunElev), sin(uSunElev), 0.0);
  vec3 o = vec3(0.0, Rg + uObsAlt, 0.0);
  float tTop = raySphereFar(o, d, Rt);
  float tGround = raySphereNear(o, d, Rg);
  float tMax = tGround > 0.0 ? tGround : tTop;
  const int N = 28;
  vec3 odView = vec3(0.0);
  vec3 L = vec3(0.0);
  float mu = dot(d, s);
  float pR = rayleighPhase(mu);
  float pM = miePhase(mu, 0.8);
  for (int i = 0; i < N; i++){
    float u0 = float(i) / float(N), u1 = float(i + 1) / float(N);
    float t0 = tMax * u0 * u0, t1 = tMax * u1 * u1;
    float t = 0.5 * (t0 + t1), dt = t1 - t0;
    vec3 p = o + d * t;
    float h = length(p) - Rg;
    float dR = exp(-h / HR), dM = exp(-h / HM) * uMieScale;
    float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
    vec3 ext = bR * dR + bMe * dM * uDustTint + bO * dO;
    odView += ext * dt;
    vec3 Tv = exp(-odView);
    float occl = raySphereNear(p, s, Rg) > 0.0 ? 0.0 : 1.0;
    vec3 odS = opticalDepthToSun(p, s, uMieScale, uDustTint);
    vec3 Ts = exp(-odS) * occl;
    vec3 scat = bR * dR * pR + bMs * dM * pM * uDustTint;
    // isotropic multiple-scattering approximation: sunlight reaches the point with far less extinction
    // than the direct beam (light arrives by many paths), which keeps sunset horizons from going black
    vec3 Tms = exp(-odS * 0.3) * occl;
    vec3 iso = (bR * dR + bMs * dM * uDustTint) * (1.0 / (4.0 * PI)) * uMS;
    L += Tv * (Ts * scat + Tms * iso) * dt;
  }
  vec3 col = L * uSunIrr * uTwiGain;
  // overcast washes the sky toward a flat grey of the same luminance
  float lm = luma(col);
  col = mix(col, vec3(lm) * 1.05, uOvercast * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
void main(){
  gl_Position = vec4(position.xy, 1.0, 1.0);
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
${ENV_DECL}
varying vec3 vDir;
uniform vec3 uCloudSun;
uniform vec3 uCloudAmb;
uniform vec3 uSunDisc;
uniform vec4 uMoonP;       // x illum, y parallactic q, z angular radius, w earthshine
uniform vec3 uMoonRad2;
uniform mat3 uStarRot;
uniform float uStarGain;
uniform float uStarCut;
uniform float uCloudFade; // fair-weather clouds are all but invisible in a dark sky
uniform float uPixAngle;
uniform vec3 uGroundLight;
uniform float uFlash;

float hg(float c, float g){ return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * c, 1e-3), 1.5)); }

vec4 cloudMarch(vec3 ro, vec3 rd){
  float base = uCloud.z, top = uCloud.z + uCloud.w;
  float tA = (base - ro.y) / rd.y, tB = (top - ro.y) / rd.y;
  if (tB <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  tA = max(tA, 0.0);
  float dt = (tB - tA) / float(CLOUD_STEPS);
  // white-noise jitter that changes every frame: reads as fine grain (and averages out in motion) instead of the structured hatch of gradient noise
  float jit = hash12(gl_FragCoord.xy + fract(uTime * 0.6180339) * 173.0);
  const float SIGMA = 0.014;
  float T = 1.0; vec3 L = vec3(0.0);
  float mu = dot(rd, uSunDir);
  float ph = mix(hg(mu, 0.62), hg(mu, -0.25), 0.28);
  for (int i = 0; i < CLOUD_STEPS; i++){
    float t = tA + (float(i) + jit) * dt;
    vec3 p = ro + rd * t;
    float hf = clamp((p.y - base) / uCloud.w, 0.0, 1.0);
    float lodv = max(0.0, log2(max(t, 1.0) * uPixAngle / 27.0) + 1.0);
    float d = cloudDensity(p.xz, hf, CLOUD_DETAIL, lodv);
    if (d > 0.003){
      float od = d * SIGMA * dt;
      float lo = 0.0;
      for (int j = 1; j <= CLOUD_LIGHT_STEPS; j++){
        vec3 q = p + uSunDir * (float(j) * 260.0);
        lo += cloudDensity(q.xz, clamp((q.y - base) / uCloud.w, 0.0, 1.0), false, lodv + 1.0);
      }
      float lightT = exp(-lo * SIGMA * 260.0);
      float lightMS = exp(-lo * SIGMA * 260.0 * 0.22);
      float powder = 1.0 - 0.5 * exp(-d * 6.0);
      vec3 S = uCloudSun * (lightT * ph * 3.2 * powder + 0.30 * lightMS * (0.55 + 0.45 * hf)) + uCloudAmb * (0.55 + 0.45 * hf) * (0.6 + 0.4 * lightMS);
      S += vec3(0.75, 0.82, 1.0) * uFlash * 0.9 * (0.4 + 0.6 * d);
      float a = exp(-od);
      L += T * (1.0 - a) * S;
      T *= a;
      if (T < 0.015) break;
    }
  }
  L *= 1.0 - uCloudFade;
  T = mix(T, 1.0, uCloudFade);
  return vec4(L, T);
}

vec3 starLayer(vec3 e, float cells, float prob, float size, float gain, float cut){
  vec3 p = e * cells;
  vec3 ip = floor(p);
  vec3 h = hash33(ip);
  if (h.x > prob) return vec3(0.0);
  vec3 sp = (ip + 0.2 + 0.6 * hash33(ip + 7.3)) / cells;
  float ang = length(e - normalize(sp));
  // magnitude limit of a bright city sky: only the brightest stars of each layer survive (uStarCut), the rest is washed out
  // cut is the fraction of the brightness range removed: 0.42 keeps ~15 % of the coarse layer, 0.9+ keeps only the top ~2 % of the fine ones
  float b = gain * max(0.0, pow(hash13(ip + 3.1), 5.0) - cut * uStarCut);
  float tw = 1.0 + 0.22 * sin(uTime * (2.0 + 6.0 * h.y) + h.z * 40.0);
  vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.82, 1.0), h.y);
  return tint * b * tw * exp(-pow(ang / size, 2.0));
}

vec3 stars(vec3 dir){
  vec3 e = normalize(uStarRot * dir);
  float sz = uPixAngle * 0.8;
  // brightness kept moderate: at night exposure (6-10x) plus bloom a gain of 9 turned the brightest stars into big flat discs (screenshot review)
  vec3 c = starLayer(e, 45.0, 0.07, sz * 1.15, 4.6, 0.42);
  c += starLayer(e, 95.0, 0.10, sz, 3.0, 0.88);
  c += starLayer(e, 190.0, 0.14, sz * 0.9, 2.0, 0.93);
  // Milky Way band: galactic pole (RA 192.86, Dec +27.13) in equatorial coordinates
  vec3 pole = vec3(cos(0.4735) * cos(3.3660), cos(0.4735) * sin(3.3660), sin(0.4735));
  float b = asin(clamp(dot(e, pole), -1.0, 1.0));
  float band = exp(-pow(b / 0.2, 2.0));
  float n = vnoise3(e * 5.0) * 0.6 + vnoise3(e * 13.0) * 0.4;
  float lane = smoothstep(0.55, 0.8, vnoise3(e * 9.0 + 4.0));
  // (the Milky Way is barely visible from a bright city; at 0.05 it read as a searchlight beam in the Diwali night review)
  c += vec3(0.85, 0.86, 1.0) * band * n * (1.0 - 0.6 * lane) * 0.014;
  return c * uStarGain;
}

vec3 moonDisc(vec3 dir, out float glow){
  glow = 0.0;
  float cs = dot(dir, uMoonDir);
  float ang = sqrt(max(2.0 * (1.0 - cs), 0.0));
  float R = uMoonP.z;
  glow = exp(-ang * 30.0) * 0.012 + exp(-ang * 7.0) * 0.0012;
  if (ang > R * 1.02 || uMoonDir.y < -0.12) return vec3(0.0);
  vec3 m = uMoonDir;
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), m));
  vec3 u = cross(m, r);
  vec2 xy = vec2(dot(dir, r), dot(dir, u)) / R;
  float rr = dot(xy, xy);
  float edge = 1.0 - smoothstep(0.985, 1.02, sqrt(rr));
  float zz = sqrt(max(1.0 - rr, 0.0));
  vec3 n = xy.x * r + xy.y * u - zz * m;
  float lit = clamp(dot(n, uSunDir) * 1.0, 0.0, 1.0);
  lit = smoothstep(0.0, 0.16, lit) * 0.85 + 0.15 * lit;
  // albedo: procedural maria layout (north up, west left as seen from the northern hemisphere)
  float q = uMoonP.y;
  vec2 mp = mat2(cos(q), -sin(q), sin(q), cos(q)) * xy;
  mp.x = -mp.x; // mirror: east/west handedness of the sky
  float maria = 0.0;
  maria += smoothstep(0.24, 0.14, length((mp - vec2(-0.28, 0.42)) * vec2(1.0, 1.05)));
  maria += smoothstep(0.14, 0.07, length(mp - vec2(0.18, 0.40)));
  maria += smoothstep(0.18, 0.09, length((mp - vec2(0.30, 0.15)) * vec2(1.0, 1.1)));
  maria += smoothstep(0.10, 0.05, length((mp - vec2(0.64, 0.22)) * vec2(1.6, 1.0)));
  maria += smoothstep(0.11, 0.05, length(mp - vec2(0.60, -0.10)));
  maria += smoothstep(0.07, 0.03, length(mp - vec2(0.42, -0.10)));
  maria += smoothstep(0.30, 0.14, length((mp - vec2(-0.62, 0.06)) * vec2(1.0, 0.8)));
  maria += smoothstep(0.15, 0.07, length(mp - vec2(-0.20, -0.42)));
  maria += smoothstep(0.09, 0.04, length(mp - vec2(-0.52, -0.42)));
  maria = clamp(maria, 0.0, 1.0);
  float grain = 0.86 + 0.28 * vnoise(mp * 26.0) * vnoise(mp * 7.0 + 3.0) * 1.6;
  float tycho = smoothstep(0.07, 0.0, length(mp - vec2(-0.12, -0.72)));
  float rays = smoothstep(0.5, 0.0, length((mp - vec2(-0.12, -0.72)) * vec2(1.0, 1.0))) * (0.4 + 0.6 * vnoise(vec2(atan(mp.y + 0.72, mp.x + 0.12) * 9.0 + 1.0, 0.5))) * 0.35;
  float alb = mix(0.16, 0.075, maria) * grain + tycho * 0.25 + rays * 0.05 + smoothstep(0.03, 0.0, length(mp - vec2(-0.32, 0.18))) * 0.12;
  float earth = uMoonP.w;
  vec3 c = uMoonRad2 * alb * (lit + earth * 0.02) * edge;
  return c;
}

void main(){
  vec3 dir = normalize(vDir);
  vec3 d0 = normalize(vec3(dir.x, max(dir.y, 0.0005), dir.z));
  vec3 sky = envSkyAt(d0);
  #ifdef SKY_ENV
    if (dir.y < 0.0) sky = mix(sky, uGroundLight, smoothstep(0.0, -0.08, dir.y));
  #else
    if (dir.y < 0.0) sky *= mix(1.0, 0.55, smoothstep(0.0, -0.08, dir.y));
  #endif

  vec3 celestial = vec3(0.0);
  #ifndef SKY_ENV
    float cs = dot(dir, uSunDir);
    float ang = sqrt(max(2.0 * (1.0 - cs), 0.0));
    const float SR = 0.00465;
    if (uSunDir.y > -0.1){
      float disc = 1.0 - smoothstep(SR * 0.94, SR * 1.03, ang);
      float mu = sqrt(max(1.0 - pow(min(ang / SR, 1.0), 2.0), 0.0));
      celestial += uSunDisc * disc * (0.45 + 0.55 * mu);
      celestial += uSunDisc * (exp(-ang * 55.0) * 0.045 + exp(-ang * 12.0) * 0.006);
    }
    float mglow;
    celestial += moonDisc(dir, mglow);
    celestial += uMoonRad2 * mglow * 0.5;
    if (uStarGain > 0.001 && dir.y > -0.02) celestial += stars(dir) * smoothstep(-0.02, 0.06, dir.y);
  #endif

  float T = 1.0; vec3 L = vec3(0.0);
  if (dir.y > 0.002 && uCloud.x > 0.01){
    vec4 cm = cloudMarch(cameraPosition, dir);
    float fade = smoothstep(0.0, 0.10, dir.y);
    L = cm.rgb * fade; T = mix(1.0, cm.a, fade);
    // aerial perspective on distant cloud: pull toward the horizon sky
    float dist = (uCloud.z - cameraPosition.y) / max(dir.y, 0.02);
    float aer = 1.0 - exp(-max(dist, 0.0) * 2.0e-5 * (1.0 + 4.0 * uSkyAux.y));
    L = mix(L, sky * (1.0 - T), aer * 0.6);
  }
  // cirrus: thin high layer
  if (dir.y > 0.01 && uCloudFx.z > 0.005){
    float ct = (9000.0 - cameraPosition.y) / dir.y;
    vec2 cp = (cameraPosition.xz + dir.xz * ct) * (1.0 / 30000.0);
    vec4 n = texture2D(uNoise, cp * vec2(1.0, 2.4) + uCloudOffset * 0.000012);
    float ci = smoothstep(0.52, 0.86, n.r * 0.6 + n.g * 0.4) * uCloudFx.z * smoothstep(0.01, 0.15, dir.y);
    L += T * ci * (uCloudSun * 0.35 + uCloudAmb * 0.9);
    T *= 1.0 - 0.55 * ci;
  }
  vec3 col = sky * T + L + celestial * T;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
export class SkySystem {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {object} settings tier settings
   */
  constructor(renderer, scene, settings) {
    this.renderer = renderer;
    this.scene = scene;
    this.settings = settings;
    this.lutSize = [128, 96];
    this._qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._qscene = new THREE.Scene();
    this._qmesh = new THREE.Mesh(FULLSCREEN, new THREE.MeshBasicMaterial());
    this._qmesh.frustumCulled = false;
    this._qscene.add(this._qmesh);

    this._makeNoise();
    this._makeLUT();
    this._makeSky();
    this._makeEnvCube();
    this._envTimer = 999;
    this._lutKey = '';
    this.pmremGen = new THREE.PMREMGenerator(renderer);
    this._pmremRT = null;
    this.envIntensityTrack = 1;
  }

  // ---- resources ---------------------------------------------------------------------------
  _blit(material, target) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = true;
    this._qmesh.material = material;
    r.setRenderTarget(target);
    r.render(this._qscene, this._qcam);
    r.setRenderTarget(prev);
    r.autoClear = autoClear;
  }

  _makeNoise() {
    const size = this.settings.skyCubeSize >= 64 ? 512 : 256;
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: NOISE_FRAG, depthTest: false, depthWrite: false });
    this._blit(mat, rt);
    mat.dispose();
    this.noiseRT = rt;
    ENV.uNoise.value = rt.texture;
    rt.texture.anisotropy = 4;
  }

  _makeLUT() {
    this.lutRT = new THREE.WebGLRenderTarget(this.lutSize[0], this.lutSize[1], { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, generateMipmaps: false });
    this.lutMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: LUT_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSunElev: { value: 0.5 }, uMieScale: { value: 30 }, uDustTint: { value: new THREE.Vector3(1, 1, 1) },
        uObsAlt: { value: 460 }, uMS: { value: 1.6 }, uSunIrr: { value: 13 }, uOvercast: { value: 0 }, uTwiGain: { value: 1 },
      },
    });
    ENV.uSkyLUT.value = this.lutRT.texture;
  }

  _skyMaterial(env) {
    const cloudMode = this.settings.cloudMode || 'layered';
    const steps = env ? 4 : { volumetric: 36, layered: 18, flat: 8 }[cloudMode];
    const lightSteps = env ? 1 : { volumetric: 3, layered: 2, flat: 1 }[cloudMode];
    const detail = !env && cloudMode !== 'flat';
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      defines: { CLOUD_STEPS: steps, CLOUD_LIGHT_STEPS: lightSteps, CLOUD_DETAIL: detail ? 'true' : 'false', ...(env ? { SKY_ENV: 1 } : {}) },
      depthTest: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCloudSun: { value: new THREE.Vector3(1, 1, 1) },
        uCloudAmb: { value: new THREE.Vector3(0.2, 0.3, 0.5) },
        uSunDisc: { value: new THREE.Vector3(30, 30, 30) },
        uMoonP: { value: new THREE.Vector4(0, 0, 0.0047, 1) },
        uMoonRad2: { value: new THREE.Vector3(3, 3, 3) },
        uStarRot: { value: new THREE.Matrix3() },
        uStarGain: { value: 0 },
        uStarCut: { value: 1 },
        uCloudFade: { value: 0 },
        uPixAngle: { value: 0.001 },
        uGroundLight: { value: new THREE.Vector3(0.1, 0.09, 0.08) },
        uFlash: { value: 0 },
      },
    });
    m.userData.programKey = env ? 'skyenv' : 'sky' + cloudMode;
    return m;
  }

  _makeSky() {
    this.skyMat = this._skyMaterial(false);
    this.skyMesh = new THREE.Mesh(FULLSCREEN, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = 10000;
    this.skyMesh.name = 'sky';
    this.skyMesh.onBeforeRender = (r, s, cam) => {
      const u = this.skyMat.uniforms;
      u.uInvProj.value.copy(cam.projectionMatrixInverse);
      u.uCamWorld.value.copy(cam.matrixWorld);
      const h = r.getRenderTarget() ? r.getRenderTarget().height : r.domElement.height;
      u.uPixAngle.value = (cam.fov ? (cam.fov * Math.PI) / 180 : 1) / Math.max(1, h);
    };
    this.scene.add(this.skyMesh);
  }

  _makeEnvCube() {
    const size = this.settings.skyCubeSize;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 1000, this.cubeRT);
    this.envScene = new THREE.Scene();
    this.envMat = this._skyMaterial(true);
    this.envMesh = new THREE.Mesh(FULLSCREEN, this.envMat);
    this.envMesh.frustumCulled = false;
    this.envMesh.onBeforeRender = (r, s, cam) => {
      this.envMat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
      this.envMat.uniforms.uCamWorld.value.copy(cam.matrixWorld);
    };
    this.envScene.add(this.envMesh);
  }

  // ---- per-frame ---------------------------------------------------------------------------
  /**
   * @param {import('./environment.js').EnvState} env
   * @param {object} w weather.s
   * @param {number} dt real seconds
   * @param {{windOffset:number[], time:number, flash:number, camera:THREE.Camera}} ctx
   */
  update(env, w, dt, ctx) {
    // shared uniforms
    ENV.uSunDir.value.copy(env.sunDir);
    ENV.uMoonDir.value.copy(env.moonDir);
    ENV.uSunRad.value.set(env.sunColor.r, env.sunColor.g, env.sunColor.b);
    ENV.uMoonRad.value.set(env.moonColor.r, env.moonColor.g, env.moonColor.b);
    ENV.uSkyAux.value.set(env.skyAux.nightGlow, env.skyAux.overcast, env.skyAux.ground, 0);
    ENV.uFog.value.set(env.fog.density, env.fog.falloff, 0, env.fog.glow);
    ENV.uFog2.value.set(0.00055, env.fog.noise * (this.settings.fogNoise === false ? 0 : 1), env.fog.mist, this.settings.fogNoise === false ? 0 : 1);
    ENV.uCloud.value.set(env.cloud.cover, env.cloud.density, env.cloud.base, env.cloud.thick);
    ENV.uCloudFx.value.set(this.settings.cloudShadows ? env.cloud.shadow : 0, env.skyAux.overcast, env.cloud.cirrus, env.cloud.storm);
    ENV.uCloudOffset.value.set(ctx.windOffset[0], ctx.windOffset[1]);
    ENV.uTime.value = ctx.time;
    ENV.uNight.value = env.night;
    ENV.uWindV.value.set(Math.sin(w.windDir) * w.windSpeed, Math.cos(w.windDir) * w.windSpeed);

    // sky-view LUT (cheap: re-render when anything meaningful changed)
    const lu = this.lutMat.uniforms;
    const tw = twilightParams(env.sunAlt);
    const sunElev = (tw.effAlt * Math.PI) / 180;
    const gain = tw.gain;
    const key = `${(sunElev * 400) | 0}|${(gain * 10) | 0}|${(env.mieScale * 4) | 0}|${env.dustTint.map((v) => (v * 50) | 0).join(',')}|${(env.skyAux.overcast * 50) | 0}`;
    if (key !== this._lutKey) {
      this._lutKey = key;
      lu.uSunElev.value = sunElev;
      lu.uMieScale.value = env.mieScale;
      lu.uDustTint.value.set(env.dustTint[0], env.dustTint[1], env.dustTint[2]);
      lu.uOvercast.value = env.skyAux.overcast;
      lu.uTwiGain.value = gain;
      this._blit(this.lutMat, this.lutRT);
    }

    // sky material uniforms (shared by both variants)
    const cs = env.cloudSunTrans;
    const cm = 1 - 0.9 * env.skyAux.overcast;
    const amb = this._ambientEstimate(env);
    for (const m of [this.skyMat, this.envMat]) {
      const u = m.uniforms;
      u.uCloudSun.value.set(cs[0] * 6.2 * cm * (env.sunAlt > -2.5 ? 1 : 0), cs[1] * 6.2 * cm * (env.sunAlt > -2.5 ? 1 : 0), cs[2] * 6.2 * cm * (env.sunAlt > -2.5 ? 1 : 0));
      u.uCloudAmb.value.set(amb[0] * 0.9, amb[1] * 0.9, amb[2] * 0.9);
      u.uGroundLight.value.set(amb[0] * 0.8 + env.sunColor.r * Math.max(env.sunDir.y, 0) * 0.07, amb[1] * 0.75 + env.sunColor.g * Math.max(env.sunDir.y, 0) * 0.06, amb[2] * 0.7 + env.sunColor.b * Math.max(env.sunDir.y, 0) * 0.05);
      u.uFlash.value = ctx.flash;
    }
    const su = this.skyMat.uniforms;
    const tr = env.sunTrans;
    const disc = 55 * Math.max(0, Math.min(1, (env.sunAlt + 2) / 4)) * (1 - 0.95 * env.skyAux.overcast);
    su.uSunDisc.value.set(tr[0] * disc, tr[1] * disc, tr[2] * disc);
    su.uMoonP.value.set(env.moonIllum, env.moonQ, 0.0049, env.night);
    const mr = 3.4 * (1 - 0.8 * env.skyAux.overcast);
    su.uMoonRad2.value.set(0.8 * mr, 0.9 * mr, 1.0 * mr);
    su.uStarGain.value = env.starGain;
    su.uStarCut.value = this.settings.starCut ?? 1;
    su.uCloudFade.value = 0.85 * env.night * (1 - env.skyAux.overcast) * (1 - 0.6 * env.cloud.storm);
    // horizon (world: x east, y up, -z north) -> equatorial rotation for the star field
    su.uStarRot.value.copy(this._starMatrix(env.lstRad));

    // IBL cube: update at a tier-dependent cadence
    this._envTimer += dt;
    const cadence = this.settings.skyCubeSize >= 128 ? 0.6 : this.settings.skyCubeSize >= 64 ? 1.2 : 2.5;
    if (this._envTimer >= cadence) {
      this._envTimer = 0;
      this.updateEnvironment(env);
    }
  }

  _ambientEstimate(env) {
    // Rough sky irradiance colour used for cloud ambient and ground bounce (no GPU read-back).
    const d = Math.max(0, Math.min(1, (env.sunAlt + 6) / 26));
    const day = 0.34 * Math.pow(d, 0.8) * (1 - 0.45 * env.skyAux.overcast) + 0.04 * env.skyAux.overcast * d;
    const tw = env.twilight * 0.09;
    const night = 0.006 + 0.03 * env.moonIllum * Math.max(0, Math.sin((env.moonAlt * Math.PI) / 180));
    const base = day + tw + night;
    return [base * (0.62 + 0.25 * env.night), base * (0.76 + 0.1 * env.night), base * (1.0 + 0.2 * env.night)];
  }

  _starMatrix(lst) {
    // World frame: x east, y up, z south. ENU components: E = x, N = -z, U = y.
    // Hour-angle frame axes expressed in ENU: xH toward the celestial equator on the meridian (south),
    // yH toward the west (H = +90 deg), zH toward the north celestial pole.
    // Equatorial: X = cos(t)*xH + sin(t)*yH ; Y = sin(t)*xH - cos(t)*yH ; Z = zH   (t = local sidereal time)
    const lat = (26.9235 * Math.PI) / 180;
    const sl = Math.sin(lat), cl = Math.cos(lat);
    const st = Math.sin(lst), ct = Math.cos(lst);
    const xH = [0, -sl, cl], yH = [-1, 0, 0], zH = [0, cl, sl];
    const X = xH.map((v, i) => ct * v + st * yH[i]);
    const Y = xH.map((v, i) => st * v - ct * yH[i]);
    const m = new THREE.Matrix3();
    // each row: coefficients on world (x, y, z) = (E, U, -N)
    m.set(X[0], X[2], -X[1], Y[0], Y[2], -Y[1], zH[0], zH[2], -zH[1]);
    return m;
  }

  /** Render the sky (no sun/moon/stars) into the cube and PMREM it for image-based lighting. */
  updateEnvironment() {
    this.cubeCam.position.set(0, 450, 0);
    this.cubeCam.update(this.renderer, this.envScene);
    this._pmremRT = this.pmremGen.fromCubemap(this.cubeRT.texture, this._pmremRT);
    this.scene.environment = this._pmremRT.texture;
  }

  dispose() {
    this.noiseRT.dispose();
    this.lutRT.dispose();
    this.cubeRT.dispose();
    this._pmremRT?.dispose();
    this.pmremGen.dispose();
  }
}
