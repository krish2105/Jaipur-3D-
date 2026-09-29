// Fireworks: rockets and shell bursts as GPU-evaluated ballistic streaks (drag + gravity, analytic in the vertex shader), one draw call.
//  * every particle is one instance: origin + birth time, velocity + life, colour + size; a ring buffer of `capacity` particles
//  * position(t) = p0 + v0 e - (g/k)(t - e) with e = (1 - exp(-k t)) / k  (linear drag k, gravity g): sparks slow down and droop, willows hang
//  * each particle is drawn as a screen-space streak between its position now and a moment ago (like the rain streaks), HDR + additive so bloom glows
//  * the show is scheduled deterministically from a seed and the clock; bursts also report themselves (for the light grid, and for audio later)
import * as THREE from 'three';
import { ENV } from '../render/env.js';
import { mulberry32 } from '../core/rng.js';

const QUAD = new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]);

export const FIREWORK_COLORS = [
  [1.0, 0.62, 0.18], [1.0, 0.06, 0.04], [0.1, 1.0, 0.2], [0.12, 0.3, 1.0], [1.0, 0.1, 0.6], [1.0, 0.95, 0.85], [0.4, 0.9, 1.0], [1.0, 0.35, 0.05],
];
export const BURST_KINDS = ['peony', 'chrysanthemum', 'willow', 'ring'];

/** particles of one burst as a flat array (stride 8: vx, vy, vz, life, r, g, b, size). Pure and deterministic for a given rng. */
export function makeBurst(rng, kind, color, count) {
  const out = new Float32Array(count * 8);
  const col2 = FIREWORK_COLORS[Math.floor(rng() * FIREWORK_COLORS.length)];
  // random ring orientation
  const ax = rng() * 2 - 1, ay = rng() * 2 - 1, az = rng() * 2 - 1;
  let nl = Math.hypot(ax, ay, az) || 1;
  const nx = ax / nl, ny = ay / nl, nz = az / nl;
  const ux0 = Math.abs(nx) < 0.9 ? 1 : 0, uy0 = ux0 ? 0 : 1;
  let ux = uy0 * nz, uy = -ux0 * nz, uz = ux0 * ny - uy0 * nx;
  nl = Math.hypot(ux, uy, uz) || 1; ux /= nl; uy /= nl; uz /= nl;
  const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
  for (let i = 0; i < count; i++) {
    let dx, dy, dz, speed, life, size = 1;
    if (kind === 3) { // ring
      const a = (i / count) * Math.PI * 2;
      dx = ux * Math.cos(a) + wx * Math.sin(a); dy = uy * Math.cos(a) + wy * Math.sin(a); dz = uz * Math.cos(a) + wz * Math.sin(a);
      speed = 46 + rng() * 3; life = 2.3 + rng() * 0.3;
    } else {
      // Fibonacci sphere: an even spread, jittered a little
      const y = 1 - (i + 0.5) * (2 / count), r = Math.sqrt(Math.max(0, 1 - y * y)), phi = i * 2.399963 + rng() * 0.15;
      dx = Math.cos(phi) * r; dy = y; dz = Math.sin(phi) * r;
      if (kind === 0) { speed = 44 + rng() * 22; life = 2.2 + rng() * 0.8; }
      else if (kind === 1) { speed = 40 + rng() * 34; life = 2.8 + rng() * 0.8; size = 1.1; }
      else { speed = 28 + rng() * 16; life = 4.2 + rng() * 1.0; size = 0.9; }
    }
    const c = kind === 1 && (i & 1) ? col2 : kind === 2 ? [1.0, 0.62, 0.18] : color;
    out[i * 8] = dx * speed; out[i * 8 + 1] = dy * speed; out[i * 8 + 2] = dz * speed; out[i * 8 + 3] = life;
    out[i * 8 + 4] = c[0]; out[i * 8 + 5] = c[1]; out[i * 8 + 6] = c[2]; out[i * 8 + 7] = size;
  }
  return out;
}

const VERT = /* glsl */ `
attribute vec4 aP0;   // origin xyz, birth time
attribute vec4 aV;    // velocity xyz, life
attribute vec4 aC;    // colour rgb, size (negative: rocket)
uniform float uT;
uniform vec2 uViewport;
uniform vec4 uFog;
varying vec3 vCol;
varying float vAlong;
varying float vAcross;
varying float vA;
vec3 posAt(float t, bool rocket){
  float k = rocket ? 0.12 : 1.35;
  float g = rocket ? 1.5 : 7.5;
  float e = (1.0 - exp(-k * t)) / k;
  vec3 p = aP0.xyz + aV.xyz * e;
  p.y -= (g / k) * (t - e);
  return p;
}
void main(){
  float t = uT - aP0.w;
  float life = aV.w;
  bool rocket = aC.w < 0.0;
  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float trail = rocket ? 0.22 : 0.11 + 0.03 * aC.w;
  vec3 ph = posAt(t, rocket), pt = posAt(max(t - trail, 0.0), rocket);
  vec4 ch = projectionMatrix * viewMatrix * vec4(ph, 1.0), ct = projectionMatrix * viewMatrix * vec4(pt, 1.0);
  if (ch.w <= 0.1 || ct.w <= 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sh = ch.xy / ch.w, st = ct.xy / ct.w;
  float asp = uViewport.x / uViewport.y;
  vec2 d = (sh - st) * vec2(asp, 1.0);
  float l = length(d);
  d = l > 1e-6 ? d / l : vec2(0.0, 1.0);
  // keep streaks at least ~3 px long so distant bursts still read as sparks
  float minLen = 3.0 * 2.0 / uViewport.y;
  vec2 stx = l < minLen ? sh - (d / vec2(asp, 1.0)) * minLen : st;
  vec2 perp = vec2(-d.y, d.x) / vec2(asp, 1.0);
  float e = position.y;
  vec4 c = vec4(mix(sh, stx, e) * ch.w, mix(ch.z, ct.z, e), ch.w);
  float px = 2.0 * (rocket ? 1.4 : 1.1) * abs(aC.w) / uViewport.y;
  c.xy += perp * position.x * px * c.w;
  gl_Position = c;
  float f = 1.0 - t / life;
  float flicker = t > 0.55 * life ? 0.55 + 0.45 * sin(t * 47.0 + aP0.x * 3.1 + aP0.z * 1.7) : 1.0;
  float hot = 1.0 + 2.6 * exp(-t * 9.0);
  float dist = length(ph - cameraPosition);
  vA = pow(max(f, 0.0), 1.4) * flicker * hot * exp(-uFog.x * 1.2 * dist);
  vCol = mix(vec3(1.0, 0.9, 0.7), aC.rgb, smoothstep(0.0, 0.3, t));
  vAlong = e; vAcross = position.x;
}
`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vCol;
varying float vAlong;
varying float vAcross;
varying float vA;
void main(){
  float shape = (1.0 - vAcross * vAcross) * (1.0 - vAlong * 0.85);
  gl_FragColor = vec4(vCol * (9.0 * shape * vA), 1.0);
}
`;

export class Fireworks {
  /** @param {{capacity:number, hf:{heightAt:(x:number,z:number)=>number}, seed?:number}} o */
  constructor(o) {
    this.cap = o.capacity;
    this.hf = o.hf;
    this.rng = mulberry32(o.seed ?? 2611);
    this.time = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(QUAD, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP0 = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(o.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    // everything starts expired
    for (let i = 0; i < o.capacity; i++) { this.aP0.array[i * 4 + 3] = -1e4; this.aV.array[i * 4 + 3] = 0.1; }
    g.setAttribute('aP0', this.aP0); g.setAttribute('aV', this.aV); g.setAttribute('aC', this.aC);
    g.instanceCount = o.capacity;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { uT: { value: 0 }, uViewport: { value: new THREE.Vector2(1, 1) }, uFog: ENV.uFog };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mat.userData.programKey = 'fireworks';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.mesh.name = 'fireworks';
    this.mesh.visible = false;
    this.head = 0;
    this.pending = []; // rockets in flight: { due, x, y, z, kind, color }
    this.bursts = [];  // bursts that have gone off (for lights): { t0, x, y, z, color }
    this.events = [];  // audio events since the last drain: { t, x, y, z, kind }
    this.nextIn = 3;
    this.stats = { bursts: 0, particles: 0 };
    this.density = 0.5;
  }

  _write(i, x, y, z, birth, vx, vy, vz, life, r, g, b, size) {
    const p = this.aP0.array, v = this.aV.array, c = this.aC.array, o = i * 4;
    p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = birth;
    v[o] = vx; v[o + 1] = vy; v[o + 2] = vz; v[o + 3] = life;
    c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = size;
  }

  _flush() {
    for (const a of [this.aP0, this.aV, this.aC]) { a.clearUpdateRanges(); a.needsUpdate = true; }
  }

  /** launch a rocket from (x, z) on the ground that bursts at height h above it after its ascent */
  launch(x, z, h, kind, color, delay = 0) {
    const gy = this.hf.heightAt(x, z);
    const T = 1.9 + h / 220;
    const k = 0.12;
    const v0 = (h * k) / (1 - Math.exp(-k * T));
    const i = this.head; this.head = (this.head + 1) % this.cap;
    this._write(i, x, gy + 2, z, this.time + delay, 0, v0, 0, T, 1.0, 0.75, 0.4, -1);
    this.pending.push({ due: this.time + delay + T, x, y: gy + 2 + h, z, kind, color });
    this._flush();
  }

  /** an immediate burst at a world position (also used by the harness) */
  burst(x, y, z, kind, color) {
    const n = Math.round((kind === 3 ? 90 : kind === 2 ? 130 : kind === 1 ? 200 : 170) * this.scale);
    const b = makeBurst(this.rng, kind, color, n);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.cap;
      this._write(i, x, y, z, this.time, b[k * 8], b[k * 8 + 1], b[k * 8 + 2], b[k * 8 + 3], b[k * 8 + 4], b[k * 8 + 5], b[k * 8 + 6], b[k * 8 + 7]);
    }
    this.bursts.push({ t0: this.time, x, y, z, color });
    this.events.push({ t: this.time, x, y, z, kind });
    this.stats.bursts++; this.stats.particles += n;
    this._flush();
  }

  get scale() { return this.cap >= 4000 ? 1 : this.cap >= 2000 ? 0.7 : 0.45; }

  /**
   * fixed-step update. `hour` IST hours (0..24), `show` 0..1 how much of a show is wanted, camera for placement.
   * Bursts are placed in front of the camera (or all around when the camera looks at the ground).
   */
  update(dt, hour, show, camera) {
    this.time += dt;
    this.uniforms.uT.value = this.time;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.time >= p.due) { this.pending.splice(i, 1); this.burst(p.x, p.y, p.z, p.kind, p.color); }
    }
    while (this.bursts.length && this.time - this.bursts[0].t0 > 3.5) this.bursts.shift();
    if (show <= 0.01) { this.mesh.visible = this.pending.length > 0 || this.bursts.length > 0; return; }
    // the show runs 19:30 - 00:40 IST, densest 20:30 - 23:00
    const h = hour < 5 ? hour + 24 : hour;
    const ramp = Math.min(1, Math.max(0, (h - 19.5) / 1.0)) * Math.min(1, Math.max(0, (24.7 - h) / 1.2));
    this.density = ramp * show;
    if (this.density > 0.02) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        const r = this.rng;
        this.nextIn = (0.7 + r() * 1.8) / this.density;
        const f = new THREE.Vector3(); camera.getWorldDirection(f);
        const az = Math.atan2(f.x, f.z) + (r() - 0.5) * 2.4;
        const dist = 320 + r() * 1200;
        const x = camera.position.x + Math.sin(az) * dist, z = camera.position.z + Math.cos(az) * dist;
        const kind = Math.floor(r() * 4);
        const color = FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)];
        this.launch(x, z, 140 + r() * 150 + dist * 0.06, kind, color);
      }
    }
    this.mesh.visible = true;
  }

  /** light of the live bursts for the light grid: [{x, z, r, g, b, R}] with the flash envelope applied */
  lightSources(out = []) {
    out.length = 0;
    for (const b of this.bursts) {
      const t = this.time - b.t0;
      const e = Math.exp(-t / 0.55) * (1 + 0.6 * Math.sin(t * 31)) * 0.5 + 0.5 * Math.exp(-t / 1.6);
      const k = 0.55 * Math.max(0, e);
      out.push({ x: b.x, z: b.z, r: b.color[0] * k, g: b.color[1] * k, b: b.color[2] * k, R: 260 });
    }
    return out;
  }

  /** take the burst events raised since the last call (audio) */
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  setViewport(w, h) { this.uniforms.uViewport.value.set(w, h); }

  clear() {
    for (let i = 0; i < this.cap; i++) { this.aP0.array[i * 4 + 3] = -1e4; this.aV.array[i * 4 + 3] = 0.1; }
    this.pending.length = 0; this.bursts.length = 0; this.events.length = 0;
    this._flush();
    this.mesh.visible = false;
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
