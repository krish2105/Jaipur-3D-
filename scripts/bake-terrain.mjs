// Downloads Terrarium elevation tiles (AWS Open Data, Mapzen; derived from SRTM and others),
// resamples them onto a true-metre grid in the app's local projection and writes quantised
// uint16 chunks:  public/data/terrain/{manifest.json, near_<i>_<j>.bin, far.bin}
//
// Height encoding: h16 = round(height_m * 20)  (0.05 m steps, max 3276 m)
// Layout: row-major, row 0 = NORTH edge (z = -half), column 0 = WEST edge (x = -half).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fetchBuffer } from './lib/net.mjs';
import { ORIGIN, project, unproject } from '../src/core/geo.js';

const OUT = path.resolve('public/data/terrain');
const HOSTS = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium', 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium'];
const SCALE = 20;

const tileXY = (lat, lon, z) => {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
};

async function fetchTile(z, x, y) {
  let err;
  for (const h of HOSTS) {
    try {
      const buf = await fetchBuffer(`${h}/${z}/${x}/${y}.png`, { cacheKey: `terrarium/${z}/${x}/${y}.png` });
      return PNG.sync.read(buf);
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

/** Build a Float32 mosaic of tiles covering [x0..x1]x[y0..y1] at zoom z. */
async function mosaic(z, x0, x1, y0, y1) {
  const w = (x1 - x0 + 1) * 256;
  const h = (y1 - y0 + 1) * 256;
  const data = new Float32Array(w * h);
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      jobs.push(
        fetchTile(z, tx, ty).then((png) => {
          for (let py = 0; py < 256; py++)
            for (let px = 0; px < 256; px++) {
              const i = (py * 256 + px) * 4;
              const e = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
              data[((ty - y0) * 256 + py) * w + (tx - x0) * 256 + px] = e;
            }
        }),
      );
  // modest concurrency
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8));
  return { data, w, h };
}

function sampleMosaic(m, z, x0, y0, lat, lon) {
  const t = tileXY(lat, lon, z);
  const fx = (t.x - x0) * 256 - 0.5;
  const fy = (t.y - y0) * 256 - 0.5;
  const ix = Math.max(0, Math.min(m.w - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(m.h - 2, Math.floor(fy)));
  const ax = Math.max(0, Math.min(1, fx - ix));
  const ay = Math.max(0, Math.min(1, fy - iy));
  const d = m.data;
  const a = d[iy * m.w + ix], b = d[iy * m.w + ix + 1], c = d[(iy + 1) * m.w + ix], e = d[(iy + 1) * m.w + ix + 1];
  return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay;
}

async function bakeGrid({ z, halfM, size }) {
  // tiles needed
  const nw = unproject(-halfM, -halfM), se = unproject(halfM, halfM);
  const a = tileXY(nw.lat, nw.lon, z), b = tileXY(se.lat, se.lon, z);
  const x0 = Math.floor(a.x) - 1, x1 = Math.floor(b.x) + 1, y0 = Math.floor(a.y) - 1, y1 = Math.floor(b.y) + 1;
  console.log(`  z${z}: tiles x ${x0}..${x1}, y ${y0}..${y1} (${(x1 - x0 + 1) * (y1 - y0 + 1)} tiles)`);
  const m = await mosaic(z, x0, x1, y0, y1);
  const out = new Float32Array(size * size);
  const step = (2 * halfM) / size;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = -halfM + (i + 0.5) * step;
      const zz = -halfM + (j + 0.5) * step;
      const ll = unproject(x, zz);
      out[j * size + i] = sampleMosaic(m, z, x0, y0, ll.lat, ll.lon);
    }
  return { out, step };
}

const toU16 = (f) => {
  const u = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) u[i] = Math.max(0, Math.min(65535, Math.round(f[i] * SCALE)));
  return u;
};

const bytes = (u16) => Buffer.from(u16.buffer, u16.byteOffset, u16.byteLength);

async function main() {
  await mkdir(OUT, { recursive: true });
  const NEAR = { z: 13, halfM: 8000, size: 1024, chunks: 4 };
  const FAR = { z: 10, halfM: 36000, size: 512 };

  console.log('near grid');
  const near = await bakeGrid(NEAR);
  console.log('far grid');
  const far = await bakeGrid(FAR);

  const stats = (f) => {
    let mn = 1e9, mx = -1e9, s = 0;
    for (const v of f) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
    return { min: +mn.toFixed(1), max: +mx.toFixed(1), mean: +(s / f.length).toFixed(1) };
  };

  // near grid chunked 4x4
  const cs = NEAR.size / NEAR.chunks;
  const nearU = toU16(near.out);
  let total = 0;
  for (let cj = 0; cj < NEAR.chunks; cj++)
    for (let ci = 0; ci < NEAR.chunks; ci++) {
      const chunk = new Uint16Array(cs * cs);
      for (let j = 0; j < cs; j++)
        for (let i = 0; i < cs; i++) chunk[j * cs + i] = nearU[(cj * cs + j) * NEAR.size + ci * cs + i];
      await writeFile(path.join(OUT, `near_${ci}_${cj}.bin`), bytes(chunk));
      total += chunk.byteLength;
    }
  const farU = toU16(far.out);
  await writeFile(path.join(OUT, 'far.bin'), bytes(farU));
  total += farU.byteLength;

  // Man Sagar Lake surface: SRTM water is flat, so take the modal value of perfectly-flat texels near Jal Mahal.
  const jm = project(26.9537, 75.8463);
  const hist = new Map();
  const N = NEAR.size, tx = near.step;
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const x = -NEAR.halfM + (i + 0.5) * tx, z = -NEAR.halfM + (j + 0.5) * tx;
      if (Math.hypot(x - jm.x, z - jm.z) > 1500) continue;
      const h = near.out[j * N + i];
      if (Math.abs(near.out[j * N + i + 1] - h) < 0.06 && Math.abs(near.out[(j + 1) * N + i] - h) < 0.06 && Math.abs(near.out[j * N + i - 1] - h) < 0.06) {
        const k = h.toFixed(1);
        hist.set(k, (hist.get(k) || 0) + 1);
      }
    }
  const lakeMode = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  const manifest = {
    lakeLevel: lakeMode ? +lakeMode[0] : null,
    lakeLevelNote: 'modal value of perfectly flat SRTM texels within 1.5 km of Jal Mahal (SRTM water bodies are flat)',
    format: 'uint16-le height*20 (m), row-major, row0=north, col0=west',
    scale: SCALE,
    origin: ORIGIN,
    source: 'Mapzen Terrarium tiles (AWS Open Data, s3.amazonaws.com/elevation-tiles-prod), derived from SRTM and other public sources',
    near: { halfM: NEAR.halfM, size: NEAR.size, chunks: NEAR.chunks, chunkSize: cs, texelM: near.step, zoom: NEAR.z, stats: stats(near.out) },
    far: { halfM: FAR.halfM, size: FAR.size, texelM: far.step, zoom: FAR.z, stats: stats(far.out) },
    bakedAt: new Date().toISOString(),
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('terrain baked:', (total / 1e6).toFixed(2), 'MB', JSON.stringify(manifest.near.stats), JSON.stringify(manifest.far.stats));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
