// Procedural facade / roof shading for extruded buildings, in real metres.
// Built on MeshStandardMaterial so PBR lighting, IBL, CSM shadows and aerial-perspective fog all still apply.
import * as THREE from 'three';
import { addEnvUniforms, ENV_DECL } from '../render/env.js';

export const BUILDING_UNIFORMS = {
  uShopOpen: { value: 1 },
  uBldTime: { value: 0 },
  // Walled City box in world metres (x0, z0, x1, z1); zero = none. Inside it the wall palette is clamped to terracotta pink: a law of 1877 requires the
  // old city's buildings to be painted pink (docs/LANDMARK_FACTS.md). Outside, and in the lab, the full palette (whites, ochres, limes) applies.
  uWalled: { value: new THREE.Vector4(0, 0, 0, 0) },
};

const VERT_HEAD = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
varying vec4 vFA;
varying vec4 vFB;
varying vec2 vFUV;
varying vec3 vFN;
varying vec3 vFP;
varying vec2 vFW;
`;

const FRAG_HEAD = /* glsl */ `
${ENV_DECL}
uniform float uShopOpen;
uniform vec4 uWalled;
varying vec2 vFW;
varying vec4 vFA;
varying vec4 vFB;
varying vec2 vFUV;
varying vec3 vFN;
varying vec3 vFP;

struct FS { vec3 alb; float rough; vec3 emit; vec2 bump; float ao; };
FS gFS;

float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// opening with round or pointed (cusped) arch head; base at y = 0, centred on x = 0
float sdArch(vec2 p, float w, float h, float pointed){
  float r = w * 0.5;
  float hs = max(h - r * mix(1.0, 1.41421356, pointed), 0.02); // pointed arch apex sits at exactly h
  float dRect = sdBox2(p - vec2(0.0, hs * 0.5), vec2(r, hs * 0.5));
  float dCirc = length(p - vec2(0.0, hs)) - r;
  float dPt = max(length(p - vec2(0.5 * r, hs)) - 1.5 * r, length(p - vec2(-0.5 * r, hs)) - 1.5 * r);
  float dTop = mix(dCirc, dPt, pointed);
  return p.y > hs ? dTop : dRect;
}
vec3 wallPalette(float s, float s2){
  // hue moved from rose toward terracotta after the photo comparison (real Walled City walls read orange-terracotta, about sRGB #C9714F sunlit)
  vec3 salmon = vec3(0.56, 0.185, 0.10);
  vec3 rose   = vec3(0.42, 0.125, 0.07);
  vec3 ochre  = vec3(0.50, 0.285, 0.135);
  vec3 lime   = vec3(0.62, 0.42, 0.33);
  vec3 cream  = vec3(0.66, 0.53, 0.38);
  vec3 grey   = vec3(0.24, 0.225, 0.21);
  vec3 c = mix(salmon, rose, smoothstep(0.15, 0.75, s2));
  c = mix(c, lime, smoothstep(0.42, 0.5, s) * (1.0 - smoothstep(0.62, 0.7, s)));
  c = mix(c, ochre, smoothstep(0.70, 0.76, s) * (1.0 - smoothstep(0.84, 0.88, s)));
  c = mix(c, cream, smoothstep(0.86, 0.90, s) * (1.0 - smoothstep(0.945, 0.96, s)));
  c = mix(c, grey, smoothstep(0.945, 0.965, s));
  return c;
}
// 1 inside the Walled City (soft 60 m edge), 0 outside: pulls the palette selector toward the pink end
float walledK(){
  if (uWalled.z <= uWalled.x) return 0.0;
  vec2 d = min(vFW - uWalled.xy, uWalled.zw - vFW);
  return smoothstep(0.0, 60.0, min(d.x, d.y));
}
vec3 signColor(float h){
  if (h < 0.16) return vec3(0.42, 0.30, 0.04);
  if (h < 0.32) return vec3(0.035, 0.08, 0.28);
  if (h < 0.48) return vec3(0.34, 0.045, 0.04);
  if (h < 0.64) return vec3(0.46, 0.43, 0.36);
  if (h < 0.80) return vec3(0.05, 0.20, 0.08);
  return vec3(0.30, 0.14, 0.03);
}

// Wall facade in wall-local metres (u along, v above base)
void facadeWall(vec2 uvw, float L, float H, float seedA, float seedB, float cls, float flags, float dist){
  float u = uvw.x, v = uvw.y;
  bool face = mod(floor(flags / 1.0), 2.0) > 0.5;
  bool bazaar = mod(floor(flags / 2.0), 2.0) > 0.5;
  bool heritage = mod(floor(flags / 4.0), 2.0) > 0.5;
  bool shop = face && (bazaar ? cls != 2.0 : (cls == 1.0 || (cls == 7.0 && seedA > 0.35) || (cls == 0.0 && seedA > 0.8)));
  float storeyH = mix(3.15, 3.7, seedB);
  float groundH = shop ? mix(3.8, 4.6, seedA) : storeyH;
  float nBay = max(1.0, floor(L / mix(2.7, 3.5, seedA) + 0.5));
  float bayW = L / nBay;
  float bi = floor(u / bayW);
  float bx = u - (bi + 0.5) * bayW;
  bool ground = v < groundH;
  float floorIdx = ground ? 0.0 : floor((v - groundH) / storeyH) + 1.0;
  float fv = ground ? v : v - groundH - (floorIdx - 1.0) * storeyH;
  float detail = 1.0 - smoothstep(40.0, 170.0, dist);

  // ---- plaster
  vec3 base = wallPalette(seedA * (1.0 - 0.88 * walledK()), seedB);
  base *= 0.86 + 0.28 * hash12(vec2(seedA * 131.0 + floorIdx, floorIdx * 7.0 + seedB * 3.0));
  float n1 = fbm2_3(vec2(u, v) * 0.33 + seedB * 40.0);
  float n2 = vnoise(vec2(u, v) * 2.9 + seedA * 20.0);
  float wear = smoothstep(0.36, 0.8, n1);
  vec3 faded = mix(base, vec3(0.60, 0.40, 0.28), 0.55);
  vec3 col = mix(base, faded, wear * 0.65);
  float patchN = fbm2_3(vec2(u, v) * 0.85 + seedA * 13.0) + (1.0 - smoothstep(0.0, 2.2, v)) * 0.2;
  col = mix(col, vec3(0.24, 0.085, 0.055), smoothstep(0.66, 0.78, patchN) * 0.7 * detail);
  float soot = (1.0 - smoothstep(0.0, 2.8, v)) * 0.5 + smoothstep(H - 1.4, H, v) * 0.22;
  float streak = smoothstep(0.55, 0.92, vnoise(vec2(u * 2.6, v * 0.11) + seedB * 30.0));
  col *= 1.0 - clamp(soot * (0.55 + 0.45 * n1) + streak * 0.2 * detail, 0.0, 0.7);
  float plinth = 1.0 - smoothstep(0.7, 0.85, v);
  col = mix(col, vec3(0.34, 0.22, 0.16) * (0.75 + 0.5 * n2), plinth * (shop ? 0.9 : 0.55));
  float rough = 0.92 - 0.1 * n1;

  // ---- openings
  vec3 trim = vec3(0.74, 0.62, 0.47) * (0.85 + 0.2 * n2);
  float sd = 1e3;
  vec3 interior = vec3(0.012, 0.011, 0.011);
  float openKind = 0.0; // 1 window, 2 shop arch, 3 door
  float emitAmt = 0.0;
  vec3 emitCol = vec3(1.0, 0.62, 0.28);
  float hb = hash12(vec2(bi + seedA * 91.0, floorIdx + seedB * 37.0));
  float hb2 = hash12(vec2(bi * 1.7 + seedB * 53.0, floorIdx * 3.1 + 5.0));
  float topLimit = H - 0.05;
  if (v < topLimit) {
    if (ground && shop) {
      float aw = bayW * 0.82, ah = groundH * 0.80;
      sd = sdArch(vec2(bx, v - 0.12), aw, ah, 1.0);
      openKind = 2.0;
    } else if (ground) {
      if (hb < 0.24) { sd = sdArch(vec2(bx, v), 1.05, 2.1, 0.0); openKind = 3.0; }
      else if (hb < 0.85) { sd = sdArch(vec2(bx, v - 1.05), 0.8, 1.05, 0.0); openKind = 1.0; }
    } else if (hb2 > 0.08) {
      float ww = min(bayW * 0.46, 1.05) * (0.9 + 0.2 * hb);
      float wh = 1.35 + 0.35 * hb2;
      sd = sdArch(vec2(bx, fv - 0.85), ww, wh, heritage || bazaar ? 1.0 : (hb > 0.5 ? 1.0 : 0.0));
      openKind = 1.0;
    }
  }
  float aa = fwidth(sd) * 1.3 + 1e-3;
  float inside = (openKind > 0.0) ? 1.0 - smoothstep(-aa, aa, sd) : 0.0;
  inside *= mix(0.35, 1.0, detail);
  float frameW = openKind == 2.0 ? 0.13 : 0.085;
  float frame = (openKind > 0.0) ? smoothstep(-aa, aa, sd) * (1.0 - smoothstep(frameW - aa, frameW + aa, sd)) : 0.0;
  frame *= detail;
  col = mix(col, trim, frame * 0.92);
  // contact shading around openings
  float edgeAo = (openKind > 0.0) ? 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.5, sd)) * detail : 1.0;

  // shop interior: goods speckle / shutters
  bool open = hash12(vec2(bi + seedA * 17.0, 3.0 + seedB * 5.0)) < uShopOpen;
  if (openKind == 2.0) {
    if (open) {
      // dim shop interior: warm back wall, a few shelves of muted goods; depth gradient toward the top
      float gd = vnoise(vec2(bx * 2.1 + bi * 3.0, v * 2.3) + seedA * 20.0);
      vec3 goods = mix(vec3(0.07, 0.04, 0.025), signColor(fract(gd * 3.7 + seedB)) * 0.10, 0.5);
      float shelf = smoothstep(0.35, 0.6, fract(v * 1.3)) * (1.0 - smoothstep(0.85, 1.0, v / groundH));
      interior = mix(vec3(0.020, 0.015, 0.012), goods, 0.55 * shelf);
      interior *= 0.55 + 0.45 * (1.0 - v / groundH);
      emitAmt = 0.16 * uNight * step(0.12, hash12(vec2(bi, seedA * 71.0)));
      emitCol = mix(vec3(1.0, 0.72, 0.36), vec3(0.85, 0.95, 1.0), step(0.75, hb2));
    } else {
      float slat = 0.5 + 0.5 * sin(v * 60.0);
      interior = vec3(0.12, 0.125, 0.135) * (0.85 + 0.15 * slat);
      rough = 0.45;
    }
  } else if (openKind == 1.0) {
    float lit = step(hb, uNight * (0.28 + 0.4 * uFestival) * (0.5 + 0.5 * hb2));
    emitAmt = 0.085 * lit;
    emitCol = mix(vec3(1.0, 0.6, 0.25), vec3(0.95, 0.85, 0.6), step(0.7, hb2));
    // window shutters/curtains: subtle colour variation daytime
    interior = mix(vec3(0.014, 0.012, 0.012), vec3(0.05, 0.03, 0.02), step(0.6, hb));
    // jaali lattice on heritage bays
    if (heritage) interior *= 0.5 + 0.5 * step(0.45, abs(sin((bx + fv) * 32.0) * sin((bx - fv) * 32.0)));
  } else if (openKind == 3.0) {
    interior = vec3(0.045, 0.022, 0.012) * (0.7 + 0.6 * step(0.5, fract(bx * 7.0)));
  }
  col = mix(col, interior, inside);
  float roughOpen = openKind == 1.0 ? 0.12 : 0.55;
  rough = mix(rough, roughOpen, inside * (openKind == 2.0 && !open ? 0.0 : 1.0));
  vec3 emit = emitCol * emitAmt * inside;

  // ---- shop signboard band + awning colour
  if (shop && ground && v > groundH * 0.80 + 0.22 && v < groundH - 0.14 && detail > 0.05) {
    float sh = hash12(vec2(bi + seedA * 23.0, 9.0));
    vec3 sc = signColor(sh);
    float lettering = step(0.55, vnoise(vec2(u * 6.0, v * 22.0) + sh * 100.0));
    col = mix(col, sc * (0.55 + 0.45 * lettering) * (0.8 + 0.4 * n2), 0.9 * detail);
    rough = 0.7;
    emit += sc * 0.05 * uNight * detail;
  }

  // ---- mouldings: string course above ground floor and under the parapet
  float slab = (ground ? 1e3 : abs(fv));
  float sc = (1.0 - smoothstep(0.03, 0.09, slab)) * detail;
  col = mix(col, trim * 0.85, sc * 0.55);
  float corn = smoothstep(H - 0.42, H - 0.38, v) * (1.0 - smoothstep(H - 0.02, H + 0.02, v));
  col = mix(col, trim, corn * 0.8);
  if (v > H) {
    // parapet outer face: lighter cap
    col = mix(col, trim * 0.9, 0.5);
  }
  // wall base above ground-floor arcade gets a shade line (chhajja) on bazaar frontages
  if (shop && !ground) col *= 0.72 + 0.28 * smoothstep(0.0, 0.55, fv);

  // wet street splash: darker, glossier low walls; rain streaks
  float wetK = uWet.x;
  col *= 1.0 - wetK * 0.22 * (1.0 - smoothstep(0.0, 3.0, v)) - wetK * 0.1;
  rough = mix(rough, 0.5, wetK * 0.6);

  // far-distance: fade window contrast toward mean tone (prevents moire)
  col = mix(col * 0.82, col, detail * 0.6 + 0.4);

  gFS.alb = col;
  gFS.rough = clamp(rough, 0.04, 1.0);
  gFS.emit = emit;
  gFS.ao = edgeAo;

  // bump: recess normals around openings (finite difference of the SDF in wall space)
  vec2 g = vec2(0.0);
  if (openKind > 0.0 && detail > 0.05) {
    float e = 0.035;
    vec2 pp = vec2(bx, openKind == 2.0 ? v - 0.12 : (ground ? (openKind == 3.0 ? v : v - 1.05) : fv - 0.85));
    float ww = openKind == 2.0 ? bayW * 0.82 : (openKind == 3.0 ? 1.05 : 0.8);
    float hh = openKind == 2.0 ? groundH * 0.80 : (openKind == 3.0 ? 2.1 : 1.05);
    if (!ground) { ww = min(bayW * 0.46, 1.05) * (0.9 + 0.2 * hb); hh = 1.35 + 0.35 * hb2; }
    float pt = openKind == 2.0 ? 1.0 : 0.0;
    if (!ground) pt = (heritage || bazaar) ? 1.0 : (hb > 0.5 ? 1.0 : 0.0);
    float dx = sdArch(pp + vec2(e, 0.0), ww, hh, pt) - sdArch(pp - vec2(e, 0.0), ww, hh, pt);
    float dy = sdArch(pp + vec2(0.0, e), ww, hh, pt) - sdArch(pp - vec2(0.0, e), ww, hh, pt);
    float ring = (1.0 - smoothstep(0.0, 0.12, abs(sd - 0.02)));
    g = -vec2(dx, dy) / (2.0 * e) * ring * 0.9 * detail;
  }
  // plaster micro-bump
  g += (vec2(vnoise(vec2(u, v) * 9.0), vnoise(vec2(u, v) * 9.0 + 17.0)) - 0.5) * 0.10 * detail;
  gFS.bump = g;
}

void facadeRoof(vec2 xz, float seedA, float seedB, float cls, float kind, float w4, float dist){
  float detail = 1.0 - smoothstep(60.0, 260.0, dist);
  vec3 tone = mix(vec3(0.30, 0.27, 0.235), vec3(0.42, 0.235, 0.185), step(seedA, 0.3));
  tone = mix(tone, vec3(0.5, 0.47, 0.42), step(0.86, seedB));
  float n = fbm2_3(xz * 0.4 + seedA * 30.0);
  float stain = smoothstep(0.55, 0.85, vnoise(xz * 1.3 + seedB * 9.0));
  vec3 col = tone * (0.8 + 0.4 * n);
  col = mix(col, col * 0.55, stain * 0.5 * detail);
  float joint = (1.0 - smoothstep(0.02, 0.06, abs(fract(xz.x / 2.6) - 0.5) - 0.44)) * 0.0; // reserved
  col *= 1.0 - joint;
  float rough = 0.9;
  // puddled roofs when wet
  float puddle = smoothstep(0.5, 0.7, fbm2_3(xz * 0.22 + seedA * 7.0)) * uWet.z;
  col *= 1.0 - 0.4 * puddle - 0.15 * uWet.x;
  rough = mix(rough, 0.05, puddle);
  gFS.alb = col;
  gFS.rough = rough;
  gFS.emit = vec3(0.0);
  gFS.bump = (vec2(vnoise(xz * 5.0), vnoise(xz * 5.0 + 9.0)) - 0.5) * 0.08 * detail;
  gFS.ao = 1.0;
}

void facadeOther(vec2 uvw, vec2 xz, float seedA, float seedB, float cls, float kind, float w4, float dist){
  // parapet cap / inner face / clutter / cornice / pitched
  vec3 base = wallPalette(seedA * (1.0 - 0.88 * walledK()), seedB);
  float n = fbm2_3(xz * 0.8 + seedA * 20.0);
  vec3 col = base * (0.8 + 0.4 * n);
  float rough = 0.9;
  if (kind < 2.5) { col = vec3(0.50, 0.42, 0.34) * (0.85 + 0.3 * n); }               // parapet cap stone
  else if (kind < 3.5) { col = mix(base, vec3(0.3, 0.27, 0.24), 0.45) * (0.8 + 0.4 * n); } // parapet inner
  else if (kind > 4.5 && kind < 5.5) {                                             // clutter
    if (w4 > 0.93) { col = vec3(0.022, 0.026, 0.038); rough = 0.35; }                // black water tank
    else { col = base * 0.9 * (0.8 + 0.4 * n); }                                    // mumty
  } else if (kind > 5.5 && kind < 6.5) { col = vec3(0.72, 0.6, 0.45) * (0.85 + 0.2 * n); } // cornice
  else if (kind > 6.5) {                                                          // pitched / dome
    col = cls == 2.0 ? vec3(0.62, 0.55, 0.46) * (0.85 + 0.2 * n) : vec3(0.27, 0.095, 0.065) * (0.75 + 0.5 * n);
    rough = 0.7;
  }
  col *= 1.0 - 0.12 * uWet.x;
  gFS.alb = col; gFS.rough = rough; gFS.emit = vec3(0.0); gFS.bump = vec2(0.0); gFS.ao = 1.0;
}
`;

export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.userData.programKey = 'building';
  mat.onBeforeCompile = (shader) => {
    addEnvUniforms(shader);
    Object.assign(shader.uniforms, BUILDING_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERT_HEAD + 'void main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFA = aA; vFB = aB; vFUV = uv; vFN = normal; vFP = position; vFW = (modelMatrix * vec4(position, 1.0)).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAG_HEAD + 'void main() {')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        {
          float fKind = floor(vFA.z * 16.0 + 0.5);
          float fCls = floor(vFA.w * 16.0 + 0.5);
          float fDist = length(vViewPosition);
          if (fKind < 0.5) {
            facadeWall(vFUV, vFB.y * 256.0, vFB.x * 128.0, vFA.x, vFA.y, fCls, floor(vFB.w * 255.0 + 0.5), fDist);
          } else if (fKind < 1.5) {
            facadeRoof(vFUV, vFA.x, vFA.y, fCls, fKind, vFA.w, fDist);
          } else {
            facadeOther(vFUV, vFP.xz, vFA.x, vFA.y, fCls, fKind, vFA.w, fDist);
          }
          diffuseColor.rgb = gFS.alb;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gFS.rough;')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 Nw = normalize(vFN);
          vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw));
          vec3 Bw = vec3(0.0, 1.0, 0.0);
          if (abs(Nw.y) > 0.5) { Tw = vec3(1.0, 0.0, 0.0); Bw = vec3(0.0, 0.0, 1.0); }
          vec3 pv = (viewMatrix * vec4(Tw * gFS.bump.x + Bw * gFS.bump.y, 0.0)).xyz;
          normal = normalize(normal + pv * 0.6);
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += gFS.emit;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= gFS.ao;');
  };
  return mat;
}

/** Attribute names/normalisation used by tile meshes. */
export function makeTileGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nrm, 4, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  geo.setAttribute('aA', new THREE.BufferAttribute(g.a1, 4, true));
  geo.setAttribute('aB', new THREE.BufferAttribute(g.a2, 4, true));
  geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
