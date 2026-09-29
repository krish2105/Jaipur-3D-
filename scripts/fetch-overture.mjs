// Fetch the Overture Maps building footprints that OpenStreetMap does not have, for the same zones as fetch:osm.
//   npm run fetch:overture         (needs `python3 -m pip install duckdb` once; network access to stac.overturemaps.org and the Overture S3 bucket)
// Steps: newest release from the STAC catalog -> the (few) parquet files whose bbox overlaps a zone -> DuckDB (scripts/lib/overture_query.py) -> data-raw/overture/buildings.jsonl
// Nothing is invented: if a host is unreachable this stops and says which one.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ZONES } from './lib/osm-zones.mjs';
import { RAW_DIR } from './lib/net.mjs';

const STAC = 'https://stac.overturemaps.org';
const OUT_DIR = path.join(RAW_DIR, 'overture');
// Only the full-detail core zone (Walled City + margin): the ring is low detail and would add ~10x the footprints for no visible gain.
const IDS = (process.argv[2] || 'core').split(',');
const USE = ZONES.filter((z) => IDS.includes(z.id));
if (!USE.length) { console.error(`unknown zone ids: ${IDS}`); process.exit(1); }

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`could not reach ${url}`);
}

const py = spawnSync('python3', ['-c', 'import duckdb; print(duckdb.__version__)'], { encoding: 'utf8' });
if (py.status !== 0) {
  console.error('DuckDB for Python is missing. Install it once with:  python3 -m pip install duckdb');
  process.exit(1);
}

const cat = await getJson(`${STAC}/catalog.json`).catch((e) => { console.error(`STOP: ${e.message} (host: stac.overturemaps.org)`); process.exit(1); });
const release = cat.links.filter((l) => l.rel === 'child').map((l) => l.title.split(' ')[0]).sort().pop();
console.log('newest Overture release:', release);
const coll = await getJson(`${STAC}/${release}/buildings/building/collection.json`);
const items = coll.links.filter((l) => l.rel === 'item').map((l) => l.href);
const zones = USE.map((z) => z.bbox);
const W = Math.min(...zones.map((z) => z[1])), S = Math.min(...zones.map((z) => z[0])), E = Math.max(...zones.map((z) => z[3])), N = Math.max(...zones.map((z) => z[2]));
const files = [];
for (let i = 0; i < items.length; i += 32) {
  const batch = await Promise.all(items.slice(i, i + 32).map((u) => getJson(u).catch(() => null)));
  for (const it of batch) if (it && it.bbox[0] <= E && it.bbox[2] >= W && it.bbox[1] <= N && it.bbox[3] >= S) files.push(Object.values(it.assets)[0].href);
}
console.log(`${files.length} of ${items.length} parquet files overlap the zones`);
if (!files.length) { console.error('STOP: no Overture file overlaps the zones'); process.exit(1); }
await mkdir(OUT_DIR, { recursive: true });
const fFiles = path.join(OUT_DIR, '_files.json'), fZones = path.join(OUT_DIR, '_zones.json'), out = path.join(OUT_DIR, 'buildings.jsonl');
await writeFile(fFiles, JSON.stringify(files));
await writeFile(fZones, JSON.stringify(zones));
const r = spawnSync('python3', ['scripts/lib/overture_query.py', '--files', fFiles, '--zones', fZones, '--out', out], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
if (r.status !== 0) { console.error('STOP: the DuckDB query failed (see above)'); process.exit(1); }
const stats = JSON.parse(r.stdout.trim().split('\n').pop());
const lic = {};
for (const line of (await readFile(out, 'utf8')).split('\n')) { if (!line) continue; const o = JSON.parse(line); const k = `${o.ds} | ${o.lic}`; lic[k] = (lic[k] || 0) + 1; }
console.log('dataset | licence of the kept footprints:', lic);
await writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify({ release, fetchedAt: new Date().toISOString(), zones: USE.map((z) => z.id), ...stats, sources: lic, license: 'ODbL-1.0 (Overture Maps buildings theme; includes OpenStreetMap, Microsoft, Google and Esri footprints)' }, null, 1));
console.log('done:', stats);
