// Rain: GPU-instanced thin streaks in a camera-centred, world-locked wrapped volume, plus ground splashes.
//  * depth-aware: streaks are ordinary depth-tested geometry, so buildings and terrain occlude them; they also thin out with distance
//    (the volume is only ~30 m deep) and lose contrast in fog
//  * not white lines: each streak is a soft 1-1.5 px wide sliver whose colour is the sky in its direction plus a forward-scatter
//    term toward the sun/moon, so rain shows against dark backgrounds only where it is backlit, exactly like rain does
//  * intensity thins the drop set (each drop has a fixed random rank), so light drizzle and a downpour are the same system
import * as THREE from 'three';
import { ENV, ENV_DECL } from '../render/env.js';

const QUAD = new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]);

const STREAK_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uFxTime;
uniform vec3 uBox;
uniform vec4 uRainP;      // x intensity, y fall speed (m/s), z streak length (m), w half-width (px)
uniform vec3 uWind;       // x,z m/s
uniform vec2 uViewport;   // px
uniform vec3 uCamP;
varying float vAlong;
varying float vAcross;
varying float vFade;
varying vec3 vRayW;
varying float vDist;
void main(){
  float on = step(aSeed.w, uRainP.x);
  vec3 vel = vec3(uWind.x, -uRainP.y, uWind.z) * (0.85 + 0.3 * fract(aSeed.w * 7.13 + aSeed.x));
  vec3 rel = fract(aSeed.xyz + (vel * uFxTime - uCamP) / uBox);
  vec3 p = uCamP + (rel - 0.5) * uBox + vec3(0.0, uBox.y * 0.12, 0.0);
  vec3 pt = p - normalize(vel) * uRainP.z;
  vec4 vh = viewMatrix * vec4(p, 1.0), vt = viewMatrix * vec4(pt, 1.0);
  vec4 ch = projectionMatrix * vh, ct = projectionMatrix * vt;
  vDist = length(p - uCamP);
  vRayW = normalize(p - uCamP);
  // radial fade of the wrapped volume + fade close to the lens (huge blurry streaks look wrong) + per-drop brightness
  float edge = 1.0 - smoothstep(0.32, 0.5, length((rel.xz - 0.5)));
  float ver = smoothstep(0.0, 0.08, rel.y) * (1.0 - smoothstep(0.85, 1.0, rel.y));
  vFade = on * edge * ver * smoothstep(0.35, 2.2, vDist) * (0.45 + 0.55 * fract(aSeed.z * 13.7));
  if (ch.w <= 0.05 || ct.w <= 0.05 || vFade <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sh = ch.xy / ch.w, st = ct.xy / ct.w;
  float asp = uViewport.x / uViewport.y;
  vec2 d = (sh - st) * vec2(asp, 1.0);
  float l = length(d);
  d = l > 1e-6 ? d / l : vec2(0.0, 1.0);
  vec2 perp = vec2(-d.y, d.x) / vec2(asp, 1.0);
  float e = position.y;                                   // 0 head .. 1 tail
  vec4 c = mix(ch, ct, e);
  float px = 2.0 * uRainP.w / uViewport.y;                // half-width in NDC-y units
  c.xy += perp * position.x * px * c.w * vec2(1.0, 1.0);
  vAlong = e;
  vAcross = position.x;
  gl_Position = c;
}
`;

const STREAK_FRAG = /* glsl */ `
precision highp float;
${ENV_DECL}
uniform vec4 uRainP;
uniform vec3 uTint;
varying float vAlong;
varying float vAcross;
varying float vFade;
varying vec3 vRayW;
varying float vDist;
void main(){
  float shape = (1.0 - vAcross * vAcross) * (1.0 - vAlong) * (0.35 + 0.65 * smoothstep(1.0, 0.0, vAlong));
  // rain is a thin refractive/scattering sliver: it carries the sky behind it, brighter when backlit
  vec3 sky = envSkyAt(normalize(vec3(vRayW.x, abs(vRayW.y) * 0.5 + 0.35, vRayW.z)));
  float sunF = pow(max(dot(vRayW, uSunDir), 0.0), 6.0), moonF = pow(max(dot(vRayW, uMoonDir), 0.0), 6.0);
  vec3 col = sky * 0.85 + uSunRad * (0.035 * sunF + 0.006) + uMoonRad * (0.05 * moonF) + uTint;
  float tr = exp(-uFog.x * 2.0 * vDist);
  float a = shape * vFade * 0.30 * tr;
  gl_FragColor = vec4(col, a);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uFxTime;
uniform vec3 uBox;
uniform vec3 uCamP;
uniform float uGround;
uniform float uRain;
varying vec2 vUv;
varying float vAge;
varying float vFade;
void main(){
  float on = step(aSeed.w, uRain);
  vec3 rel = fract(vec3(aSeed.x, 0.0, aSeed.z) - vec3(uCamP.x, 0.0, uCamP.z) / uBox);
  float life = 0.55 + 0.35 * fract(aSeed.y * 5.3);
  float ph = fract(uFxTime / life + aSeed.y);
  vec3 c = vec3(uCamP.x + (rel.x - 0.5) * uBox.x, uGround + 0.04, uCamP.z + (rel.z - 0.5) * uBox.z);
  float r = (0.03 + 0.38 * ph) * (0.7 + 0.6 * fract(aSeed.z * 9.1));
  vec3 wp = c + vec3(position.x, 0.0, position.y) * r;
  vUv = position.xy;
  vAge = ph;
  float d = length(c.xz - uCamP.xz);
  vFade = on * (1.0 - smoothstep(0.35 * uBox.x, 0.5 * uBox.x, d)) * (1.0 - ph) * (1.0 - ph) * smoothstep(0.5, 2.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
precision highp float;
${ENV_DECL}
varying vec2 vUv;
varying float vAge;
varying float vFade;
void main(){
  float d = length(vUv);
  float ring = smoothstep(0.18, 0.0, abs(d - 0.85 + 0.0)) * step(d, 1.0);
  vec3 sky = envSkyAt(vec3(0.0, 1.0, 0.0));
  gl_FragColor = vec4(sky * 1.3 + uSunRad * 0.01, ring * vFade * 0.5);
}
`;

function seeds(n, rng) {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) a[i * 4 + k] = rng();
  // rank in .w: sorted stratified so the first fraction of instances is a uniform subset
  for (let i = 0; i < n; i++) a[i * 4 + 3] = (i + 0.5) / n;
  return a;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Rain {
  /** @param {{rainParticles:number}} settings */
  constructor(settings) {
    const n = settings.rainParticles;
    this.count = n;
    const rng = mulberry(1234);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(QUAD, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(n, rng), 4));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      ...ENV,
      uFxTime: { value: 0 }, uBox: { value: new THREE.Vector3(46, 30, 46) }, uRainP: { value: new THREE.Vector4(0, 9.2, 0.55, 0.6) },
      uWind: { value: new THREE.Vector3() }, uViewport: { value: new THREE.Vector2(1, 1) }, uCamP: { value: new THREE.Vector3() }, uTint: { value: new THREE.Vector3(0, 0, 0) },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.NormalBlending, fog: false });
    this.mat.userData.programKey = 'rain';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'rain';

    // splashes
    const ns = Math.max(200, Math.round(n * 0.22));
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(ns, mulberry(99)), 4));
    sg.instanceCount = ns;
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.splashUniforms = { ...ENV, uFxTime: this.uniforms.uFxTime, uBox: { value: new THREE.Vector3(34, 1, 34) }, uCamP: this.uniforms.uCamP, uGround: { value: 0 }, uRain: { value: 0 } };
    this.splashMat = new THREE.ShaderMaterial({ vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, uniforms: this.splashUniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false });
    this.splashMat.userData.programKey = 'rain-splash';
    this.splashes = new THREE.Mesh(sg, this.splashMat);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 19;
    this.splashes.name = 'rain-splashes';
    this.group = new THREE.Group();
    this.group.name = 'rain';
    this.group.add(this.splashes, this.mesh);
    this.group.visible = false;
  }

  /**
   * @param {object} c { time, intensity 0..1, windX, windZ (m/s), camera, viewportW/H (px), groundY }
   */
  update(c) {
    const on = c.intensity > 0.02;
    this.group.visible = on;
    if (!on) return;
    const u = this.uniforms;
    u.uFxTime.value = c.time;
    u.uRainP.value.x = Math.min(1, c.intensity);
    u.uWind.value.set(c.windX, 0, c.windZ);
    u.uViewport.value.set(c.viewportW, c.viewportH);
    u.uCamP.value.copy(c.camera.position);
    this.splashUniforms.uRain.value = Math.min(1, c.intensity);
    this.splashUniforms.uGround.value = c.groundY;
  }
}
