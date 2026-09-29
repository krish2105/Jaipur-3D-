// Dust storm flow: wind-driven soft dust sprites in a camera-centred, world-locked wrapped volume (same trick as the rain).
// Each sprite is a noisy, wind-stretched puff coloured by the dust tint and the ambient light (so it is dark at night and orange under a low sun),
// occluded by geometry, faded near the lens and with distance. The global haze itself is the fog model; this adds the visible moving structure.
import * as THREE from 'three';
import { ENV, ENV_DECL } from '../render/env.js';

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uFxTime;
uniform vec3 uBox;
uniform vec3 uCamP;
uniform vec3 uWind;        // x,z m/s
uniform vec4 uDustP;       // x intensity 0..1, y size scale, z stretch, w unused
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying vec3 vRayW;
varying float vDist;
void main(){
  float on = step(aSeed.w, uDustP.x);
  vec3 vel = vec3(uWind.x, 0.0, uWind.z) * (0.75 + 0.5 * fract(aSeed.w * 5.1 + aSeed.y)) + vec3(0.0, 0.25 * sin(uFxTime * 0.6 + aSeed.x * 40.0), 0.0);
  vec3 rel = fract(aSeed.xyz + (vel * uFxTime - uCamP) / uBox);
  vec3 c = uCamP + (rel - 0.5) * uBox;
  c.y = uCamP.y + (rel.y - 0.35) * uBox.y;
  float size = uDustP.y * (2.2 + 7.0 * fract(aSeed.z * 9.7 + aSeed.x));
  // billboard in view space, stretched along the wind direction as seen on screen
  vec4 vc = viewMatrix * vec4(c, 1.0);
  vec3 windV = (viewMatrix * vec4(normalize(vec3(uWind.x, 0.0, uWind.z) + vec3(1e-4, 0.0, 0.0)), 0.0)).xyz;
  vec2 ax = normalize(windV.xy + vec2(1e-4, 0.0));
  vec2 ay = vec2(-ax.y, ax.x);
  vec2 off = ax * position.x * size * uDustP.z + ay * position.y * size;
  vc.xy += off;
  vDist = length(c - uCamP);
  vRayW = normalize(c - uCamP);
  float edge = 1.0 - smoothstep(0.30, 0.5, length(rel.xz - 0.5));
  vFade = on * edge * smoothstep(2.5, 9.0, vDist) * (0.4 + 0.6 * fract(aSeed.z * 3.3));
  vUv = position.xy;
  vSeed = aSeed.x * 91.0 + aSeed.z * 17.0;
  gl_Position = projectionMatrix * vc;
  if (vFade <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
${ENV_DECL}
uniform vec3 uDustCol;
uniform vec4 uDustP;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying vec3 vRayW;
varying float vDist;
void main(){
  float r = length(vUv);
  if (r > 1.0) discard;
  float n = vnoise(vUv * 3.2 + vSeed) * 0.6 + vnoise(vUv * 7.0 - vSeed * 1.3) * 0.4;
  float a = smoothstep(1.0, 0.15, r) * (0.35 + 0.9 * n);
  vec3 amb = envSkyAt(vec3(0.0, 1.0, 0.0));
  float mu = max(dot(vRayW, uSunDir), 0.0);
  vec3 col = uDustCol * (amb * 0.75 + uSunRad * (0.02 + 0.10 * pow(mu, 3.0)));
  float tr = exp(-uFog.x * 1.5 * vDist);
  gl_FragColor = vec4(col, a * vFade * 0.22 * tr);
}
`;

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class DustFlow {
  constructor(settings) {
    const n = settings.dustParticles;
    const rng = mulberry(777);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { seeds[i * 4] = rng(); seeds[i * 4 + 1] = rng(); seeds[i * 4 + 2] = rng(); seeds[i * 4 + 3] = (i + 0.5) / n; }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      ...ENV,
      uFxTime: { value: 0 }, uBox: { value: new THREE.Vector3(110, 34, 110) }, uCamP: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3() }, uDustP: { value: new THREE.Vector4(0, 1, 2.4, 0) }, uDustCol: { value: new THREE.Color(1, 0.72, 0.42) },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false });
    this.mat.userData.programKey = 'dustflow';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.name = 'dustflow';
    this.mesh.visible = false;
  }

  /** @param {{time:number, intensity:number, windX:number, windZ:number, camera:THREE.Camera, tint:number[]}} c */
  update(c) {
    const on = c.intensity > 0.03;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.uniforms;
    u.uFxTime.value = c.time;
    u.uDustP.value.x = Math.min(1, c.intensity);
    u.uWind.value.set(c.windX, 0, c.windZ);
    u.uCamP.value.copy(c.camera.position);
    u.uDustCol.value.setRGB(c.tint[0], c.tint[1] * 0.92, c.tint[2] * 0.85);
  }
}
