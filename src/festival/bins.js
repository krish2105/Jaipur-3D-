// Spatial bins over a flat typed array of items (stride floats each, x at offset ox, z at offset oz) and a "nearest N within R" gather.
// Used by the festival renderers: tens of thousands of static decoration items exist, only the ones near the camera are ever drawn.
export class Bins {
  constructor(data, stride, ox = 0, oz = 1, cell = 48) {
    this.data = data;
    this.stride = stride;
    this.ox = ox;
    this.oz = oz;
    this.cell = cell;
    this.count = Math.floor(data.length / stride);
    this.map = new Map();
    for (let i = 0; i < this.count; i++) {
      const k = Math.floor(data[i * stride + ox] / cell) * 65536 + Math.floor(data[i * stride + oz] / cell);
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(i);
    }
  }

  /** item indices within radius r of (x, z) (unordered) */
  within(x, z, r, out = []) {
    out.length = 0;
    const c = this.cell, r2 = r * r, d = this.data, s = this.stride;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.map.get(i * 65536 + j);
      if (!a) continue;
      for (const k of a) {
        const dx = d[k * s + this.ox] - x, dz = d[k * s + this.oz] - z;
        if (dx * dx + dz * dz <= r2) out.push(k);
      }
    }
    return out;
  }

  /**
   * up to `cap` items nearest to (x, z) within radius r. Uses a distance histogram to pick the cut-off (O(n), no sort), so it may return slightly
   * fewer than cap. Returns the count; indices are written to out[0..count).
   */
  nearest(x, z, r, cap, out) {
    const cand = this._cand || (this._cand = []);
    this.within(x, z, r, cand);
    const d = this.data, s = this.stride;
    if (cand.length <= cap) { for (let i = 0; i < cand.length; i++) out[i] = cand[i]; return cand.length; }
    const B = 96, hist = new Int32Array(B);
    const dist = this._dist && this._dist.length >= cand.length ? this._dist : (this._dist = new Float32Array(cand.length + 1024));
    for (let i = 0; i < cand.length; i++) {
      const dx = d[cand[i] * s + this.ox] - x, dz = d[cand[i] * s + this.oz] - z;
      const q = Math.sqrt(dx * dx + dz * dz);
      dist[i] = q;
      hist[Math.min(B - 1, Math.floor((q / r) * B))]++;
    }
    let acc = 0, cut = B - 1;
    for (let b = 0; b < B; b++) { acc += hist[b]; if (acc >= cap) { cut = acc > cap && b > 0 ? b - 1 : b; break; } }
    // bins are whole distance shells: never exceed cap
    let n = 0;
    const lim = ((cut + 1) / B) * r;
    for (let i = 0; i < cand.length && n < cap; i++) if (dist[i] < lim) out[n++] = cand[i];
    return n;
  }
}
