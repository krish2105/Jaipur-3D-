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

async function query(ql) {
  const blocked = new Map();
  let lastErr = null;
  for (let round = 0; round < 3; round++) {
    for (const ep of ENDPOINTS) {
      const host = new URL(ep).host;
      if (blocked.has(host)) continue;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 300_000);
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'jaipur-3d-bake/0.1 (static-site build-time data bake; contact via repo)' },
          body: 'data=' + encodeURIComponent(ql),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (res.status === 403 || res.status === 407) { blocked.set(host, `HTTP ${res.status}`); continue; }
        if (res.status === 429 || res.status === 504 || res.status === 502) { lastErr = new Error(`${host}: HTTP ${res.status}`); await sleep(15000); continue; }
        if (!res.ok) { lastErr = new Error(`${host}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
        const json = await res.json();
        if (json.remark && /runtime error|timed out/i.test(json.remark)) { lastErr = new Error(`${host}: ${json.remark}`); continue; }
        return { json, host };
      } catch (e) {
        const cause = String(e?.cause?.message || e?.cause || e?.message || e);
        if (/403|407|tunnel|CONNECT/i.test(cause)) blocked.set(host, cause);
        else lastErr = new Error(`${host}: ${cause}`);
      }
    }
    if (blocked.size === ENDPOINTS.length) break;
    await sleep(5000 * (round + 1));
  }
  if (blocked.size === ENDPOINTS.length) {
    const hosts = [...blocked.keys()];
    throw new BlockedDomainError(hosts.join(', '), [...blocked.values()][0]);
  }
  throw lastErr || new Error('Overpass query failed');
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
      const { json, host } = await query(buildQuery(z.kind, t.bbox));
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
