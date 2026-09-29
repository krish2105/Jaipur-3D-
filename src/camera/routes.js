// Street routes for camera paths (pure): chain the graph edges that carry a street name into one ordered polyline, and find the densest stretch
// of festival strings. Everything comes from the OSM street graph / the festival layout; nothing is invented.

/**
 * @param {import('../sim/graph.js').StreetGraph} g
 * @param {RegExp} re street name pattern
 * @returns {Float32Array} flat [x, z, ...] polyline: the longest chain of connected edges whose name matches (empty when none)
 */
export function chainRoute(g, re) {
  const edges = [];
  for (let e = 0; e < g.edgeCount; e++) if (g.name[e] && re.test(g.name[e]) && g.car[e] !== undefined) edges.push(e);
  if (!edges.length) return new Float32Array(0);
  // adjacency by node inside the name-filtered subgraph
  const byNode = new Map();
  for (const e of edges) for (const n of [g.ea[e], g.eb[e]]) { let a = byNode.get(n); if (!a) byNode.set(n, (a = [])); a.push(e); }
  const seen = new Set();
  let best = null;
  // components (connected chains); walk each from an end point (degree 1) or any node when it is a loop
  for (const start of edges) {
    if (seen.has(start)) continue;
    const comp = [], stack = [start];
    seen.add(start);
    while (stack.length) {
      const e = stack.pop(); comp.push(e);
      for (const n of [g.ea[e], g.eb[e]]) for (const o of byNode.get(n)) if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
    const inComp = new Set(comp);
    // walk: begin at a node with a single edge in this component (else the first edge's a-node), then always take the longest unused continuation
    let startNode = null;
    for (const e of comp) for (const n of [g.ea[e], g.eb[e]]) if (byNode.get(n).filter((x) => inComp.has(x)).length === 1) { startNode = n; break; }
    if (startNode === null) startNode = g.ea[comp[0]];
    const used = new Set(), pts = [];
    let node = startNode, len = 0;
    for (;;) {
      const opts = byNode.get(node).filter((x) => inComp.has(x) && !used.has(x));
      if (!opts.length) break;
      opts.sort((a, b) => g.len[b] - g.len[a]);
      const e = opts[0];
      used.add(e);
      const fwd = g.ea[e] === node;
      const s0 = g.ptsStart[e], s1 = g.ptsStart[e + 1];
      if (fwd) for (let k = s0; k < s1; k++) pts.push(g.pts[k * 2], g.pts[k * 2 + 1]);
      else for (let k = s1 - 1; k >= s0; k--) pts.push(g.pts[k * 2], g.pts[k * 2 + 1]);
      len += g.len[e];
      node = fwd ? g.eb[e] : g.ea[e];
    }
    if (!best || len > best.len) best = { len, pts };
  }
  // drop consecutive duplicate points (shared nodes)
  const out = [];
  for (let i = 0; i < best.pts.length; i += 2) {
    const n = out.length;
    if (n && Math.abs(out[n - 2] - best.pts[i]) < 1e-3 && Math.abs(out[n - 1] - best.pts[i + 1]) < 1e-3) continue;
    out.push(best.pts[i], best.pts[i + 1]);
  }
  return Float32Array.from(out);
}

/** densest run of festival strings: { mx, mz, tx, tz, dense } (span midpoint, unit street direction, spans within 70 m) or null. spans: stride 8 (x0 y0 z0 x1 y1 z1 sag theme) */
export function densestSpot(spans) {
  const n = spans.length / 8;
  if (!n) return null;
  const mid = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { mid[i * 2] = (spans[i * 8] + spans[i * 8 + 3]) / 2; mid[i * 2 + 1] = (spans[i * 8 + 2] + spans[i * 8 + 5]) / 2; }
  let best = -1, bc = 0;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) if (Math.hypot(mid[j * 2] - mid[i * 2], mid[j * 2 + 1] - mid[i * 2 + 1]) < 70) c++;
    if (c > bc) { bc = c; best = i; }
  }
  const i = best;
  const ax = spans[i * 8], az = spans[i * 8 + 2], bx = spans[i * 8 + 3], bz = spans[i * 8 + 5];
  let tx = -(bz - az), tz = bx - ax;
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { mx: mid[i * 2], mz: mid[i * 2 + 1], tx, tz, dense: bc };
}
