// Shared GLSL snippets (plain strings, spliced into shaders / ShaderChunks).

export const GLSL_COMMON = /* glsl */ `
#ifndef PI
#define PI 3.14159265359
#endif

float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3  hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm2(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float fbm2_3(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ---- atmosphere constants shared by LUT shader and JS mirror (src/sky/atmosphere.js) ---------
export const ATMO_CONSTS = {
  Rg: 6360000,
  Rt: 6460000,
  betaR: [5.802e-6, 13.558e-6, 33.1e-6],
  betaMScat: 3.996e-6,
  betaMExt: 4.44e-6,
  betaO: [0.65e-6, 1.881e-6, 0.085e-6],
  HR: 8000,
  HM: 1200,
  gMie: 0.8,
};

export const GLSL_ATMOSPHERE = /* glsl */ `
const float Rg = 6360000.0;
const float Rt = 6460000.0;
const vec3  bR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float bMs = 3.996e-6;
const float bMe = 4.44e-6;
const vec3  bO = vec3(0.65e-6, 1.881e-6, 0.085e-6);
const float HR = 8000.0;
const float HM = 1200.0;

float rayleighPhase(float c){ return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float miePhase(float c, float g){
  float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-3), 1.5);
}
// far intersection of ray (o inside sphere radius r)
float raySphereFar(vec3 o, vec3 d, float r){ float b = dot(o, d); float c = dot(o, o) - r * r; float disc = b * b - c; return disc < 0.0 ? -1.0 : -b + sqrt(disc); }
float raySphereNear(vec3 o, vec3 d, float r){ float b = dot(o, d); float c = dot(o, o) - r * r; float disc = b * b - c; return disc < 0.0 ? -1.0 : -b - sqrt(disc); }

// dust: mieScale multiplies aerosol density, dustTint colours its scattering (brown/orange dust absorbs blue)
vec3 opticalDepthToSun(vec3 p, vec3 sdir, float mieScale, vec3 dustTint){
  float tEnd = raySphereFar(p, sdir, Rt);
  float dt = tEnd / 6.0;
  vec3 od = vec3(0.0);
  for (int i = 0; i < 6; i++){
    vec3 q = p + sdir * (dt * (float(i) + 0.5));
    float h = length(q) - Rg;
    float dR = exp(-h / HR), dM = exp(-h / HM) * mieScale;
    float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
    od += (bR * dR + bMe * dM * (dustTint) + bO * dO) * dt;
  }
  return od;
}
`;

// ---- Cloud density (shared by sky pass and ground cloud-shadows) ------------------------------
export const GLSL_CLOUD_FN = /* glsl */ `
uniform sampler2D uNoise;      // RGBA8 tileable (mipmapped): r perlin-worley, g/b/a worley at rising frequency
uniform vec4 uCloud;           // x coverage, y density, z base altitude (m), w thickness (m)
uniform vec2 uCloudOffset;     // wind-advected offset (m)
uniform vec4 uCloudFx;         // x shadowStrength, y overcast, z cirrus, w storminess

float cloudShape(vec2 xz, float lod){
  vec2 uv = (xz + uCloudOffset) * (1.0 / 14000.0);
  // domain warp for irregular outlines
  vec2 wv = textureLod(uNoise, uv * 0.37 + 0.13, lod + 1.0).rg - 0.5;
  uv += wv * 0.09;
  vec4 n = textureLod(uNoise, uv, lod);
  return n.r * 0.72 + n.g * 0.28;
}
// 0..1 density inside the slab; hf = height fraction in slab; lod = mip level from viewing distance
float cloudDensity(vec2 xz, float hf, bool detail, float lod){
  float cov = uCloud.x;
  float b = cloudShape(xz, lod);
  float d = smoothstep(1.0 - cov * 0.95 - 0.10, 1.0 - cov * 0.95 + 0.22, b);
  if (d <= 0.001) return 0.0;
  // cumulus profile: flat base, domed top whose height follows the plan density
  float top = 0.22 + 0.78 * pow(d, 0.65);
  float prof = smoothstep(0.0, 0.10, hf) * (1.0 - smoothstep(top - 0.30, top, hf));
  if (detail){
    vec2 uv2 = (xz + uCloudOffset * 1.15) * (1.0 / 2600.0);
    vec4 n2 = textureLod(uNoise, uv2 + vec2(0.37, 0.11), lod + 2.3);
    float er = n2.g * 0.55 + n2.b * 0.45;
    float edge = 1.0 - d;
    d = clamp(d - edge * (1.0 - er) * 0.6 - (1.0 - hf) * 0.0, 0.0, 1.0);
    vec4 n3 = textureLod(uNoise, uv2 * 3.7 + hf * 0.11, lod + 3.0);
    d = clamp(d - (1.0 - n3.a) * 0.22 * (1.0 - d) * (0.4 + 0.6 * hf), 0.0, 1.0);
  }
  return d * prof * uCloud.y;
}
// direct-sun transmittance through the cloud slab, as seen from a ground point
float cloudSunShadow(vec3 wp, vec3 sunDir){
  if (uCloudFx.x <= 0.001 || sunDir.y < 0.03) return 1.0;
  float tb = (uCloud.z + uCloud.w * 0.35 - wp.y) / sunDir.y;
  vec2 p = wp.xz + sunDir.xz * tb;
  float d = cloudDensity(p, 0.45, false, 1.5);
  return 1.0 - clamp(d * 1.25, 0.0, 1.0) * uCloudFx.x;
}
`;
