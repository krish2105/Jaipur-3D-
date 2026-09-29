// Kite rendering: instanced two-tone diamond patang (paper: translucent, lit from behind too) + the strings as line segments.
// Data comes from the KiteSim (positions / poses); nothing is simulated here.
import * as THREE from 'three';
import { ENV } from '../render/env.js';

// linear reflectance palette of festival paper: strong saturated colours
const PAL = [
  [0.85, 0.06, 0.05], [0.95, 0.42, 0.04], [0.98, 0.78, 0.05], [0.1, 0.6, 0.18], [0.06, 0.25, 0.8], [0.7, 0.05, 0.45],
  [0.95, 0.95, 0.9], [0.05, 0.55, 0.65], [0.35, 0.1, 0.6], [0.98, 0.3, 0.5], [0.05, 0.05, 0.06], [0.75, 0.65, 0.3],
];

// half sizes in metres: a patang is about 0.46 m across and 0.52 m tall
function kiteGeometry() {
  const W = 0.23, T = 0.27, B = -0.25, S = 0.06, bow = -0.045;
  // centre point pushed back a little: the sail bows away from the wind
  const P = { t: [0, T, 0], l: [-W, S, 0], r: [W, S, 0], b: [0, B, 0], c: [0, 0.0, bow] };
  const tri = [['t', 'l', 'c'], ['t', 'c', 'r'], ['l', 'b', 'c'], ['c', 'b', 'r']];
  const pos = [], uv = [];
  for (const [a, b, c] of tri) for (const k of [a, b, c]) { pos.push(...P[k]); uv.push(P[k][0], P[k][1]); }
  // two-tone: the left half is colour A, the right half colour B (decided per triangle)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const tside = [];
  for (let i = 0; i < tri.length; i++) { const s = i === 0 || i === 2 ? 0 : 1; for (let k = 0; k < 3; k++) tside.push(s); }
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(tside, 1));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const VERT = /* glsl */ `
attribute float aSide;
attribute vec2 aUv;
attribute vec3 aColA;
attribute vec3 aColB;
uniform vec2 uViewport;
varying vec3 vAlb;
varying vec3 vNW;
varying vec3 vWP;
varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vec4 origin = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = max(-origin.z, 0.5);
  // a patang is ~0.5 m: keep it at least ~5 px wide so it stays visible from far (the only deliberate exaggeration)
  float pxw = 2.0 * d / (projectionMatrix[1][1] * uViewport.y);
  float sc = max(1.0, 5.0 * pxw / 0.46);
  vec3 lp = position * vec3(sc, sc, 1.0);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(lp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vec4 wp4 = modelMatrix * instanceMatrix * vec4(lp, 1.0);
  vWP = wp4.xyz;
  // face normal = local +z rotated by the instance matrix
  vNW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0));
  vAlb = mix(aColA, aColB, aSide);
  vUv = aUv;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vAlb;
varying vec3 vNW;
varying vec3 vWP;
varying vec2 vUv;
#include <fog_pars_fragment>
void main(){
  vec3 V = normalize(cameraPosition - vWP);
  vec3 n = normalize(vNW);
  float facing = dot(n, V);
  if (facing < 0.0) n = -n;
  vec3 alb = vAlb;
  // bamboo spine and cross-stick: thin darker lines
  float spine = 1.0 - smoothstep(0.006, 0.016, abs(vUv.x));
  float bar = (1.0 - smoothstep(0.006, 0.016, abs(vUv.y - 0.06))) * step(abs(vUv.x), 0.23);
  alb = mix(alb, vec3(0.25, 0.17, 0.08), max(spine, bar) * 0.75);
  float front = max(dot(n, uSunDir), 0.0);
  float back = max(dot(-n, uSunDir), 0.0);
  vec3 sky = envSkyAt(normalize(vec3(n.x, abs(n.y) * 0.6 + 0.35, n.z)));
  // paper is translucent: the sun behind the sheet lights it from within
  vec3 col = alb * (sky * 1.0 + uSunRad * (front + 0.55 * back) / 3.14159);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export class KiteRenderer {
  /** @param {{sim:import('./kites.js').KiteSim}} o */
  constructor(o) {
    this.sim = o.sim;
    const n = o.sim.n;
    const g = kiteGeometry();
    this.aColA = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColB = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aColA', this.aColA);
    g.setAttribute('aColB', this.aColB);
    // fog uniforms are cloned; the ENV uniforms stay shared by reference so they keep updating
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ENV, { uViewport: { value: new THREE.Vector2(1, 1) } });
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide, fog: true });
    this.mat.userData.programKey = 'kite';
    this.mesh = new THREE.InstancedMesh(g, this.mat, n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = 'kites';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // strings: NS segments per kite
    const NS = o.sim.NS;
    this.linePos = new THREE.BufferAttribute(new Float32Array(n * NS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', this.linePos);
    lg.setDrawRange(0, 0);
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xe9e2d0, transparent: true, opacity: 0.6 });
    this.lineMat.userData.programKey = 'kite-string';
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.name = 'kite-strings';
    this.group = new THREE.Group();
    this.group.name = 'kites';
    this.group.add(this.mesh, this.lines);
    this.group.visible = false;
    this.prev = new Float32Array(n * 3); // kite positions one fixed step ago (interpolation)
    this._pose = new Array(9).fill(0);
    this._m = new THREE.Matrix4();
    this.active = 0;
  }

  /** call once per fixed step BEFORE sim.step: remember positions for interpolation */
  beforeStep() {
    this.prev.set(this.sim.kp);
  }

  /** per rendered frame: write matrices, colours and strings. alpha = fixed-step interpolation factor */
  frame(alpha, camera, vw, vh) {
    const s = this.sim, n = s.n, NS = s.NS, N1 = NS + 1;
    this.uniforms.uViewport.value.set(vw, vh);
    const e = this.mesh.instanceMatrix.array;
    const A = this.aColA.array, B = this.aColB.array;
    const LP = this.linePos.array;
    const p = this._pose;
    const cx = camera.position.x, cz = camera.position.z;
    let k = 0, lo = 0;
    for (let i = 0; i < n; i++) {
      if (s.state[i] === 2) continue;
      const kx = this.prev[i * 3] + (s.kp[i * 3] - this.prev[i * 3]) * alpha;
      const ky = this.prev[i * 3 + 1] + (s.kp[i * 3 + 1] - this.prev[i * 3 + 1]) * alpha;
      const kz = this.prev[i * 3 + 2] + (s.kp[i * 3 + 2] - this.prev[i * 3 + 2]) * alpha;
      const dx = kx - cx, dz = kz - cz;
      if (dx * dx + dz * dz > 800 * 800) continue;
      s.pose(i, p);
      const o = k * 16, sz = s.size[i];
      e[o] = p[0] * sz; e[o + 1] = p[1] * sz; e[o + 2] = p[2] * sz; e[o + 3] = 0;
      e[o + 4] = p[3] * sz; e[o + 5] = p[4] * sz; e[o + 6] = p[5] * sz; e[o + 7] = 0;
      e[o + 8] = p[6]; e[o + 9] = p[7]; e[o + 10] = p[8]; e[o + 11] = 0;
      e[o + 12] = kx; e[o + 13] = ky; e[o + 14] = kz; e[o + 15] = 1;
      const ca = PAL[s.palette[i * 2] % PAL.length], cb = PAL[s.palette[i * 2 + 1] % PAL.length];
      A[k * 3] = ca[0]; A[k * 3 + 1] = ca[1]; A[k * 3 + 2] = ca[2];
      B[k * 3] = cb[0]; B[k * 3 + 1] = cb[1]; B[k * 3 + 2] = cb[2];
      k++;
      // string polyline (the last node is drawn at the interpolated kite position)
      const base = i * N1 * 3;
      for (let j = 0; j < NS; j++) {
        const a = base + j * 3, b = a + 3;
        LP[lo++] = s.sp[a]; LP[lo++] = s.sp[a + 1]; LP[lo++] = s.sp[a + 2];
        if (j === NS - 1) { LP[lo++] = kx; LP[lo++] = ky - 0.02; LP[lo++] = kz; }
        else { LP[lo++] = s.sp[b]; LP[lo++] = s.sp[b + 1]; LP[lo++] = s.sp[b + 2]; }
      }
    }
    this.mesh.count = k;
    this.active = k;
    if (k) {
      this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, k * 16); this.mesh.instanceMatrix.needsUpdate = true;
      for (const a of [this.aColA, this.aColB]) { a.clearUpdateRanges(); a.addUpdateRange(0, k * 3); a.needsUpdate = true; }
    }
    this.linePos.clearUpdateRanges(); this.linePos.addUpdateRange(0, lo); this.linePos.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, lo / 3);
    this.group.visible = k > 0;
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.lines.geometry.dispose(); this.lineMat.dispose(); }
}
