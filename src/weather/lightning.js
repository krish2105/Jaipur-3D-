// Lightning: a fractal cloud-to-ground bolt (main channel + branches) drawn as camera-facing ribbons of constant pixel width, HDR-bright so
// bloom gives it a glow, flickering with the weather's multi-stroke flash envelope; and a real directional light so the city lights up.
import * as THREE from 'three';

const QUAD = new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]);

const VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aW;         // x: half-width in px, y: brightness weight
uniform vec2 uViewport;
varying float vAcross;
varying float vW;
void main(){
  vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0), cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
  if (ca.w <= 0.1 || cb.w <= 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = ca.xy / ca.w, sb = cb.xy / cb.w;
  float asp = uViewport.x / uViewport.y;
  vec2 d = (sb - sa) * vec2(asp, 1.0);
  float l = length(d);
  d = l > 1e-6 ? d / l : vec2(0.0, 1.0);
  vec2 perp = vec2(-d.y, d.x) / vec2(asp, 1.0);
  vec4 c = mix(ca, cb, position.y);
  c.xy += perp * position.x * (2.0 * aW.x / uViewport.y) * c.w;
  vAcross = position.x;
  vW = aW.y;
  gl_Position = c;
}
`;
const FRAG = /* glsl */ `
precision highp float;
uniform float uPower;
uniform vec3 uColor;
varying float vAcross;
varying float vW;
void main(){
  float core = pow(max(1.0 - abs(vAcross), 0.0), 2.2);
  gl_FragColor = vec4(uColor * uPower * vW * (0.25 + 1.6 * core), core);
}
`;

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** midpoint-displacement bolt from a to b; returns segments [{a,b,gen}] including branches */
export function makeBolt(a, b, seed, { depth = 6, branchP = 0.32, maxSegs = 420 } = {}) {
  const rnd = mulberry(seed);
  const segs = [];
  const rec = (p, q, d, gen, spread) => {
    if (segs.length >= maxSegs) return;
    if (d === 0) { segs.push({ a: p.clone(), b: q.clone(), gen }); return; }
    const m = p.clone().add(q).multiplyScalar(0.5);
    const dir = q.clone().sub(p);
    const len = dir.length();
    // displace perpendicular to the segment
    const n1 = new THREE.Vector3(-dir.z, 0, dir.x).normalize(), n2 = dir.clone().cross(n1).normalize();
    m.addScaledVector(n1, (rnd() - 0.5) * len * spread).addScaledVector(n2, (rnd() - 0.5) * len * spread * 0.6);
    rec(p, m, d - 1, gen, spread);
    rec(m, q, d - 1, gen, spread);
    if (gen < 2 && d <= depth - 2 && rnd() < branchP) {
      const bd = dir.clone().multiplyScalar(0.5 + rnd() * 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * 1.5);
      bd.y -= len * (0.15 + rnd() * 0.3);
      rec(m, m.clone().add(bd), Math.max(2, d - 2), gen + 1, spread * 1.1);
    }
  };
  rec(a, b, depth, 0, 0.42);
  return segs;
}

export class Lightning {
  constructor(scene) {
    this.max = 520;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(QUAD, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.aW = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    for (const a of [this.aA, this.aB, this.aW]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.aA); g.setAttribute('aB', this.aB); g.setAttribute('aW', this.aW);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;
    this.uniforms = { uViewport: { value: new THREE.Vector2(1, 1) }, uPower: { value: 0 }, uColor: { value: new THREE.Color(0.72, 0.82, 1.0) } };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }); // double sided: the ribbon's winding depends on the segment direction on screen
    this.mat.userData.programKey = 'bolt';
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.name = 'lightning';
    scene.add(this.mesh);
    // the flash light: cold blue-white, from the strike toward the viewer, no shadows
    this.light = new THREE.DirectionalLight(0xb8ccff, 0);
    this.light.castShadow = false;
    scene.add(this.light, this.light.target);
    this.lastId = 0;
    this.active = null; // { id, at: Vector3 }
  }

  _load(bolt, cam) {
    const dx = Math.sin(bolt.bearing) * bolt.dist, dz = -Math.cos(bolt.bearing) * bolt.dist;
    const ground = new THREE.Vector3(cam.position.x + dx, Math.max(0, cam.position.y - 300), cam.position.z + dz);
    const top = ground.clone().add(new THREE.Vector3((Math.sin(bolt.id * 1.7) - 0.5) * 420, 1150 + (bolt.id % 3) * 120, (Math.cos(bolt.id * 2.3)) * 420));
    const segs = makeBolt(top, ground, 1000 + bolt.id * 7919);
    const n = Math.min(segs.length, this.max);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      this.aA.setXYZ(i, s.a.x, s.a.y, s.a.z);
      this.aB.setXYZ(i, s.b.x, s.b.y, s.b.z);
      // main channel wider and brighter than branches; far bolts keep a minimum pixel width so they read
      this.aW.setXY(i, s.gen === 0 ? 1.6 : s.gen === 1 ? 0.9 : 0.6, s.gen === 0 ? 1 : s.gen === 1 ? 0.55 : 0.3);
    }
    this.aA.needsUpdate = this.aB.needsUpdate = this.aW.needsUpdate = true;
    this.geo.instanceCount = n;
    this.active = { id: bolt.id, at: ground };
    this.light.position.copy(ground).add(new THREE.Vector3(0, 900, 0));
  }

  /** call once per frame */
  update(weather, camera, viewportW, viewportH) {
    const bolts = weather.bolts;
    const newest = bolts.length ? bolts[bolts.length - 1] : null;
    if (newest && newest.id !== this.lastId) {
      this.lastId = newest.id;
      this._load(newest, camera);
    }
    const f = weather.flash;
    const show = !!this.active && weather._boltAge < 0.7;
    this.mesh.visible = show;
    this.uniforms.uViewport.value.set(viewportW, viewportH);
    // the visible channel is strongest during the return strokes and fades with the afterglow
    this.uniforms.uPower.value = show ? 14 * Math.min(1, f * 1.35) : 0;
    if (this.active) {
      this.light.target.position.copy(camera.position);
      this.light.target.updateMatrixWorld();
    }
    this.light.intensity = show ? f * 2.4 : 0;
  }
}
