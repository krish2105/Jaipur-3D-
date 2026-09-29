// Main-thread index of the baked OSM building footprints (b_* chunks): wall segments in a uniform grid for 2D ray casts, plus roof anchors.
// Used only for decorations that must hang on something real (festival strings on facades, rooftop kite launch points, diyas at wall bases).
// Nothing here is invented: every wall is an OSM footprint edge; heights are the baked ones (99 % of them are inferred, see PROGRESS.md).
const TILE = 500;

export class FootprintIndex {
  constructor(cell = 24) {
    this.cell = cell;
    this.grid = new Map();
    // segment i: x0 z0 x1 z1 in world metres
    this.sx0 = []; this.sz0 = []; this.sx1 = []; this.sz1 = [];
    this.sh = [];   // building height (m above its own base)
    this.sb = [];   // building index
    this.roofs = []; // { x, z, h, area, id } one per building (vertex centroid, ring area)
    this.tiles = new Set();
  }

  get segmentCount() { return this.sh.length; }

  /** add one baked building chunk { t: [ix, iz], b: [{ i, h, p: [x, z, ...] decimetres relative to the tile origin }] } */
  addChunk(chunk) {
    if (!chunk || !chunk.b) return 0;
    const key = chunk.t[0] + '_' + chunk.t[1];
    if (this.tiles.has(key)) return 0;
    this.tiles.add(key);
    const ox = chunk.t[0] * (chunk.s || TILE), oz = chunk.t[1] * (chunk.s || TILE);
    let n = 0;
    for (const rec of chunk.b) {
      const p = rec.p;
      if (!p || p.length < 6) continue;
      const w = new Array(p.length);
      for (let k = 0; k < p.length; k += 2) { w[k] = ox + p[k] / 10; w[k + 1] = oz + p[k + 1] / 10; }
      n += this.addRing(w, rec.h || 8, rec.i);
    }
    return n;
  }

  /** add one building ring given as flat world metres [x, z, x, z, ...]; returns the number of wall segments */
  addRing(w, h = 8, id = null) {
    const m = w.length / 2;
    if (m < 3) return 0;
    const bi = this.roofs.length;
    let cx = 0, cz = 0, area = 0;
    for (let k = 0; k < m; k++) {
      const x0 = w[2 * k], z0 = w[2 * k + 1];
      const k1 = (k + 1) % m;
      const x1 = w[2 * k1], z1 = w[2 * k1 + 1];
      cx += x0; cz += z0;
      area += x0 * z1 - x1 * z0;
      this._addSeg(x0, z0, x1, z1, h, bi);
    }
    this.roofs.push({ x: cx / m, z: cz / m, h, area: Math.abs(area) / 2, id });
    return m;
  }

  _addSeg(x0, z0, x1, z1, h, b) {
    const i = this.sh.length;
    this.sx0.push(x0); this.sz0.push(z0); this.sx1.push(x1); this.sz1.push(z1); this.sh.push(h); this.sb.push(b);
    const c = this.cell;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (c * 0.5)));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ci = Math.floor((x0 + (x1 - x0) * t) / c), cj = Math.floor((z0 + (z1 - z0) * t) / c);
      const k = ci * 65536 + cj;
      if (k === last) continue;
      last = k;
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      if (a[a.length - 1] !== i) a.push(i);
    }
  }

  /**
   * first wall hit by the ray (x, z) + t (dx, dz) (dx, dz a unit vector), t in (0, maxDist].
   * @returns {{t:number, seg:number, x:number, z:number, h:number, b:number}|null}
   */
  raycast(x, z, dx, dz, maxDist) {
    const c = this.cell;
    const steps = Math.ceil(maxDist / (c * 0.5));
    let best = null, bt = maxDist;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let s = 0; s <= steps; s++) {
      const d = Math.min(maxDist, s * c * 0.5);
      const ci = Math.floor((x + dx * d) / c), cj = Math.floor((z + dz * d) / c);
      const a = this.grid.get(ci * 65536 + cj);
      if (!a) continue;
      for (const i of a) {
        if (seen.has(i)) continue;
        seen.add(i);
        const ex = this.sx1[i] - this.sx0[i], ez = this.sz1[i] - this.sz0[i];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const wx = this.sx0[i] - x, wz = this.sz0[i] - z;
        const t = (wx * ez - wz * ex) / den;
        const u = (wx * dz - wz * dx) / den;
        if (t > 0.05 && t < bt && u >= 0 && u <= 1) { bt = t; best = { t, seg: i, x: x + dx * t, z: z + dz * t, h: this.sh[i], b: this.sb[i] }; }
      }
      if (best && d > bt + c) break;
    }
    return best;
  }

  /** roof anchors within `r` metres of (x, z), min ring area `minArea` m2 */
  roofsNear(x, z, r, minArea = 30, out = []) {
    out.length = 0;
    const r2 = r * r;
    for (const b of this.roofs) {
      const dx = b.x - x, dz = b.z - z;
      if (dx * dx + dz * dz < r2 && b.area >= minArea) out.push(b);
    }
    return out;
  }
}

/** load the b_* chunks of every manifest tile whose centre is within `radius` of (cx, cz) through a chunk source ({ get(kind, ix, iz) }) */
export async function loadFootprints(source, manifest, cx, cz, radius, index = new FootprintIndex()) {
  const jobs = [];
  for (const key of Object.keys(manifest.tiles || {})) {
    const [ix, iz] = key.split('_').map(Number);
    const tx = (ix + 0.5) * TILE, tz = (iz + 0.5) * TILE;
    if (Math.hypot(tx - cx, tz - cz) > radius + TILE * 0.71) continue;
    if (!manifest.tiles[key].b) continue;
    jobs.push(source.get('b', ix, iz).then((c) => index.addChunk(c)));
  }
  await Promise.all(jobs);
  return index;
}
