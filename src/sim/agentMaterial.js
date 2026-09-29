// One PBR material per agent kind, patched for instanced street life:
//   per-vertex tag (see agentGeometry.js) + per-instance colour (aColor) and animation (aAnim: x phase, y speed, z brake/rest/perch, w unused)
//   * paint / clothing tint only where the model says so, everything else keeps its own colour
//   * walking legs and swinging arms, folding cow legs when lying, flapping / folded pigeon wings, all on the GPU
//   * headlights (night) and brake lights (braking, plus dim tail lights at night) as emissive HDR so bloom picks them up
import * as THREE from 'three';
import { addEnvUniforms } from '../render/env.js';

const VERT_HEAD = /* glsl */ `
attribute vec4 aTag;
attribute vec3 aColor;
attribute vec4 aAnim;
varying float vLamp;
varying float vBrake;
uniform float uAgentMode; // 0 static, 1 walk, 2 cow, 3 bird
vec2 agentLimb(){
  float limb = aTag.z;
  float a = 0.0;
  if (uAgentMode < 1.5) {
    float al = abs(limb);
    if (al > 0.5 && al < 2.5) a = sin(aAnim.x) * (limb > 0.0 ? 1.0 : -1.0) * (al < 1.5 ? 0.6 : 0.45) * clamp(aAnim.y / 1.2, 0.25, 1.3);
  } else if (uAgentMode > 2.5) {
    if (abs(limb) > 3.5) a = (aAnim.z > 0.5 ? 0.12 : sin(aAnim.x) * 0.95) * (limb > 0.0 ? 1.0 : -1.0);
  }
  return vec2(cos(a), sin(a));
}
`;

export function createAgentMaterial({ mode = 0, key = 'agent', roughness = 0.75, metalness = 0.05 }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  mat.userData.programKey = 'agent-' + key;
  mat.name = 'agent-' + key;
  mat.onBeforeCompile = (shader) => {
    addEnvUniforms(shader);
    shader.uniforms.uAgentMode = { value: mode };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERT_HEAD + 'void main() {')
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        {
          vec2 cs = agentLimb();
          float lm = abs(aTag.z);
          if ((uAgentMode < 1.5 && lm > 0.5 && lm < 2.5)) { objectNormal = vec3(objectNormal.x, objectNormal.y * cs.x - objectNormal.z * cs.y, objectNormal.y * cs.y + objectNormal.z * cs.x); }
          else if (uAgentMode > 2.5 && lm > 3.5) { objectNormal = vec3(objectNormal.x * cs.x - objectNormal.y * cs.y, objectNormal.x * cs.y + objectNormal.y * cs.x, objectNormal.z); }
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec2 cs = agentLimb();
          float lm = abs(aTag.z);
          vec3 p = transformed - vec3(0.0, aTag.w, 0.0);
          if (uAgentMode < 1.5 && lm > 0.5 && lm < 2.5) {
            transformed = vec3(p.x, p.y * cs.x - p.z * cs.y, p.y * cs.y + p.z * cs.x) + vec3(0.0, aTag.w, 0.0);
          } else if (uAgentMode > 1.5 && uAgentMode < 2.5) {
            // cow: lying = legs folded, body dropped
            float rest = aAnim.z;
            if (lm > 2.5) transformed.y *= mix(1.0, 0.28, rest); else transformed.y -= 0.36 * rest;
          } else if (uAgentMode > 2.5 && lm > 3.5) {
            transformed = vec3(p.x * cs.x - p.y * cs.y, p.x * cs.y + p.y * cs.x, p.z) + vec3(0.0, aTag.w, 0.0);
          }
        }`,
      )
      .replace('#include <color_vertex>', '#include <color_vertex>\n vColor.rgb = mix(color.rgb, aColor, aTag.x); vLamp = aTag.y; vBrake = aAnim.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vLamp;\nvarying float vBrake;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        if (vLamp > 0.5) {
          bool tail = vLamp > 1.5;
          float on = tail ? max(vBrake, uNight * 0.7) : uNight;
          totalEmissiveRadiance += (tail ? vec3(1.0, 0.05, 0.03) * 5.0 : vec3(1.0, 0.9, 0.7) * 9.0) * on;
        }`,
      );
  };
  return mat;
}
