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


const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** separable box blur, radius r (texels), edge-clamped */
function boxBlur(src, n, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[j * n + Math.max(0, Math.min(n - 1, k))];
    for (let i = 0; i < n; i++) {
      tmp[j * n + i] = acc / w;
      acc += src[j * n + Math.min(n - 1, i + r + 1)] - src[j * n + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.max(0, Math.min(n - 1, k)) * n + i];
    for (let j = 0; j < n; j++) {
      out[j * n + i] = acc / w;
      acc += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i];
    }
  }
  return out;
}

/**
 * SRTM is a surface model: buildings/trees leave +-several m of noise on the city plain.
 * Smooth it there only (low slope, low elevation, near the city); ridges and hills are left untouched.
 */
function smoothCityPlain(H, n, texel, half) {
  let B = H;
  for (let i = 0; i < 3; i++) B = boxBlur(B, n, 10);
  let changed = 0;
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const x = -half + (i + 0.5) * texel, z = -half + (j + 0.5) * texel;
      const d = Math.hypot(x, z);
      if (d > 3800) continue;
      const gx = (B[j * n + i + 1] - B[j * n + i - 1]) / (2 * texel), gz = (B[(j + 1) * n + i] - B[(j - 1) * n + i]) / (2 * texel);
      const slope = Math.hypot(gx, gz);
      const w = (1 - smoothstep(2400, 3800, d)) * (1 - smoothstep(0.03, 0.1, slope)) * (1 - smoothstep(465, 490, B[j * n + i]));
      if (w > 0.001) { H[j * n + i] += (B[j * n + i] - H[j * n + i]) * w; changed++; }
    }
  return changed;
}

/** Flood-fill the flat water body around (sx, sz): texels within tol of the lake level and locally flat. */
function lakeMask(H, n, texel, half, level, sx, sz) {
  const mask = new Uint8Array(n * n);
  const idx = (i, j) => j * n + i;
  const si = Math.round((sx + half) / texel - 0.5), sj = Math.round((sz + half) / texel - 0.5);
  const ok = (i, j) => {
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return false;
    const h = H[idx(i, j)];
    return Math.abs(h - level) < 0.35 && Math.abs(H[idx(i + 1, j)] - h) < 0.25 && Math.abs(H[idx(i, j + 1)] - h) < 0.25;
  };
  const stack = [[si, sj]];
  // seed: nearest ok texel to the start
  let found = false;
  for (let r = 0; r < 40 && !found; r++)
    for (let dj = -r; dj <= r && !found; dj++)
      for (let di = -r; di <= r && !found; di++) if (ok(si + di, sj + dj)) { stack.length = 0; stack.push([si + di, sj + dj]); found = true; }
  let count = 0;
  while (stack.length) {
    const [i, j] = stack.pop();
    if (!ok(i, j) || mask[idx(i, j)]) continue;
    mask[idx(i, j)] = 255;
    count++;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  return { mask, count };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const NEAR = { z: 13, halfM: 8000, size: 1024, chunks: 4 };
  const FAR = { z: 10, halfM: 36000, size: 512 };

  console.log('near grid');
  const near = await bakeGrid(NEAR);
  const smoothed = smoothCityPlain(near.out, NEAR.size, near.step, NEAR.halfM);
  console.log('  city plain smoothed texels:', smoothed);
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
  let lakeInfo = null;
  if (lakeMode) {
    const lm = lakeMask(near.out, NEAR.size, near.step, NEAR.halfM, +lakeMode[0], jm.x, jm.z);
    // bit-pack (1 bit / texel), row-major, LSB first
    const packed = Buffer.alloc(Math.ceil(NEAR.size * NEAR.size / 8));
    for (let k = 0; k < lm.mask.length; k++) if (lm.mask[k]) packed[k >> 3] |= 1 << (k & 7);
    await writeFile(path.join(OUT, 'lake.bits'), packed);
    total += packed.length;
    lakeInfo = { file: 'lake.bits', texels: lm.count, areaKm2: +(lm.count * near.step * near.step / 1e6).toFixed(2), format: '1 bit/texel, near-grid layout, LSB first' };
    console.log('  lake mask:', JSON.stringify(lakeInfo));
  }
  const manifest = {
    lake: lakeInfo,
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
