// SYNTHETIC TEST DISTRICT. NOT Jaipur. NOT real data.
// Generates an Overpass-`out geom`-shaped element list for a small imaginary bazaar quarter so that the renderer
// (facades, arcades, jharokhas, courtyards, roofs) can be developed and screenshot-tested while the real OSM data
// is unreachable. Used by tests and by the dev-only lab build (VITE_LAB=1); never baked into public/data.
import { unproject } from '../../src/core/geo.js';
import { mulberry32 } from '../../src/core/rng.js';

const ll = (x, z) => { const p = unproject(x, z); return { lat: p.lat, lon: p.lon }; };
const rect = (x, z, w, d) => [ll(x, z), ll(x + w, z), ll(x + w, z + d), ll(x, z + d), ll(x, z)];

export function syntheticDistrict(seed = 7) {
  const rnd = mulberry32(seed);
  const els = [];
  let id = 1000;
  const bld = (tags, geometry) => els.push({ type: 'way', id: id++, tags: { building: 'yes', ...tags }, geometry });

  // main bazaar street along x, z = 0 (18 m wide) and cross streets every 70 m
  els.push({ type: 'way', id: id++, tags: { highway: 'tertiary', name: 'Test Bazaar', lanes: '4' }, nodes: [1, 2], geometry: [ll(-260, 0), ll(260, 0)] });
  for (let x = -210; x <= 210; x += 70) {
    els.push({ type: 'way', id: id++, tags: { highway: 'residential', name: 'Test Gali ' + x }, nodes: [x + 5000, x + 6000], geometry: [ll(x, -150), ll(x, 150)] });
  }
  els.push({ type: 'way', id: id++, tags: { highway: 'residential', name: 'Ring Lane' }, nodes: [9001, 9002], geometry: [ll(-260, 100), ll(260, 100)] });
  els.push({ type: 'way', id: id++, tags: { highway: 'residential', name: 'Ring Lane N' }, nodes: [9003, 9004], geometry: [ll(-260, -100), ll(260, -100)] });
  els.push({ type: 'way', id: id++, tags: { highway: 'pedestrian', name: 'Test Chowk Path' }, nodes: [9005, 9006], geometry: [ll(60, -60), ll(140, -60)] });

  // terraced shopfront rows along both sides of the bazaar: 5.5-8 m frontage, 14 m deep
  for (const side of [-1, 1]) {
    let x = -250;
    while (x < 245) {
      const w = 5.5 + rnd() * 2.6;
      // leave the cross-street gaps
      const gap = [-210, -140, -70, 0, 70, 140, 210].some((cx) => x < cx + 4 && x + w > cx - 4);
      if (!gap) {
        const z0 = side < 0 ? -9 - 14 : 9;
        const tags = {};
        const r = rnd();
        if (r < 0.55) tags['building:levels'] = String(3 + Math.floor(rnd() * 2));
        else if (r < 0.7) tags.height = String(11 + Math.floor(rnd() * 5));
        if (rnd() < 0.15) tags.shop = 'jewelry';
        bld(tags, rect(x, z0, w, 14));
      }
      x += w;
    }
  }
  // back rows (untagged heights: exercise neighbourhood inference)
  for (const side of [-1, 1]) {
    let x = -250;
    while (x < 245) {
      const w = 6 + rnd() * 7;
      const gap = [-210, -140, -70, 0, 70, 140, 210].some((cx) => x < cx + 4 && x + w > cx - 4);
      if (!gap) bld({}, rect(x, side < 0 ? -50 : 25, w, 20 + rnd() * 10));
      x += w + 0.5;
    }
  }
  // courtyard haveli with an inner court (multipolygon relation)
  const hx = 90, hz = 30;
  els.push({
    type: 'relation', id: id++, tags: { type: 'multipolygon', building: 'yes', 'building:levels': '3', historic: 'yes', name: 'Test Haveli' },
    members: [
      { type: 'way', role: 'outer', ref: id++, geometry: rect(hx, hz, 42, 34) },
      { type: 'way', role: 'inner', ref: id++, geometry: rect(hx + 12, hz + 10, 18, 14) },
    ],
  });
  // temple with a dome next to a small plaza
  bld({ building: 'temple', name: 'Test Temple', 'roof:shape': 'dome', height: '13' }, rect(-120, 30, 16, 16));
  bld({ amenity: 'place_of_worship', building: 'mosque', 'roof:shape': 'dome', height: '15' }, rect(-100, -50, 14, 20));
  // a heritage block with a big flat roof (chhatris)
  bld({ historic: 'yes', name: 'Test Palace Block', height: '17' }, rect(160, -60, 60, 26));
  // scattered trees + lamps
  for (let x = -240; x <= 240; x += 30) {
    els.push({ type: 'node', id: id++, ...ll(x, 8.2), tags: { highway: 'street_lamp' } });
    els.push({ type: 'node', id: id++, ...ll(x + 12, -8.4), tags: { highway: 'street_lamp' } });
  }
  for (let i = 0; i < 24; i++) els.push({ type: 'node', id: id++, ...ll(-240 + rnd() * 480, (rnd() < 0.5 ? -1 : 1) * (26 + rnd() * 8)), tags: { natural: 'tree' } });
  return els;
}
