// Geometry-clipmap terrain: nested square rings of doubling cell size, heights fetched in the vertex
// shader from the baked height textures (near 16 km @15.6 m, far 72 km @141 m). Fragment shader builds
// normals from the textures, procedural Aravalli rock/scrub/soil albedo, and the Man Sagar water body.
import * as THREE from 'three';
import { addEnvUniforms, ENV_DECL } from '../render/env.js';

const RING_VERT_HEAD = /* glsl */ `
uniform sampler2D uHNear;
uniform sampler2D uHFar;
uniform vec4 uTerr;      // x nearHalf, y farHalf, z centerX, w centerZ
uniform vec4 uTerr2;     // x lake level, y skirt drop, z unused, w unused
attribute float aSkirt;
varying vec3 vTWP;
varying float vTSkirt;
float terrainH(vec2 xz){
  float m = max(abs(xz.x), abs(xz.y)) / uTerr.x;
  vec2 fuv = clamp(xz / (2.0 * uTerr.y) + 0.5, vec2(0.001), vec2(0.999));
  float hf = texture2D(uHFar, fuv).r;
  if (m >= 1.0) return hf;
  vec2 nuv = xz / (2.0 * uTerr.x) + 0.5;
  float hn = texture2D(uHNear, nuv).r;
  return mix(hn, hf, smoothstep(0.82, 1.0, m));
}
`;

const FRAG_HEAD = /* glsl */ `
${ENV_DECL}
uniform sampler2D uHNear;
uniform sampler2D uHFar;
uniform sampler2D uLake;
uniform vec4 uTerr;
uniform vec4 uTerr2;
uniform vec4 uVeg;       // x greenness, y urban-dust factor, z wet, w unused
uniform sampler2D uCover; // OSM land cover: R built-up, G vegetation, B water, A parks (0 where unmapped)
uniform vec4 uCoverP;     // x x0, y z0 (m), z 1/width, w 1/height (m^-1); zw = 0 disables
varying vec3 vTWP;
varying float vTSkirt;
float terrainHf(vec2 xz){
  float m = max(abs(xz.x), abs(xz.y)) / uTerr.x;
  vec2 fuv = clamp(xz / (2.0 * uTerr.y) + 0.5, vec2(0.001), vec2(0.999));
  float hf = texture2D(uHFar, fuv).r;
  if (m >= 1.0) return hf;
  float hn = texture2D(uHNear, xz / (2.0 * uTerr.x) + 0.5).r;
  return mix(hn, hf, smoothstep(0.82, 1.0, m));
}
vec3 terrainNormal(vec2 xz, float step){
  float hL = terrainHf(xz - vec2(step, 0.0)), hR = terrainHf(xz + vec2(step, 0.0));
  float hD = terrainHf(xz - vec2(0.0, step)), hU = terrainHf(xz + vec2(0.0, step));
  return normalize(vec3(hL - hR, 2.0 * step, hD - hU));
}
`;

function emptyCover() {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

export class Terrain {
  /**
   * @param {import('./heightfield.js').Heightfield} hf
   * @param {object} settings tier settings (terrainRings, terrainGrid)
   */
  constructor(hf, settings) {
    this.hf = hf;
    this.settings = settings;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.center = new THREE.Vector2();
    this.uniforms = {
      uHNear: { value: hf.nearTex },
      uHFar: { value: hf.farTex },
      uLake: { value: hf.lakeTex },
      uTerr: { value: new THREE.Vector4(hf.nearHalf, hf.farHalf, 0, 0) },
      uTerr2: { value: new THREE.Vector4(hf.lakeLevel, 60, 0, 0) },
      uVeg: { value: new THREE.Vector4(0.25, 0.5, 0, 0) },
      uCover: { value: emptyCover() },
      uCoverP: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    this.rings = [];
    const N = settings.terrainGrid;
    const rings = settings.terrainRings;
    // base cell size such that the outer ring reaches ~36 km
    const outer = 36000;
    const s0 = (2 * outer) / (N * 2 ** (rings - 1));
    for (let k = 0; k < rings; k++) {
      const s = s0 * 2 ** k;
      const mat = this._makeMaterial();
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -(rings - k) * 0.6;
      mat.polygonOffsetUnits = -(rings - k) * 0.6;
      const mesh = new THREE.Mesh(this._ringGeometry(N, s, k > 0), mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.spacing = s;
      mesh.userData.ring = k;
      mesh.receiveShadow = k < 3;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.rings.push(mesh);
    }
    this.spacing0 = s0;
  }

  /** install the OSM land-cover raster (Uint8Array RGBA, meta from manifest.cover) */
  setCover(bytes, meta) {
    const t = new THREE.DataTexture(bytes, meta.w, meta.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    t.name = 'landcover';
    this.uniforms.uCover.value?.dispose?.();
    this.uniforms.uCover.value = t;
    this.uniforms.uCoverP.value.set(meta.x0, meta.z0, 1 / (meta.w * meta.texel), 1 / (meta.h * meta.texel));
  }

  _ringGeometry(N, s, hole) {
    const half = (N * s) / 2;
    const pos = [];
    const skirt = [];
    const idx = [];
    const vid = new Map();
    const key = (i, j) => j * (N + 1) + i;
    const addV = (i, j, sk = 0) => {
      const k = sk ? `s${key(i, j)}` : key(i, j);
      let id = vid.get(k);
      if (id === undefined) {
        id = pos.length / 3;
        vid.set(k, id);
        pos.push(-half + i * s, 0, -half + j * s);
        skirt.push(sk);
      }
      return id;
    };
    // hole is one coarse cell smaller than the finer ring's extent: rings snap to different lattices, so we overlap
    const hlo = hole ? N / 4 + 1 : -1, hhi = hole ? (3 * N) / 4 - 1 : -1;
    const inHole = (i, j) => hole && i >= hlo && i < hhi && j >= hlo && j < hhi;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        if (inHole(i, j)) continue;
        const a = addV(i, j), b = addV(i + 1, j), c = addV(i, j + 1), d = addV(i + 1, j + 1);
        idx.push(a, c, b, b, c, d);
        // skirts on the outer boundary and on the hole boundary
        const edge = (p0, p1) => {
          const sa = addV(p0[0], p0[1], 1), sb = addV(p1[0], p1[1], 1);
          const va = addV(p0[0], p0[1]), vb = addV(p1[0], p1[1]);
          idx.push(va, sb, vb, va, sa, sb);
        };
        if (j === 0) edge([i, 0], [i + 1, 0]);
        if (j === N - 1) edge([i + 1, N], [i, N]);
        if (i === 0) edge([0, j + 1], [0, j]);
        if (i === N - 1) edge([N, j], [N, j + 1]);
        if (hole) {
          if (inHole(i, j - 1)) edge([i + 1, j], [i, j]);
          if (inHole(i, j + 1)) edge([i, j + 1], [i + 1, j + 1]);
          if (inHole(i - 1, j)) edge([i, j], [i, j + 1]);
          if (inHole(i + 1, j)) edge([i + 1, j + 1], [i + 1, j]);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }

  _makeMaterial() {
    const u = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, side: THREE.FrontSide });
    mat.userData.programKey = 'terrain';
    mat.onBeforeCompile = (shader) => {
      addEnvUniforms(shader);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', RING_VERT_HEAD + 'void main() {')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          vec3 transformed = vec3(position);
          vec2 wxz = (modelMatrix * vec4(position, 1.0)).xz;
          transformed.y = terrainH(wxz) - aSkirt * uTerr2.y;
          vTWP = vec3(wxz.x, transformed.y, wxz.y);
          vTSkirt = aSkirt;
          `,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', FRAG_HEAD + TERRAIN_FRAG_FN + 'void main() {')
        .replace('#include <color_fragment>', 'vec4 tAlb = terrainAlbedo(vTWP); diffuseColor.rgb = tAlb.rgb; float tWater = tAlb.a;')
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          float roughnessFactor = roughness;
          roughnessFactor = mix(roughnessFactor, 0.06, tWater);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * (0.35 + 0.65 * (1.0 - uWet.x)), 0.85);
          `,
        )
        .replace(
          '#include <normal_fragment_begin>',
          /* glsl */ `
          float dTerr = length(vTWP - cameraPosition);
          vec3 tn = terrainNormal(vTWP.xz, clamp(dTerr * 0.004, 24.0, 300.0));
          // fine rock detail near the camera
          float detail = smoothstep(900.0, 60.0, dTerr);
          vec2 dp = vTWP.xz * 0.35;
          tn = normalize(tn + detail * 0.35 * vec3(vnoise(dp) - 0.5, 0.0, vnoise(dp + 9.7) - 0.5) * (1.0 - tn.y * 0.3));
          if (tWater > 0.5) {
            vec2 wp = vTWP.xz * 0.06 + uWindV * uTime * 0.02;
            tn = normalize(vec3((vnoise(wp * 3.0 + uTime * 0.05) - 0.5) * 0.09, 1.0, (vnoise(wp * 3.0 + 40.0 - uTime * 0.04) - 0.5) * 0.09));
          }
          vec3 normal = normalize((viewMatrix * vec4(tn, 0.0)).xyz);
          vec3 nonPerturbedNormal = normal;
          `,
        );
    };
    return mat;
  }

  /** Recentre rings on the camera (snapped to each ring's lattice so vertices never swim). */
  update(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    // each ring keeps its own lattice-snapped centre (mesh.position); the shader samples at world xz
    for (const m of this.rings) {
      const s2 = m.userData.spacing * 2;
      m.position.set(Math.round(cx / s2) * s2, 0, Math.round(cz / s2) * s2);
      m.updateMatrix();
    }
  }
}

// Terrain fragment helpers (albedo/water). Returns rgb + water flag in .a.
const TERRAIN_FRAG_FN = /* glsl */ `
vec4 terrainAlbedo(vec3 wp){
  vec2 xz = wp.xz;
  float d = length(wp - cameraPosition);
  float h = wp.y;
  vec3 n = terrainNormal(xz, clamp(d * 0.004, 24.0, 300.0));
  float slope = 1.0 - n.y;                        // 0 flat .. 1 vertical
  // large-scale variation
  float lo = fbm2(xz * 0.0009);
  float mid = fbm2_3(xz * 0.011 + 3.0);
  float hi = vnoise(xz * 0.6) * 0.5 + vnoise(xz * 2.3) * 0.5;
  float fadeHi = smoothstep(500.0, 40.0, d);
  // palette (linear-ish sRGB-decoded by three: values here are linear reflectance)
  vec3 soil  = vec3(0.19, 0.135, 0.088);
  vec3 dust  = vec3(0.265, 0.195, 0.135);
  vec3 rockA = vec3(0.115, 0.093, 0.076);
  vec3 rockB = vec3(0.20, 0.155, 0.118);
  vec3 scrubDry = vec3(0.105, 0.095, 0.046);
  vec3 scrubGreen = vec3(0.05, 0.088, 0.03);
  // rock on steep slopes with strata banding
  float strata = 0.5 + 0.5 * sin(h * 0.21 + lo * 14.0 + mid * 3.0);
  strata = mix(0.5, strata, smoothstep(2500.0, 300.0, d));
  vec3 rock = mix(rockA, rockB, clamp(strata * 0.5 + mid * 0.6, 0.0, 1.0));
  float rockMask = smoothstep(0.035, 0.15, slope + (lo - 0.5) * 0.05);
  // scrub on gentle-to-mid slopes above the plain, thicker with greenness
  float scrubMask = smoothstep(0.008, 0.06, slope) * (1.0 - rockMask * 0.7) * smoothstep(0.0, 60.0, h + 4.0) * (0.3 + 0.7 * mid);
  vec3 scrub = mix(scrubDry, scrubGreen, uVeg.x);
  vec3 plain = mix(soil, dust, lo * 0.9 + 0.05);
  // the plain around the city reads as pale urban dust
  float cityDist = length(xz);
  plain = mix(plain, vec3(0.31, 0.25, 0.185), (1.0 - smoothstep(1800.0, 4200.0, cityDist)) * 0.6 * uVeg.y);
  vec3 col = plain;
  col = mix(col, scrub, scrubMask * 0.85);
  col = mix(col, rock, rockMask);
  col *= 0.86 + 0.28 * mix(0.5, hi, fadeHi);
  col *= 0.9 + 0.2 * mid;
  // OpenStreetMap land cover, only where mapped (uCoverP.zw == 0 -> no data -> all zero)
  vec4 cv = texture2D(uCover, (xz - uCoverP.xy) * uCoverP.zw);
  col = mix(col, vec3(0.30, 0.245, 0.19) * (0.84 + 0.32 * hi), cv.r * 0.8);                                     // built-up land: pale roofs and dust
  col = mix(col, mix(vec3(0.085, 0.082, 0.040), vec3(0.058, 0.098, 0.034), uVeg.x) * (0.72 + 0.56 * mid), cv.g * 0.88 * (1.0 - rockMask * 0.4));   // forest / scrub
  col = mix(col, mix(vec3(0.10, 0.115, 0.045), vec3(0.05, 0.115, 0.03), uVeg.x) * (0.8 + 0.4 * hi), cv.a);      // parks and lawns
  // wet ground darkens
  col *= 1.0 - 0.32 * uWet.x;
  // water body (Man Sagar): baked mask sampled on the near grid
  float water = 0.0;
  if (abs(xz.x) < uTerr.x && abs(xz.y) < uTerr.x){
    float lk = texture2D(uLake, xz / (2.0 * uTerr.x) + 0.5).r;
    water = smoothstep(0.45, 0.6, lk) * step(abs(h - uTerr2.x), 3.0);
  }
  water = max(water, smoothstep(0.4, 0.65, cv.b)); // OSM water polygons (Man Sagar, Maota, Hanuman Sagar, ponds ...)
  if (water > 0.5){
    col = mix(vec3(0.020, 0.040, 0.045), vec3(0.035, 0.065, 0.06), fbm2_3(xz * 0.01) );
  }
  return vec4(col, water);
}
`;
