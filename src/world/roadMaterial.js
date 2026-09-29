// Road surface shader: worn asphalt with dust edges, patches, cracks, lane markings, paving for pedestrian ways,
// wet gloss with puddles. Built on MeshStandardMaterial (PBR + IBL + shadows + fog stay intact).
import * as THREE from 'three';
import { addEnvUniforms, ENV_DECL } from '../render/env.js';

const VERT_HEAD = /* glsl */ `
attribute vec4 aR;
varying vec4 vRa;
varying vec2 vRuv;
varying vec3 vRwp;
`;
const FRAG_HEAD = /* glsl */ `
${ENV_DECL}
varying vec4 vRa;
varying vec2 vRuv;
varying vec3 vRwp;
uniform sampler2D uReflTex;
uniform mat4 uReflMat;
uniform vec4 uRefl; // x enabled (0..1, ~wetness), y strength, z 1/width, w 1/height
struct RS { vec3 alb; float rough; vec2 bump; float refl; };

// expanding raindrop rings on wet asphalt: two staggered cell layers, returns a horizontal normal offset
vec2 rainRipples(vec2 p, float t, float rain){
  vec2 sum = vec2(0.0);
  for (int k = 0; k < 2; k++){
    vec2 q = p * (1.7 + 0.9 * float(k)) + float(k) * 17.3;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float h = hash12(id);
    float ph = fract(t * (0.85 + 0.5 * h) + h * 7.0);
    vec2 c = (hash22(id + 3.1) - 0.5) * 0.55;
    vec2 dv = f - c;
    float d = length(dv);
    float r = ph * 0.5;
    float ring = sin((d - r) * 46.0) * smoothstep(0.09, 0.0, abs(d - r)) * (1.0 - ph) * (1.0 - ph) * step(h, rain);
    sum += (dv / max(d, 1e-3)) * ring;
  }
  return sum;
}
RS gRS;

void roadShade(vec2 uvr, float cls, float wN, float dist){
  float u = uvr.x, across = uvr.y;
  float W = wN * 32.0;
  float edge = W * 0.5 - abs(across);
  float detail = 1.0 - smoothstep(50.0, 220.0, dist);
  vec2 wp = vRwp.xz;
  vec3 asphalt = vec3(0.058, 0.056, 0.053);
  float n1 = fbm2_3(wp * 0.15);
  float n2 = vnoise(wp * 1.7);
  float n3 = vnoise(wp * 7.0);
  vec3 col = asphalt * (0.75 + 0.6 * n1) * (0.9 + 0.2 * n2);
  // patched repairs: darker fresh asphalt rectangles
  float rpatch = smoothstep(0.62, 0.68, fbm2_3(wp * 0.05 + 3.0));
  col = mix(col, vec3(0.032, 0.031, 0.03), rpatch * 0.7);
  // roadside dust accumulates at the edges
  float dust = 1.0 - smoothstep(0.0, 1.5, edge);
  col = mix(col, vec3(0.20, 0.16, 0.12) * (0.7 + 0.5 * n1), dust * (0.45 + 0.4 * n2));
  // tyre tracks
  float track = smoothstep(0.55, 0.0, abs(abs(across) - W * 0.22) / max(W, 1.0)) * 0.12;
  col *= 1.0 - track;
  // cracks
  float crack = smoothstep(0.012, 0.0, abs(vnoise(wp * 3.1 + n1 * 4.0) - 0.5) * 0.4) * smoothstep(0.4, 0.7, n1);
  col *= 1.0 - crack * 0.16 * detail;
  float rough = 0.88 - 0.12 * n2;
  vec2 bump = vec2(0.0);
  // lane markings on wider roads (tertiary and up)
  if (cls <= 4.5 && W > 6.0 && detail > 0.02) {
    float dash = step(fract(u / 7.0), 0.42);
    float oneway = vRa.z;
    float ln = smoothstep(0.09, 0.05, abs(across));
    vec3 mk = oneway > 0.5 ? vec3(0.55, 0.55, 0.5) : vec3(0.62, 0.52, 0.12);
    col = mix(col, mk * (0.6 + 0.4 * n2), ln * dash * 0.85 * detail);
  }
  // pedestrian ways: paving
  if (cls >= 8.5 && cls < 12.5) {
    vec2 g = fract(wp / 0.42);
    float joint = 1.0 - smoothstep(0.02, 0.06, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
    col = mix(vec3(0.30, 0.24, 0.19), vec3(0.20, 0.17, 0.14), joint * detail) * (0.75 + 0.5 * n1);
    rough = 0.8;
  }
  // wet: darker, glossy, puddles in low spots
  float wet = uWet.x;
  float pud = smoothstep(0.52, 0.62, fbm2_3(wp * 0.11 + 9.0) + 0.03 * n3) * uWet.z;
  col *= 1.0 - 0.45 * wet;
  rough = mix(rough, 0.16, wet * 0.85);
  rough = mix(rough, 0.03, pud);
  col = mix(col, col * 0.7, pud);
  bump = (vec2(n3, vnoise(wp * 7.0 + 21.0)) - 0.5) * 0.25 * detail * (1.0 - pud);
  // raindrop rings on wet ground, strongest in puddles
  float wetK = smoothstep(0.05, 0.6, wet);
  bump += rainRipples(wp, uFxT, uWet.y) * 0.32 * detail * wetK * (0.35 + 0.65 * pud);
  gRS.refl = wetK * (0.3 + 0.7 * pud);
  gRS.alb = col;
  gRS.rough = rough;
  gRS.bump = bump;
}
`;

export function createRoadMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.userData.programKey = 'road';
  // must out-pull EVERY terrain ring: the finest ring uses factor -(rings)*0.6 (about -5), and at street level (grazing angles) the
  // depth slope is huge, so a weak road offset lets the terrain bury the roads
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -12;
  mat.polygonOffsetUnits = -12;
  const extra = { uReflTex: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uRefl: { value: new THREE.Vector4(0, 1.0, 1, 1) } };
  mat.userData.extra = extra;
  mat.onBeforeCompile = (shader) => {
    addEnvUniforms(shader);
    Object.assign(shader.uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERT_HEAD + 'void main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vRa = aR; vRuv = uv; vRwp = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAG_HEAD + 'void main() {')
      .replace('#include <color_fragment>', 'roadShade(vRuv, floor(vRa.x * 16.0 + 0.5), vRa.y, length(vViewPosition));\n diffuseColor.rgb = gRS.alb;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRS.rough;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uRefl.x > 0.001 && gRS.refl > 0.001) {
          vec4 rc = uReflMat * vec4(vRwp, 1.0);
          vec2 ruv = rc.xy / rc.w + gRS.bump * 0.035;
          float blur = mix(0.010, 0.0018, smoothstep(0.03, 0.5, 1.0 - gRS.rough));
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 6; i++) {
            float a = 6.2831853 * (float(i) + 0.37) / 6.0;
            acc += texture2D(uReflTex, ruv + vec2(cos(a), sin(a)) * blur).rgb;
          }
          acc = (acc + texture2D(uReflTex, ruv).rgb * 2.0) / 8.0;
          vec3 V = normalize(cameraPosition - vRwp);
          float fres = 0.025 + 0.975 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
          totalEmissiveRadiance += acc * fres * uRefl.y * uRefl.x * gRS.refl;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(gRS.bump.x, 0.0, gRS.bump.y, 0.0)).xyz * 0.8);`,
      );
  };
  return mat;
}
