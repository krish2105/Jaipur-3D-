// In-page helper (as a string for page.evaluate): the densest run of festival strings in the real OSM layout (a bazaar stretch with mapped facades on both sides).
// Returns { mx, mz, tx, tz, spans, dense, stats, hawa } : span midpoint, unit street direction, counts, layout stats and the planned Hawa Mahal item (or null).
export const SPOT_JS = `
  await a.festival.ready;
  const L = a.festival.layout;
  if (!L) return null;
  const sp = L.spans, n = sp.length / 8;
  let best = -1, bc = 0;
  for (let i = 0; i < n; i++) {
    const mx = (sp[i * 8] + sp[i * 8 + 3]) / 2, mz = (sp[i * 8 + 2] + sp[i * 8 + 5]) / 2;
    let c = 0;
    for (let j = 0; j < n; j++) if (Math.hypot((sp[j * 8] + sp[j * 8 + 3]) / 2 - mx, (sp[j * 8 + 2] + sp[j * 8 + 5]) / 2 - mz) < 70) c++;
    if (c > bc) { bc = c; best = i; }
  }
  if (best < 0) return null;
  const i = best;
  const ax = sp[i * 8], az = sp[i * 8 + 2], bx = sp[i * 8 + 3], bz = sp[i * 8 + 5];
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  let tx = -(bz - az), tz = bx - ax; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
  return { mx, mz, tx, tz, spans: n, dense: bc, stats: L.stats, hawa: a.landmarkPlan.items.find((k) => k.kind === 'hawa') || null };
`;
