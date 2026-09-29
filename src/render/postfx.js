// HDR post pipeline: scene -> half-float target (MSAA where allowed) -> bloom chain -> composite
// (exposure, tone mapping, vignette, dithering, light FXAA when MSAA is off).
import * as THREE from 'three';

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uKaris;
vec3 fetch(vec2 uv){ return texture2D(tSrc, uv).rgb; }
float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main(){
  vec2 t = uTexel;
  vec3 a = fetch(vUv + t * vec2(-2, 2)), b = fetch(vUv + t * vec2(0, 2)), c = fetch(vUv + t * vec2(2, 2));
  vec3 d = fetch(vUv + t * vec2(-2, 0)), e = fetch(vUv), f = fetch(vUv + t * vec2(2, 0));
  vec3 g = fetch(vUv + t * vec2(-2, -2)), h = fetch(vUv + t * vec2(0, -2)), i = fetch(vUv + t * vec2(2, -2));
  vec3 j = fetch(vUv + t * vec2(-1, 1)), k = fetch(vUv + t * vec2(1, 1)), l = fetch(vUv + t * vec2(-1, -1)), m = fetch(vUv + t * vec2(1, -1));
  vec3 o;
  if (uKaris > 0.5){
    vec3 g0 = (a + b + d + e) * 0.125 * 0.5, g1 = (b + c + e + f) * 0.125 * 0.5, g2 = (d + e + g + h) * 0.125 * 0.5, g3 = (e + f + h + i) * 0.125 * 0.5, g4 = (j + k + l + m) * 0.5 * 0.5;
    o = g0 * kw(g0) + g1 * kw(g1) + g2 * kw(g2) + g3 * kw(g3) + g4 * kw(g4);
    o /= (kw(g0) + kw(g1) + kw(g2) + kw(g3) + kw(g4)) * 0.25 + 1e-4;
    o *= 0.25;
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(o, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main(){
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-t.x, 0)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(t.x, 0)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(0, -t.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(0, t.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform vec2 uTexel;
uniform float uFxaa;
uniform float uVignette;
uniform float uTime;
uniform vec3 uGrade;      // x saturation, y contrast, z warmth
uniform float uFlash;
uniform float uDustGrade; // 0..1: dust storm colour grade (ochre light, lifted shadows)
float hashd(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 fxaa(vec2 uv){
  vec3 c = texture2D(tScene, uv).rgb;
  vec3 n = texture2D(tScene, uv + vec2(0, uTexel.y)).rgb, s = texture2D(tScene, uv - vec2(0, uTexel.y)).rgb;
  vec3 e = texture2D(tScene, uv + vec2(uTexel.x, 0)).rgb, w = texture2D(tScene, uv - vec2(uTexel.x, 0)).rgb;
  float lc = dot(c, vec3(.299,.587,.114)), ln = dot(n, vec3(.299,.587,.114)), ls = dot(s, vec3(.299,.587,.114)), le = dot(e, vec3(.299,.587,.114)), lw = dot(w, vec3(.299,.587,.114));
  // tonemap-space contrast so bright HDR edges are detected
  float mx = max(max(ln, ls), max(max(le, lw), lc)), mn = min(min(ln, ls), min(min(le, lw), lc));
  float k = (mx - mn) / (mx + 0.05);
  if (k < 0.12) return c;
  vec3 avg = (n + s + e + w + c) * 0.2;
  return mix(c, avg, clamp(k * 1.2, 0.0, 0.7));
}
void main(){
  vec3 col = uFxaa > 0.5 ? fxaa(vUv) : texture2D(tScene, vUv).rgb;
  col += texture2D(tBloom, vUv).rgb * uBloom;
  col += vec3(0.55, 0.62, 0.9) * uFlash * 0.02;
  col *= uExposure;
  // grade in linear light (subtle)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uGrade.x);
  col *= vec3(1.0 + 0.05 * uGrade.z, 1.0, 1.0 - 0.06 * uGrade.z);
  col = mix(col, col * vec3(1.18, 0.86, 0.50) + vec3(0.012, 0.006, 0.0) * uDustGrade, uDustGrade);
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // dither to hide banding in dark gradients / sky
  gl_FragColor.rgb += (hashd(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
}
`;

export class PostFX {
  constructor(renderer, settings) {
    this.renderer = renderer;
    this.settings = settings;
    this.scale = 1;
    this.w = 2;
    this.h = 2;
    this.mips = [];
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(TRI, null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.downMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } } });
    this.upMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: UP_FRAG, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } } });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.05 }, uExposure: { value: 1 }, uTexel: { value: new THREE.Vector2() },
        uFxaa: { value: 0 }, uVignette: { value: 0.22 }, uTime: { value: 0 }, uGrade: { value: new THREE.Vector3(1.0, 1, 0) }, uFlash: { value: 0 }, uDustGrade: { value: 0 },
      },
    });
    this.msaa = settings.msaa ?? 0;
    this.bloomOn = settings.bloom;
    this.rt = null;
    this._alloc(2, 2);
  }

  _alloc(w, h) {
    this.rt?.dispose();
    for (const m of this.mips) m.dispose();
    this.mips = [];
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: this.msaa,
      generateMipmaps: false,
    });
    this.rt.texture.name = 'hdr-scene';
    if (this.bloomOn) {
      let mw = w, mh = h;
      for (let i = 0; i < 6; i++) {
        mw = Math.max(2, mw >> 1);
        mh = Math.max(2, mh >> 1);
        this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false }));
      }
    }
    this.w = w;
    this.h = h;
  }

  /** change the MSAA sample count (re-allocates the HDR target); 0 = none, the composite then runs its light FXAA */
  setMsaa(n) {
    if (n === this.msaa) return;
    this.msaa = n;
    this._alloc(this.w, this.h);
  }

  /** set internal render size in device pixels */
  setSize(w, h) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h && this.rt) return;
    this._alloc(w, h);
  }

  get target() {
    return this.rt;
  }

  _pass(mat, target, clear = false) {
    const r = this.renderer;
    this.mesh.material = mat;
    r.setRenderTarget(target);
    if (clear) r.clear();
    r.render(this.scene, this.cam);
  }

  /** After the scene has been rendered into `this.rt`, produce the final canvas image. */
  finish({ exposure, bloom, time, flash = 0, vignette = 0.22, grade, dust = 0 }) {
    const r = this.renderer;
    const prevAuto = r.autoClear;
    r.autoClear = false;
    let bloomTex = this.rt.texture;
    const useBloom = this.bloomOn && bloom > 0.001 && this.mips.length;
    if (useBloom) {
      let src = this.rt.texture;
      let sw = this.w, sh = this.h;
      for (let i = 0; i < this.mips.length; i++) {
        const t = this.mips[i];
        this.downMat.uniforms.tSrc.value = src;
        this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        this.downMat.uniforms.uKaris.value = i === 0 ? 1 : 0;
        this._pass(this.downMat, t, true);
        src = t.texture;
        sw = t.width;
        sh = t.height;
      }
      r.autoClear = false;
      for (let i = this.mips.length - 1; i > 0; i--) {
        const t = this.mips[i - 1];
        this.upMat.uniforms.tSrc.value = this.mips[i].texture;
        this.upMat.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
        this.upMat.uniforms.uRadius.value = 1.0;
        this._pass(this.upMat, t, false);
      }
      bloomTex = this.mips[0].texture;
    }
    const u = this.compMat.uniforms;
    u.tScene.value = this.rt.texture;
    u.tBloom.value = bloomTex;
    u.uBloom.value = useBloom ? bloom : 0;
    u.uExposure.value = exposure;
    u.uTexel.value.set(1 / this.w, 1 / this.h);
    u.uFxaa.value = this.msaa === 0 ? 1 : 0;
    u.uVignette.value = vignette;
    u.uTime.value = time;
    u.uFlash.value = flash;
    u.uDustGrade.value = dust;
    if (grade) u.uGrade.value.set(grade[0], grade[1], grade[2]);
    this._pass(this.compMat, null, true);
    r.autoClear = prevAuto;
  }

  dispose() {
    this.rt?.dispose();
    for (const m of this.mips) m.dispose();
  }
}
