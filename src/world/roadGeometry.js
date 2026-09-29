// Road ribbons draped on the terrain, grouped into three depth-offset classes.
export const ROAD_CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6, living_street: 7, service: 8, pedestrian: 9, footway: 10, path: 11, steps: 12, track: 13 };
const GROUP_OF = (c) => (c <= 3 ? 2 : c <= 7 ? 1 : 0);
const Y_OFF = [0.02, 0.05, 0.08]; // minor < medium < major so overlaps resolve deterministically

/**
 * @param {object} rchunk baked road chunk ({t:[ix,iz], w:[{c,w,p,...}]})
 * @param {{heightAt:(x:number,z:number)=>number}} sampler world-space ground heights
 * @param {number} tileSize
 */
export function buildRoadGeometry(rchunk, sampler, tileSize = 500) {
  const ox = rchunk.t[0] * tileSize, oz = rchunk.t[1] * tileSize;
  const G0 = { pos: [], uv: [], aR: [], idx: [], n: 0 };
  for (const w of rchunk.w) {
    if (w.c === 'steps') continue;
    const cls = ROAD_CLASS[w.c] ?? 6;
    const G = G0;
    const yOff = Y_OFF[GROUP_OF(cls)];
    // decode + resample so long segments follow the terrain
    const raw = [];
    for (let i = 0; i < w.p.length; i += 2) raw.push([w.p[i] / 10, w.p[i + 1] / 10]);
    const pts = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i], b = raw[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / 7));
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    pts.push(raw[raw.length - 1]);
    if (pts.length < 2) continue;
    const half = w.w / 2;
    let acc = 0;
    const base = G.n;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
      let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const y = sampler.heightAt(ox + pts[i][0], oz + pts[i][1]) + yOff;
      for (const side of [-1, 1]) {
        G.pos.push(pts[i][0] + nx * half * side, y, pts[i][1] + nz * half * side);
        G.uv.push(acc, side * half);
        G.aR.push(cls / 16, Math.min(1, w.w / 32), w.o ? 1 : 0, w.b ? 1 : 0);
      }
      G.n += 2;
      if (i > 0) {
        const a = base + (i - 1) * 2;
        G.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = G0;
  return {
    pos: new Float32Array(g.pos),
    uv: new Float32Array(g.uv),
    aR: new Float32Array(g.aR),
    idx: g.n > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx),
    vertexCount: g.n,
    triCount: g.idx.length / 3,
  };
}
