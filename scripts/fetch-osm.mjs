// Fetch OpenStreetMap data through the Overpass API, tile by tile, cached to data-raw/osm/ (git-ignored).
// Usage: node scripts/fetch-osm.mjs [zoneId ...]      (default: all zones)
//
// If every Overpass endpoint is refused by the network policy this script stops with the exact
// host(s) to allow. It NEVER substitutes other data.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RAW_DIR, BlockedDomainError } from './lib/net.mjs';
import { ZONES, buildQuery, splitBBox } from './lib/osm-zones.mjs';

const ENDPOINTS = (process.env.OVERPASS_ENDPOINTS
  ? process.env.OVERPASS_ENDPOINTS.split(',')
  : [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ]);
const OUT = path.join(RAW_DIR, 'osm');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Overpass answers 504/429 when its dispatcher is busy; that is transient, so the PRIMARY endpoint is retried
// with backoff before failing over. Mirrors are tried with a shorter timeout because some accept the connection
// and then stall (observed with overpass.private.coffee).
const PRIMARY = ENDPOINTS[0];
async function queryOnce(ep, ql, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(ep, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'jaipur-3d-bake/0.1 (static-site build-time data bake; contact via repo)' },
      body: 'data=' + encodeURIComponent(ql),
      signal: ctl.signal,
    });
    if (res.status === 403 || res.status === 407) return { blocked: `HTTP ${res.status}` };
    if ([429, 502, 503, 504].includes(res.status)) return { retry: `HTTP ${res.status}` };
    if (!res.ok) return { fail: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { return { retry: 'non-JSON body (server busy?): ' + text.slice(0, 120).replace(/\s+/g, ' ') }; }
    if (json.remark && /runtime error|timed out/i.test(json.remark)) return { retry: json.remark };
    return { json };
  } finally {
    clearTimeout(timer);
  }
}

async function query(ql) {
  const blocked = new Map();
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    const host = new URL(ep).host;
    const attempts = ep === PRIMARY ? 6 : 1;
    const timeoutMs = ep === PRIMARY ? 280_000 : 90_000;
    for (let a = 0; a < attempts; a++) {
      let r;
      try {
        r = await queryOnce(ep, ql, timeoutMs);
      } catch (e) {
        const cause = String(e?.cause?.message || e?.cause || e?.message || e);
        if (/403|407|tunnel|CONNECT/i.test(cause)) r = { blocked: cause };
        else r = { retry: cause };
      }
      if (r.json) return { json: r.json, host };
      if (r.blocked) { blocked.set(host, r.blocked); break; }
      lastErr = new Error(`${host}: ${r.retry || r.fail}`);
      if (r.fail) break;
      if (a < attempts - 1) { console.log(`  ${host}: ${r.retry}; retry ${a + 1}/${attempts - 1} in ${10 * (a + 1)}s`); await sleep(10_000 * (a + 1)); }
    }
  }
  if (blocked.size === ENDPOINTS.length) {
    const hosts = [...blocked.keys()];
    throw new BlockedDomainError(hosts.join(', '), [...blocked.values()][0]);
  }
  throw lastErr || new Error('Overpass query failed');
}

// A very dense tile can be too heavy for a busy Overpass dispatcher. On failure it is split into four quadrants (up to two
// levels deep) and the results are merged; elements that cross a sub-tile border appear twice and are de-duplicated by id.
async function fetchTile(z, bbox, label, depth = 0) {
  try {
    return await query(buildQuery(z.kind, bbox));
  } catch (e) {
    if (e.blocked || depth >= 2) throw e;
    console.log(`  ${z.id} ${label}: ${e.message}; splitting into 4 (level ${depth + 1})`);
    const [s, w, n, ea] = bbox, ms = (s + n) / 2, mw = (w + ea) / 2;
    const subs = [[s, w, ms, mw], [s, mw, ms, ea], [ms, w, n, mw], [ms, mw, n, ea]];
    const byKey = new Map();
    let host = null, osm3s = null;
    for (let k = 0; k < subs.length; k++) {
      const r = await fetchTile(z, subs[k], `${label}.${k}`, depth + 1);
      host = r.host;
      osm3s = r.json.osm3s || osm3s;
      for (const el of r.json.elements) byKey.set(`${el.type}/${el.id}`, el);
      await sleep(2500);
    }
    return { json: { osm3s, elements: [...byKey.values()] }, host };
  }
}

async function main() {
  const want = process.argv.slice(2);
  const zones = ZONES.filter((z) => !want.length || want.includes(z.id));
  await mkdir(OUT, { recursive: true });
  const meta = { fetchedAt: new Date().toISOString(), zones: {} };
  let n = 0, fromCache = 0;
  for (const z of zones) {
    const tiles = splitBBox(z.bbox, z.tileDeg);
    console.log(`zone ${z.id}: ${tiles.length} tile(s)`);
    meta.zones[z.id] = { bbox: z.bbox, tiles: tiles.length };
    for (const t of tiles) {
      const file = path.join(OUT, `${z.id}_${t.i}_${t.j}.json`);
      if (existsSync(file)) { fromCache++; continue; }
      const { json, host } = await fetchTile(z, t.bbox, t.i + ',' + t.j);
      await writeFile(file, JSON.stringify({ zone: z.id, tile: [t.i, t.j], bbox: t.bbox, endpoint: host, osm_base: json.osm3s?.timestamp_osm_base || null, elements: json.elements }));
      n++;
      meta.osmBase = json.osm3s?.timestamp_osm_base || meta.osmBase;
      console.log(`  ${z.id} ${t.i},${t.j}: ${json.elements.length} elements via ${host}`);
      await sleep(2500); // be polite
    }
  }
  await writeFile(path.join(OUT, '_fetch.json'), JSON.stringify(meta, null, 1));
  console.log(`done: ${n} fetched, ${fromCache} cached`);
}

main().catch((e) => {
  console.error('\nFETCH STOPPED:', e.message || e);
  if (e.blocked) console.error('Nothing was faked or substituted. Re-run `npm run fetch:osm` after the domain is allowed.');
  process.exit(e.blocked ? 2 : 1);
});
