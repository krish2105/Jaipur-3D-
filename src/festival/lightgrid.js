// Light grid: a camera-following top-down RGBA16F texture that holds the coloured street / festival / firework light around the viewer.
// It replaces a pool of real point lights (which would cost per pixel and recompile shaders when the count changes):
//   rgb = summed irradiance-like tint from every source in reach of the cell, a = terrain height under the cell (so light thins out with height above the street)
// Every lit material (buildings, roads, terrain, props, landmarks, street life) reads it through the global `lights_fragment_end` patch in render/env.js
// (`lightGridAt`). The grid is world-anchored (its centre snaps to whole cells and only re-centres when the camera has drifted a fifth of its size),
// so content never shimmers as the camera moves.
import * as THREE from 'three';
import { ENV } from '../render/env.js';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** float32 -> IEEE half (round to nearest, clamps to the largest finite half) */
export function toHalf(v) {
  if (v !== v) return 0x7e00;
  if (v > 65504) v = 65504; else if (v < -65504) v = -65504;
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7bff;
  const h = sign | (e << 10) | (m >> 13);
  return h + ((m & 0x1000) ? 1 : 0);
}
export function fromHalf(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}

/** CPU part (no GL): accumulation buffers, snapping, splatting */
export class LightGridCPU {
  /**
   * @param {{n:number, size:number, groundAt:(x:number,z:number)=>number}} o n cells per side, size in metres
   */
  constructor(o) {
    this.n = o.n;
    this.size = o.size;
    this.cell = o.size / o.n;
    this.groundAt = o.groundAt;
    this.cx = 0;
    this.cz = 0;
    this.valid = false;
    this.acc = new Float32Array(o.n * o.n * 3);
    this.ground = new Float32Array(o.n * o.n);
    this.snap = this.cell * 8;
  }

  /** true when the grid must be re-centred for a camera at (x, z) */
  needsRecentre(x, z) {
    return !this.valid || Math.abs(x - this.cx) > this.size * 0.18 || Math.abs(z - this.cz) > this.size * 0.18;
  }

  recentre(x, z) {
    this.cx = Math.round(x / this.snap) * this.snap;
    this.cz = Math.round(z / this.snap) * this.snap;
    this.valid = true;
    const n = this.n, c = this.cell, x0 = this.cx - this.size / 2 + c / 2, z0 = this.cz - this.size / 2 + c / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.ground[j * n + i] = this.groundAt(x0 + i * c, z0 + j * c);
  }

  clear() { this.acc.fill(0); }

  /** world region covered (for source culling) */
  get half() { return this.size / 2; }

  /** add a source: colour (r, g, b) at its peak, smooth (1 - d^2/R^2)^2 falloff to zero at radius R (metres) */
  splat(x, z, r, g, b, R) {
    const n = this.n, c = this.cell;
    const gx = (x - (this.cx - this.size / 2)) / c, gz = (z - (this.cz - this.size / 2)) / c;
    const rc = R / c;
    const i0 = Math.max(0, Math.floor(gx - rc)), i1 = Math.min(n - 1, Math.ceil(gx + rc));
    const j0 = Math.max(0, Math.floor(gz - rc)), j1 = Math.min(n - 1, Math.ceil(gz + rc));
    if (i0 > i1 || j0 > j1) return 0;
    const inv = 1 / (rc * rc);
    let touched = 0;
    for (let j = j0; j <= j1; j++) {
      const dz = j + 0.5 - gz;
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - gx;
        const q = 1 - (dx * dx + dz * dz) * inv;
        if (q <= 0) continue;
        const w = q * q, k = (j * n + i) * 3;
        this.acc[k] += r * w; this.acc[k + 1] += g * w; this.acc[k + 2] += b * w;
        touched++;
      }
    }
    return touched;
  }

  /** irradiance tint at a world point (nearest cell; for tests and CPU-side queries) */
  sample(x, z, out = [0, 0, 0]) {
    const n = this.n, c = this.cell;
    const i = Math.floor((x - (this.cx - this.size / 2)) / c), j = Math.floor((z - (this.cz - this.size / 2)) / c);
    if (i < 0 || j < 0 || i >= n || j >= n) { out[0] = out[1] = out[2] = 0; return out; }
    const k = (j * n + i) * 3;
    out[0] = this.acc[k]; out[1] = this.acc[k + 1]; out[2] = this.acc[k + 2];
    return out;
  }

  /** pack into a half-float RGBA buffer */
  pack(dst) {
    const n2 = this.n * this.n;
    for (let k = 0; k < n2; k++) {
      dst[k * 4] = toHalf(this.acc[k * 3]);
      dst[k * 4 + 1] = toHalf(this.acc[k * 3 + 1]);
      dst[k * 4 + 2] = toHalf(this.acc[k * 3 + 2]);
      dst[k * 4 + 3] = toHalf(this.ground[k]);
    }
    return dst;
  }
}

/** GPU part: owns the DataTexture and publishes it through the shared ENV uniforms */
export class LightGrid extends LightGridCPU {
  constructor(o) {
    super(o);
    this.data = new Uint16Array(this.n * this.n * 4);
    this.tex = new THREE.DataTexture(this.data, this.n, this.n, THREE.RGBAFormat, THREE.HalfFloatType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.flipY = false;
    this.tex.needsUpdate = true;
    this.enabled = false;
  }

  /** publish (after the caller has cleared + splatted this frame's sources) */
  upload() {
    this.pack(this.data);
    this.tex.needsUpdate = true;
    ENV.uLightGrid.value = this.tex;
    ENV.uLightGridP.value.set(this.cx, this.cz, this.size, 1);
    this.enabled = true;
  }

  disable() {
    ENV.uLightGridP.value.w = 0;
    this.enabled = false;
  }

  dispose() {
    this.tex.dispose();
  }
}
