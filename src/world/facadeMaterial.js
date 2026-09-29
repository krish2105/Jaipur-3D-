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
  if (pointed > 1.5) return sdBox2(p - vec2(0.0, h * 0.5), vec2(w * 0.5 - 0.02, h * 0.5 - 0.02)) - 0.02; // pointed = 2: rectangular opening with a slightly eased corner
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
  float openKind = 0.0; // 1 window, 2 shop opening, 3 door, 4 shuttered window (road-facing upper floors)
  float emitAmt = 0.0;
  vec3 emitCol = vec3(1.0, 0.62, 0.28);
  float hb = hash12(vec2(bi + seedA * 91.0, floorIdx + seedB * 37.0));
  float hb2 = hash12(vec2(bi * 1.7 + seedB * 53.0, floorIdx * 3.1 + 5.0));
  float topLimit = H - 0.05;
  // opening shape in local metres (kept for the bump pass): centre-bottom position, width, height, arch kind (0 round, 1 pointed, 2 rectangular)
  vec2 opP = vec2(0.0);
  float opW = 1.0, opH = 1.0, opPt = 0.0;
  // pillared shop frontage (photos: square pillars, a white signboard fascia, a projecting chhajja): layout of the ground floor
  float signH = mix(0.72, 0.98, seedB);
  float chhajjaH = 0.30;
  float openTop = groundH - chhajjaH - 0.12 - signH;
  float pillarW = 0.44;
  float wCol = 1.0;   // window column inside the bay (road-facing upper floors)
  float winX = 0.0;
  if (v < topLimit) {
    if (ground && shop) {
      opP = vec2(bx, v - 0.10); opW = bayW - pillarW; opH = openTop - 0.10; opPt = 2.0;
      sd = sdArch(opP, opW, opH, opPt);
      openKind = 2.0;
    } else if (ground) {
      if (hb < 0.24) { opP = vec2(bx, v); opW = 1.05; opH = 2.1; opPt = 0.0; sd = sdArch(opP, opW, opH, opPt); openKind = 3.0; }
      else if (hb < 0.85) { opP = vec2(bx, v - 1.05); opW = 0.8; opH = 1.05; opPt = 0.0; sd = sdArch(opP, opW, opH, opPt); openKind = 1.0; }
    } else if (hb2 > 0.08) {
      if (face && !heritage) {
        // road-facing upper floors: two (three in a wide bay) tall louvre-shuttered windows per bay, rectangular, with a sill
        float nW = bayW > 3.25 ? 3.0 : 2.0;
        float cw = bayW / nW;
        float cx = bx + bayW * 0.5;
        wCol = floor(cx / cw);
        winX = cx - (wCol + 0.5) * cw;
        opP = vec2(winX, fv - 0.62); opW = cw * 0.60; opH = 1.55 + 0.45 * hb2; opPt = 2.0;
        sd = sdArch(opP, opW, opH, opPt);
        openKind = 4.0;
      } else {
        float ww = min(bayW * 0.46, 1.05) * (0.9 + 0.2 * hb);
        float wh = 1.35 + 0.35 * hb2;
        opP = vec2(bx, fv - 0.85); opW = ww; opH = wh; opPt = heritage || bazaar ? 1.0 : (hb > 0.5 ? 1.0 : 0.0);
        sd = sdArch(opP, opW, opH, opPt);
        openKind = 1.0;
      }
    }
  }
  float aa = fwidth(sd) * 1.3 + 1e-3;
  float inside = (openKind > 0.0) ? 1.0 - smoothstep(-aa, aa, sd) : 0.0;
  inside *= mix(0.35, 1.0, detail);
  float frameW = openKind == 2.0 ? 0.07 : (openKind == 4.0 ? 0.075 : 0.085);
  float frame = (openKind > 0.0) ? smoothstep(-aa, aa, sd) * (1.0 - smoothstep(frameW - aa, frameW + aa, sd)) : 0.0;
  frame *= detail;
  col = mix(col, trim, frame * 0.92);
  // contact shading around openings
  float edgeAo = (openKind > 0.0) ? 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.5, sd)) * detail : 1.0;

  // shop interior: goods speckle / shutters
  bool open = hash12(vec2(bi + seedA * 17.0, 3.0 + seedB * 5.0)) < uShopOpen;
  if (openKind == 2.0) {
    if (open) {
      // dim shop interior: shelves of small goods (bolts of cloth, brass, sacks) in saturated muted colours, a counter at the bottom, darker toward the ceiling
      vec2 gc = vec2(bx * 6.8 + bi * 7.0, v * 4.6);
      vec2 cid = floor(gc), cf = fract(gc);
      float present = step(0.30, hash12(cid + seedA * 31.0));
      float item = present * smoothstep(0.05, 0.13, cf.x) * (1.0 - smoothstep(0.87, 0.95, cf.x)) * smoothstep(0.07, 0.15, cf.y) * (1.0 - smoothstep(0.58, 0.68, cf.y));
      vec3 gcol = signColor(fract(hash12(cid * 1.3 + seedB * 9.0) * 3.7)) * (0.20 + 0.30 * hash12(cid + 3.0)) * (0.75 + 0.5 * vnoise(gc * 4.0));
      float board = (1.0 - smoothstep(0.0, 0.03, abs(cf.y - 0.03))) * 0.5;
      float depthK = 0.35 + 0.65 * (1.0 - v / groundH);
      interior = mix(vec3(0.020, 0.015, 0.012), gcol, item * 0.9) * depthK + vec3(0.06, 0.04, 0.025) * board * depthK;
      float counter = smoothstep(0.78, 0.84, v) * (1.0 - smoothstep(0.95, 1.0, v));
      interior = mix(interior, vec3(0.20, 0.15, 0.10), counter * 0.8);
      emitAmt = 0.105 * uNight * step(0.12, hash12(vec2(bi, seedA * 71.0))) * (0.55 + 0.9 * item); // the goods glow, the gaps between them stay dim
      emitCol = mix(vec3(1.0, 0.72, 0.36), vec3(0.85, 0.95, 1.0), step(0.75, hb2));
    } else {
      float slat = 0.5 + 0.5 * sin(v * 60.0);
      interior = vec3(0.12, 0.125, 0.135) * (0.85 + 0.15 * slat);
      rough = 0.45;
    }
  } else if (openKind == 1.0 || openKind == 4.0) {
    float lit = step(hb, uNight * (0.28 + 0.4 * uFestival) * (0.5 + 0.5 * hb2));
    emitAmt = 0.085 * lit;
    emitCol = mix(vec3(1.0, 0.6, 0.25), vec3(0.95, 0.85, 0.6), step(0.7, hb2));
    // window shutters/curtains: subtle colour variation daytime
    interior = mix(vec3(0.014, 0.012, 0.012), vec3(0.05, 0.03, 0.02), step(0.6, hb));
    // jaali lattice on heritage bays
    if (heritage && openKind == 1.0) interior *= 0.5 + 0.5 * step(0.45, abs(sin((bx + fv) * 32.0) * sin((bx - fv) * 32.0)));
    if (openKind == 4.0) {
      // two louvred leaves (cream-grey, green-grey or brown); about a third stand open on a dark room
      float hw = hash12(vec2(bi * 3.7 + wCol * 11.0 + seedA * 29.0, floorIdx + 2.0));
      vec3 leaf = hw < 0.5 ? vec3(0.34, 0.30, 0.24) : (hw < 0.8 ? vec3(0.085, 0.13, 0.095) : vec3(0.13, 0.065, 0.04));
      float slats = 0.62 + 0.38 * smoothstep(0.25, 0.75, abs(fract((fv - 0.62) * 17.0) - 0.5) * 2.0);
      float mid = 1.0 - 0.7 * (1.0 - smoothstep(0.0, 0.03, abs(winX)));
      vec3 shut = leaf * slats * mid;
      float openLeaf = step(0.68, hash12(vec2(bi * 5.3 + wCol * 3.0 + seedB * 17.0, floorIdx * 9.0)));
      float side = step(0.0, winX * (hb - 0.5)); // an open window has one leaf swung back
      interior = mix(shut, interior, openLeaf * side);
      emitAmt *= 0.5 + 0.5 * openLeaf;
      rough = 0.55;
    }
  } else if (openKind == 3.0) {
    interior = vec3(0.045, 0.022, 0.012) * (0.7 + 0.6 * step(0.5, fract(bx * 7.0)));
  }
  col = mix(col, interior, inside);
  float roughOpen = openKind == 1.0 ? 0.12 : 0.55;
  rough = mix(rough, roughOpen, inside * (openKind == 2.0 && !open ? 0.0 : 1.0));
  vec3 emit = emitCol * emitAmt * inside;

  // ---- pillars, signboard fascia, awnings and chhajja of a shop frontage
  if (shop && ground && detail > 0.02) {
    // square pillar on every bay boundary: plinth, shaft, capital that widens under the fascia
    float pw = pillarW * (1.0 + 0.30 * (1.0 - smoothstep(0.0, 0.45, v)) + 0.45 * smoothstep(openTop - 0.34, openTop - 0.08, v));
    float pAa = fwidth(bx) * 1.2 + 1e-3;
    float pMask = smoothstep(bayW * 0.5 - pw * 0.5 - pAa, bayW * 0.5 - pw * 0.5 + pAa, abs(bx)) * (1.0 - smoothstep(openTop + 0.02, openTop + 0.05, v));
    vec3 pillarCol = mix(base * 1.10, vec3(0.80, 0.66, 0.50), 0.50) * (0.88 + 0.16 * n2);
    float pShade = 0.78 + 0.22 * smoothstep(0.0, pw * 0.5, bayW * 0.5 - abs(bx)); // rounded-looking edge falloff
    pillarCol *= pShade * (1.0 - 0.25 * soot);
    col = mix(col, pillarCol, pMask * detail);
    inside *= 1.0 - pMask;
    emit *= 1.0 - pMask;
    rough = mix(rough, 0.92, pMask);
    // fascia beam and the boards on it
    float sbBot = openTop + 0.12, sbTop = sbBot + signH;
    float beam = smoothstep(openTop - 0.01, openTop + 0.01, v) * (1.0 - smoothstep(sbBot - 0.02, sbBot, v));
    col = mix(col, trim * 0.92, beam * detail);
    float board = smoothstep(sbBot - 0.01, sbBot + 0.01, v) * (1.0 - smoothstep(sbTop - 0.01, sbTop + 0.01, v)) * (1.0 - smoothstep(bayW * 0.5 - 0.10, bayW * 0.5 - 0.07, abs(bx)));
    float sh = hash12(vec2(bi + seedA * 23.0, 9.0));
    vec3 boardCol = sh < 0.56 ? vec3(0.74, 0.72, 0.66) : signColor(fract(sh * 7.13));
    bool lightBoard = sh < 0.56 || (sh >= 0.56 && fract(sh * 7.13) > 0.47 && fract(sh * 7.13) < 0.64);
    // two rows of lettering: dashes of glyph-sized blocks with gaps between words (a texture, not real words)
    float rows = signH > 0.86 ? 2.0 : 1.0;
    float ry = (v - sbBot) / signH * rows;
    float rowF = fract(ry);
    float glyphRow = smoothstep(0.16, 0.24, rowF) * (1.0 - smoothstep(0.66, 0.74, rowF));
    float cellU = u * 10.0;
    float cellI = floor(cellU);
    float gOn = step(0.30, hash12(vec2(cellI + floor(ry) * 17.0, bi * 3.0 + seedA * 41.0)));
    float gFill = smoothstep(0.10, 0.18, fract(cellU)) * (1.0 - smoothstep(0.72, 0.80, fract(cellU)));
    float margin = 1.0 - smoothstep(bayW * 0.5 - 0.42, bayW * 0.5 - 0.30, abs(bx));
    float text = glyphRow * gOn * gFill * margin * detail;
    vec3 ink = lightBoard ? vec3(0.03, 0.03, 0.04) : vec3(0.70, 0.66, 0.55);
    vec3 boardShade = boardCol * (0.86 + 0.14 * n2);
    boardShade = mix(boardShade, ink, text * 0.85);
    col = mix(col, boardShade, board * detail);
    rough = mix(rough, 0.6, board * detail);
    emit += boardCol * 0.06 * uNight * board * (1.0 - text);
    // a striped cloth awning over about a third of the openings
    if (hb2 < 0.34 && open) {
      float aTop = openTop, aBot = openTop - 0.70 + 0.05 * abs(sin(u * 12.5));
      float aw = smoothstep(aBot - 0.01, aBot + 0.01, v) * (1.0 - smoothstep(aTop - 0.005, aTop + 0.005, v)) * (1.0 - pMask) * (1.0 - smoothstep(bayW * 0.5 - pillarW * 0.5 - 0.02, bayW * 0.5 - pillarW * 0.5 + 0.02, abs(bx)));
      float st = step(0.5, fract(u / 0.26));
      vec3 c1 = hb < 0.5 ? vec3(0.42, 0.05, 0.04) : (hb < 0.75 ? vec3(0.05, 0.16, 0.09) : vec3(0.07, 0.10, 0.28));
      vec3 awCol = mix(c1, vec3(0.62, 0.58, 0.50), st) * (0.7 + 0.3 * smoothstep(aBot, aTop, v));
      col = mix(col, awCol, aw * detail);
      inside *= 1.0 - aw;
      rough = mix(rough, 0.85, aw);
      // shadow on the goods under the cloth
      col *= 1.0 - 0.45 * (1.0 - smoothstep(aBot - 0.5, aBot, v)) * step(aBot - 0.5, v) * step(v, aBot) * inside;
    }
    // projecting chhajja: slab face with the dark shadow line under it
    float slabTop = groundH, slabBot = groundH - chhajjaH;
    float chh = smoothstep(slabBot - 0.01, slabBot + 0.01, v) * (1.0 - smoothstep(slabTop - 0.01, slabTop + 0.01, v));
    col = mix(col, trim * 0.98, chh * detail);
    col *= 1.0 - 0.45 * smoothstep(slabBot - 0.16, slabBot, v) * step(v, slabBot) * detail;
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
    float dx = sdArch(opP + vec2(e, 0.0), opW, opH, opPt) - sdArch(opP - vec2(e, 0.0), opW, opH, opPt);
    float dy = sdArch(opP + vec2(0.0, e), opW, opH, opPt) - sdArch(opP - vec2(0.0, e), opW, opH, opPt);
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
