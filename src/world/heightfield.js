// Runtime terrain data: loads baked chunks, exposes CPU sampling and GPU textures.
import * as THREE from 'three';
import { HeightSampler } from './heightSampler.js';

export const GROUND_DATUM = 442.6; // ASL metres at the origin; world y = elevation - datum

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint16Array(await r.arrayBuffer());
}

export class Heightfield {
  constructor() {
    this.ready = false;
  }

  async load(base = 'data/terrain/') {
    const man = await (await fetch(base + 'manifest.json')).json();
    this.manifest = man;
    const { near, far, scale } = man;
    this.scale = scale;
    this.nearHalf = near.halfM;
    this.nearN = near.size;
    this.farHalf = far.halfM;
    this.farN = far.size;
    this.lakeLevel = (man.lakeLevel ?? 411) - GROUND_DATUM;

    const nearU = new Uint16Array(near.size * near.size);
    const jobs = [];
    for (let cj = 0; cj < near.chunks; cj++)
      for (let ci = 0; ci < near.chunks; ci++)
        jobs.push(
          fetchBin(`${base}near_${ci}_${cj}.bin`).then((u) => {
            const cs = near.chunkSize;
            for (let j = 0; j < cs; j++) nearU.set(u.subarray(j * cs, (j + 1) * cs), (cj * cs + j) * near.size + ci * cs);
          }),
        );
    const farJob = fetchBin(base + 'far.bin');
    const lakeJob = man.lake ? fetch(base + man.lake.file).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)) : Promise.resolve(null);
    await Promise.all(jobs);
    const farU = await farJob;
    const lakeBits = await lakeJob;

    this.near = new Float32Array(nearU.length);
    for (let i = 0; i < nearU.length; i++) this.near[i] = nearU[i] / scale - GROUND_DATUM;
    this.far = new Float32Array(farU.length);
    for (let i = 0; i < farU.length; i++) this.far[i] = farU[i] / scale - GROUND_DATUM;

    // GPU textures (half float => hardware bilinear filtering is core WebGL2)
    const toHalf = (f32) => {
      const h = new Uint16Array(f32.length);
      for (let i = 0; i < f32.length; i++) h[i] = THREE.DataUtils.toHalfFloat(f32[i]);
      return h;
    };
    const mk = (data, n) => {
      const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
      t.internalFormat = 'R16F';
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.nearTex = mk(toHalf(this.near), near.size);
    this.farTex = mk(toHalf(this.far), far.size);

    const lm = new Uint8Array(near.size * near.size);
    if (lakeBits) for (let k = 0; k < lm.length; k++) lm[k] = (lakeBits[k >> 3] >> (k & 7)) & 1 ? 255 : 0;
    const lt = new THREE.DataTexture(lm, near.size, near.size, THREE.RedFormat, THREE.UnsignedByteType);
    lt.minFilter = lt.magFilter = THREE.LinearFilter;
    lt.wrapS = lt.wrapT = THREE.ClampToEdgeWrapping;
    lt.generateMipmaps = false;
    lt.needsUpdate = true;
    this.lakeTex = lt;
    this.lakeMask = lm;
    this.sampler = new HeightSampler(this.near, near.size, near.halfM, this.far, far.size, far.halfM);
    this.ready = true;
    return this;
  }

  /** ground height (m, relative to datum) at world x,z. Mirrors the terrain vertex shader. */
  heightAt(x, z) {
    return this.sampler.heightAt(x, z);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 6;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  }

  isLake(x, z) {
    const n = this.nearN;
    const i = Math.round(((x + this.nearHalf) / (2 * this.nearHalf)) * n - 0.5);
    const j = Math.round(((z + this.nearHalf) / (2 * this.nearHalf)) * n - 0.5);
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    return this.lakeMask[j * n + i] > 0;
  }
}
