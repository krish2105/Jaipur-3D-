// Web Worker: plans the street lamps, festival strings / roofline lights / diyas and the rooftop anchors for kites from the baked OSM data,
// so the main thread never stalls. Input: graph + building chunks URLs; output: flat typed arrays (see layout.js).
import { StreetGraph } from '../sim/graph.js';
import { FootprintIndex } from './footprints.js';
import { planLamps, planFestival } from './layout.js';
import { chainRoute } from '../camera/routes.js';
import { HeightSampler, FlatSampler } from '../world/heightSampler.js';

async function json(url) {
  const r = await fetch(url);
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || !ct.includes('json')) return null;
  return r.json();
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'plan') return;
  try {
    const t0 = performance.now();
    const sampler = m.near ? new HeightSampler(m.near, m.nearN, m.nearHalf, m.far, m.farN, m.farHalf) : new FlatSampler(0);
    const gj = await json(m.graphUrl);
    if (!gj) { self.postMessage({ type: 'error', error: 'street graph unavailable' }); return; }
    const graph = new StreetGraph(gj);
    const fp = new FootprintIndex();
    await Promise.all(m.tiles.map(async ([ix, iz]) => {
      try { const c = await json(`${m.base}b_${ix}_${iz}.json`); if (c) fp.addChunk(c); } catch { /* a missing chunk just means fewer facades */ }
    }));
    const groundAt = (x, z) => sampler.heightAt(x, z);
    const lamps = planLamps(graph, { radius: m.lampRadius });
    const fest = planFestival(graph, fp, groundAt, { radius: m.festRadius });
    // rooftop anchors for kite flyers: real footprints near the walled city, big enough to stand on
    const roofs = [];
    for (const b of fp.roofs) if (b.area >= 40 && Math.hypot(b.x, b.z) < m.roofRadius) roofs.push(b.x, b.z, b.h, b.area);
    // camera routes along the main bazaars (real OSM street polylines) for the cinematic tour
    const routes = { johari: chainRoute(graph, /johari/i), tripolia: chainRoute(graph, /tripolia/i), chandpol: chainRoute(graph, /chandpol/i), bapu: chainRoute(graph, /bapu\s*baz/i) };
    const out = { type: 'plan', routes, lamps, bulbs: fest.bulbs, sources: fest.sources, spans: fest.spans, roofs: Float32Array.from(roofs), stats: { ...fest.stats, lamps: lamps.length / 3, roofs: roofs.length / 4, segments: fp.segmentCount, ms: Math.round(performance.now() - t0) } };
    self.postMessage(out, [out.lamps.buffer, out.bulbs.buffer, out.sources.buffer, out.spans.buffer, out.roofs.buffer, ...Object.values(routes).map((r) => r.buffer)]);
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.stack ? err.stack : err) });
  }
};
