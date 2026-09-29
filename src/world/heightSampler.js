// CPU height sampling shared by the main thread and the tile worker (mirrors the terrain vertex shader).
export class HeightSampler {
  constructor(near, nearN, nearHalf, far, farN, farHalf) {
    this.near = near; this.nearN = nearN; this.nearHalf = nearHalf;
    this.far = far; this.farN = farN; this.farHalf = farHalf;
  }

  _bil(arr, n, half, x, z) {
    const u = ((x + half) / (2 * half)) * n - 0.5;
    const v = ((z + half) / (2 * half)) * n - 0.5;
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(u)));
    const j0 = Math.max(0, Math.min(n - 2, Math.floor(v)));
    const fx = Math.max(0, Math.min(1, u - i0));
    const fz = Math.max(0, Math.min(1, v - j0));
    const a = arr[j0 * n + i0], b = arr[j0 * n + i0 + 1], c = arr[(j0 + 1) * n + i0], d = arr[(j0 + 1) * n + i0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  heightAt(x, z) {
    const m = Math.max(Math.abs(x), Math.abs(z)) / this.nearHalf;
    const hn = m < 1 ? this._bil(this.near, this.nearN, this.nearHalf, x, z) : 0;
    const fx = Math.max(-this.farHalf + 1, Math.min(this.farHalf - 1, x));
    const fz = Math.max(-this.farHalf + 1, Math.min(this.farHalf - 1, z));
    const hf = this._bil(this.far, this.farN, this.farHalf, fx, fz);
    if (m >= 1) return hf;
    const t = Math.max(0, Math.min(1, (m - 0.82) / 0.18));
    const s = t * t * (3 - 2 * t);
    return hn * (1 - s) + hf * s;
  }
}

/** A flat sampler (tests / lab): constant ground height. */
export class FlatSampler {
  constructor(h = 0) { this.h = h; }
  heightAt() { return this.h; }
}
