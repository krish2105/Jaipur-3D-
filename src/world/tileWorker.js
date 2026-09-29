// Web Worker: builds tile geometry (buildings + roads + instance lists) off the main thread.
import { buildTileGeometry, RoadIndex } from './buildingGeometry.js';
import { buildRoadGeometry } from './roadGeometry.js';
import { HeightSampler, FlatSampler } from './heightSampler.js';
import { isExcludedFull } from './landmarks/plan.js';

let sampler = new FlatSampler(0);
let exclude = null; // footprints replaced by hand-modelled landmarks (ids, rings, discs, model footprints)
const TILE = 500;

function roadIndexFrom(roadChunks) {
  const idx = new RoadIndex();
  for (const rc of roadChunks) {
    if (!rc) continue;
    const ox = rc.t[0] * TILE, oz = rc.t[1] * TILE;
    // index in the *target tile's* frame: caller passes the target origin via rc.__rel
    for (const w of rc.w) {
      const pts = [];
      for (let i = 0; i < w.p.length; i += 2) pts.push([w.p[i] / 10 + rc.__dx, w.p[i + 1] / 10 + rc.__dz]);
      idx.addPolyline(pts, w.w, w.n || '', w.c);
    }
  }
  return idx;
}

function groundFor(chunk) {
  const ox = chunk.t[0] * TILE, oz = chunk.t[1] * TILE;
  const g = new Float32Array(chunk.b.length * 2);
  for (let i = 0; i < chunk.b.length; i++) {
    const p = chunk.b[i].p;
    let lo = 1e9, hi = -1e9;
    const step = Math.max(2, Math.floor(p.length / 12 / 2) * 2);
    for (let k = 0; k < p.length; k += step) {
      const h = sampler.heightAt(ox + p[k] / 10, oz + p[k + 1] / 10);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    g[i * 2] = lo;
    g[i * 2 + 1] = 1.0 + (hi - lo) + 0.3;
  }
  return g;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    if (m.flat != null) sampler = new FlatSampler(m.flat);
    else sampler = new HeightSampler(m.near, m.nearN, m.nearHalf, m.far, m.farN, m.farHalf);
    exclude = m.exclude || null;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'tile') {
    const t0 = performance.now();
    const out = { type: 'tile', key: m.key, detail: m.detail, ov: m.ov !== false, ix: m.ix, iz: m.iz };
    try {
      if (m.b && exclude) {
        const ox0 = m.b.t[0] * TILE, oz0 = m.b.t[1] * TILE;
        m.b = { ...m.b, b: m.b.b.filter((rec) => !isExcludedFull(rec, ox0, oz0, exclude)) };
      }
      // Overture filler footprints only inside the tier's overtureRadius; beyond it the tile is OSM-only (as before Phase 13)
      if (m.b && m.ov === false) m.b = { ...m.b, b: m.b.b.filter((rec) => !rec.o) };
      if (m.b && m.b.b.length) {
        const rcs = (m.roads || []).map((rc) => rc && { ...rc, __dx: (rc.t[0] - m.ix) * TILE, __dz: (rc.t[1] - m.iz) * TILE });
        const roads = roadIndexFrom(rcs);
        const g = buildTileGeometry(m.b, { detail: m.detail, ovPlain: !!m.ovPlain, roads, ground: groundFor(m.b) });
        out.bld = g;
      }
      const own = (m.roads || []).find((r) => r && r.t[0] === m.ix && r.t[1] === m.iz);
      if (own) out.roads = buildRoadGeometry(own, sampler, TILE);
      if (m.misc) {
        const ox = m.ix * TILE, oz = m.iz * TILE;
        const pl = (arr, extra) => {
          const o = new Float32Array((arr.length / 2) * 3);
          for (let i = 0; i < arr.length / 2; i++) {
            const x = ox + arr[2 * i] / 10, z = oz + arr[2 * i + 1] / 10;
            o[3 * i] = arr[2 * i] / 10; o[3 * i + 1] = sampler.heightAt(x, z); o[3 * i + 2] = arr[2 * i + 1] / 10;
          }
          return o;
        };
        out.trees = pl(m.misc.trees || []);
        out.lamps = pl(m.misc.lamps || []);
        out.walls = m.misc.walls || [];
        out.water = m.misc.water || [];
      }
    } catch (err) {
      out.error = String(err && err.stack ? err.stack : err);
    }
    out.ms = performance.now() - t0;
    const transfer = [];
    const add = (g) => { if (!g) return; for (const k of ['pos', 'nrm', 'uv', 'a1', 'a2', 'aR']) if (g[k]) transfer.push(g[k].buffer); if (g.idx) transfer.push(g.idx.buffer); if (g.inst) for (const a of Object.values(g.inst)) transfer.push(a.buffer); };
    add(out.bld);
    if (out.roads) add(out.roads);
    if (out.trees) transfer.push(out.trees.buffer);
    if (out.lamps) transfer.push(out.lamps.buffer);
    self.postMessage(out, transfer);
  }
};
