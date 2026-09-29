// Night / festival light renderers (instanced, nearest-N gather around the camera, fixed draw budgets):
//   GlowPoints  bulbs of the festival strings, roofline lights and diyas as camera-facing HDR sprites (core + halo), twinkling, additive
//   LampLayer   generated street-lamp poles + emissive heads (positions are APPROX, see layout.js)
//   SpanWires   the thin dark wires the string bulbs hang on (visible by day and at dusk)
// The static item sets live in flat typed arrays (see layout.js) and are re-gathered when the camera has moved a fifth of the draw radius.
import * as THREE from 'three';
import { ENV } from '../render/env.js';
import { makeLampPostGeometry, makeLampHeadGeometry } from '../world/props.js';
import { Bins } from './bins.js';

const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);

const GLOW_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aCol;
attribute vec2 aMisc;      // x phase, y kind (0 string bulb, 1 roofline bulb, 2 diya)
uniform vec2 uViewport;
uniform float uRadius;
uniform float uOn;
uniform float uGain;
uniform float uHeritage; // 0..1: roofline strips glow warm white every night, festival or not
uniform float uFxT;
uniform vec4 uFog;
varying vec3 vCol;
varying vec2 vUv;
varying float vA;
varying float vSoft;
void main(){
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float dist = max(-mv.z, 0.05);
  float kind = aMisc.y;
  // kinds: 0 string bulb, 1 roofline bulb, 2 diya, 3 far bazaar glow (a whole lit stretch), 4 far street lamp
  float core = kind < 0.5 ? 0.075 : (kind < 1.5 ? 0.07 : (kind < 2.5 ? 0.045 : (kind < 3.5 ? 1.9 : 0.5)));        // metres
  float pxw = 2.0 * dist / (projectionMatrix[1][1] * uViewport.y);       // world size of one pixel at this depth
  float r = max(core, pxw * 1.5) * 2.7;                                   // quad half size: the halo reaches ~2.7x the core
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = aPos + (right * position.x + up * position.y) * r;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  float d = length(aPos - cameraPosition);
  float fade = 1.0 - smoothstep(0.62 * uRadius, uRadius, d);
  if (kind > 2.5) fade *= smoothstep(60.0, 150.0, d); // far layers only take over where the real lamp meshes and bulbs stop
  float tw = kind > 2.5 ? 0.92 + 0.08 * sin(uFxT * 0.9 + aMisc.x * 40.0) : kind < 1.5 ? 0.80 + 0.20 * sin(uFxT * (1.4 + 2.6 * aMisc.x) + aMisc.x * 61.0)
                        : 0.70 + 0.30 * sin(uFxT * 8.7 + aMisc.x * 90.0) * sin(uFxT * 3.3 + aMisc.x * 31.0);
  // sprites shrink to a sub-pixel dot when far: keep their energy (a dot of fixed brightness) by not letting the quad exceed pixel size
  float energy = clamp(core * 2.7 / r, 0.0, 1.0);
  bool roof = kind > 0.5 && kind < 1.5;
  float on = roof ? max(uOn, uHeritage) : uOn;
  vA = on * fade * tw * (0.35 + 0.65 * energy) * exp(-uFog.x * 2.0 * d);
  // heritage strip lights are warm white; they take their festival colours as the festival fades in
  vCol = (roof ? mix(vec3(1.0, 0.74, 0.40), aCol, clamp(uOn, 0.0, 1.0)) : aCol) * uGain;
  vSoft = kind > 2.5 ? 1.0 : 0.0;
  vUv = position.xy;
}
`;
const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec3 vCol;
varying vec2 vUv;
varying float vA;
varying float vSoft;
void main(){
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  vec3 c;
  if (vSoft > 0.5) {
    // far glow: a soft coloured blob, no hot core
    c = vCol * (exp(-d2 * 5.0) * 0.9 + exp(-d2 * 26.0) * 0.6);
  } else {
    // hot white-ish core (about 1/2.7 of the quad) inside a coloured halo
    float core = exp(-d2 * 55.0);
    float halo = exp(-d2 * 7.0) * 0.16;
    c = vCol * (halo + core * 1.6) + vec3(core * 0.9);
  }
  gl_FragColor = vec4(c * vA, 1.0);
}
`;

export class GlowPoints {
  /** @param {{capacity:number, radius:number, gain?:number}} o */
  constructor(o) {
    this.cap = o.capacity;
    this.radius = o.radius;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(QUAD, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aMisc', this.aMisc);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { ...ENV, uViewport: { value: new THREE.Vector2(1, 1) }, uRadius: { value: o.radius }, uOn: { value: 0 }, uHeritage: { value: 0 }, uGain: { value: o.gain ?? 5.5 } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mat.userData.programKey = 'festival-glow';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.name = 'festival-glow';
    this.mesh.visible = false;
    this.bins = null;
    this.idx = new Int32Array(o.capacity);
    this._gx = 1e9; this._gz = 1e9;
    this.count = 0;
  }

  /** bulbs: Float32Array stride 8 (x, y, z, r, g, b, phase, kind) */
  setData(bulbs) {
    this.data = bulbs;
    this.bins = new Bins(bulbs, 8, 0, 2, 48);
    this._gx = 1e9;
  }

  /** re-gather when the camera moved enough (or forced); returns the number of drawn bulbs */
  gather(x, z, force = false) {
    if (!this.bins) return 0;
    if (!force && Math.hypot(x - this._gx, z - this._gz) < this.radius * 0.2) return this.count;
    this._gx = x; this._gz = z;
    const n = this.bins.nearest(x, z, this.radius, this.cap, this.idx);
    const d = this.data, P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array;
    for (let i = 0; i < n; i++) {
      const k = this.idx[i] * 8;
      P[i * 3] = d[k]; P[i * 3 + 1] = d[k + 1]; P[i * 3 + 2] = d[k + 2];
      C[i * 3] = d[k + 3]; C[i * 3 + 1] = d[k + 4]; C[i * 3 + 2] = d[k + 5];
      M[i * 2] = d[k + 6]; M[i * 2 + 1] = d[k + 7];
    }
    for (const a of [this.aPos, this.aCol, this.aMisc]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    this.mesh.geometry.instanceCount = n;
    this.count = n;
    return n;
  }

  /** per frame: strength 0..1 (festival x night), viewport in pixels */
  setState(on, vw, vh, heritage = 0) {
    this.uniforms.uOn.value = on;
    this.uniforms.uHeritage.value = heritage;
    this.uniforms.uViewport.value.set(vw, vh);
    this.mesh.visible = (on > 0.01 || heritage > 0.01) && this.count > 0;
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** generated street lamps: poles + emissive heads, nearest N around the camera */
export class LampLayer {
  /** @param {{capacity:number, radius:number, hf:{heightAt:(x:number,z:number)=>number}, lighting?:object}} o */
  constructor(o) {
    this.cap = o.capacity;
    this.radius = o.radius;
    this.hf = o.hf;
    this.poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 });
    this.poleMat.userData.programKey = 'festival-pole';
    o.lighting?.setupMaterial(this.poleMat);
    this.headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.4), toneMapped: false });
    this.poles = new THREE.InstancedMesh(makeLampPostGeometry(), this.poleMat, o.capacity);
    this.heads = new THREE.InstancedMesh(makeLampHeadGeometry(), this.headMat, o.capacity);
    for (const m of [this.poles, this.heads]) { m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.poles.receiveShadow = true;
    this.poles.name = 'street-lamps';
    this.heads.name = 'street-lamp-heads';
    this.group = new THREE.Group();
    this.group.name = 'street-lamps';
    this.group.add(this.poles, this.heads);
    this.group.visible = false;
    this.bins = null;
    this.idx = new Int32Array(o.capacity);
    this._gx = 1e9; this._gz = 1e9;
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /** lamps: Float32Array stride 3 (x, z, yaw) */
  setData(lamps) {
    this.data = lamps;
    this.bins = new Bins(lamps, 3, 0, 1, 64);
    this._gx = 1e9;
  }

  gather(x, z, force = false) {
    if (!this.bins) return 0;
    if (!force && Math.hypot(x - this._gx, z - this._gz) < this.radius * 0.2) return this.count;
    this._gx = x; this._gz = z;
    const n = this.bins.nearest(x, z, this.radius, this.cap, this.idx);
    const d = this.data, Y = THREE.Object3D.DEFAULT_UP;
    for (let i = 0; i < n; i++) {
      const k = this.idx[i] * 3;
      this._q.setFromAxisAngle(Y, d[k + 2]);
      this._p.set(d[k], this.hf.heightAt(d[k], d[k + 1]), d[k + 1]);
      this._m.compose(this._p, this._q, this._s);
      this.poles.setMatrixAt(i, this._m);
      this.heads.setMatrixAt(i, this._m);
    }
    for (const m of [this.poles, this.heads]) { m.count = n; m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true; }
    this.count = n;
    return n;
  }

  /** night factor 0..1 controls the head glow (HDR: bloom picks it up) */
  setNight(k) {
    const g = 0.5 + k * 11;
    this.headMat.color.setRGB(g, g * 0.92, g * 0.76);
    this.group.visible = this.count > 0;
  }
}

/** the wires the string bulbs hang on: 6 line segments per span, nearest N spans */
export class SpanWires {
  /** @param {{capacity:number, radius:number}} o */
  constructor(o) {
    this.cap = o.capacity;
    this.radius = o.radius;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(o.capacity * 12 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.LineBasicMaterial({ color: 0x0c0b0a, transparent: true, opacity: 0.85 });
    this.mat.userData.programKey = 'festival-wires';
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'festival-wires';
    this.mesh.visible = false;
    this.bins = null;
    this.idx = new Int32Array(o.capacity);
    this._gx = 1e9; this._gz = 1e9;
    this.count = 0;
  }

  /** spans: stride 8 (x0, y0, z0, x1, y1, z1, sag, theme); binned by their first anchor */
  setData(spans) {
    this.data = spans;
    this.bins = new Bins(spans, 8, 0, 2, 64);
    this._gx = 1e9;
  }

  gather(x, z, force = false) {
    if (!this.bins) return 0;
    if (!force && Math.hypot(x - this._gx, z - this._gz) < this.radius * 0.2) return this.count;
    this._gx = x; this._gz = z;
    const n = this.bins.nearest(x, z, this.radius, this.cap, this.idx);
    const d = this.data, P = this.pos.array;
    let o = 0;
    for (let i = 0; i < n; i++) {
      const k = this.idx[i] * 8, sag = d[k + 6];
      let px = d[k], py = d[k + 1], pz = d[k + 2];
      for (let s = 1; s <= 6; s++) {
        const t = s / 6;
        const qx = d[k] + (d[k + 3] - d[k]) * t, qy = d[k + 1] + (d[k + 4] - d[k + 1]) * t - sag * 4 * t * (1 - t), qz = d[k + 2] + (d[k + 5] - d[k + 2]) * t;
        P[o++] = px; P[o++] = py; P[o++] = pz; P[o++] = qx; P[o++] = qy; P[o++] = qz;
        px = qx; py = qy; pz = qz;
      }
    }
    this.pos.clearUpdateRanges(); this.pos.addUpdateRange(0, o); this.pos.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n * 12);
    this.count = n;
    this.mesh.visible = n > 0;
    return n;
  }
}
