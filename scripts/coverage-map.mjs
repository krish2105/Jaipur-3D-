// Top-down raster of the baked OSM data (buildings dark, roads light, gates/landmarks marked) for eyeballing data coverage.
// Usage: node scripts/coverage-map.mjs [--out shots-tmp/coverage.png] [--x0 -2200 --x1 2200 --z0 -2200 --z1 2200] [--m 2]
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const X0 = +(args.x0 ?? -2200), X1 = +(args.x1 ?? 2200), Z0 = +(args.z0 ?? -2200), Z1 = +(args.z1 ?? 2200), M = +(args.m ?? 2);
const W = Math.round((X1 - X0) / M), H = Math.round((Z1 - Z0) / M);
const dir = 'public/data/osm';
const img = new PNG({ width: W, height: H });
img.data.fill(240);
for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
const px = (x, z, c) => { const i = Math.round((x - X0) / M), j = Math.round((z - Z0) / M); if (i < 0 || j < 0 || i >= W || j >= H) return; const k = (j * W + i) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; };
function fillPoly(pts, c) {
  let zmin = 1e9, zmax = -1e9; for (const p of pts) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
  for (let z = Math.max(Z0, zmin); z <= Math.min(Z1, zmax); z += M) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = xs[k]; x <= xs[k + 1]; x += M) px(x, z, c);
  }
}
function line(a, b, c) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (M * 0.5)); for (let i = 0; i <= n; i++) px(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, c); }
const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
let nb = 0, nr = 0;
for (const f of files) {
  const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  if (f.startsWith('r_')) {
    const ox = j.t[0] * j.s, oz = j.t[1] * j.s;
    for (const w of j.w) { const col = /primary|secondary|tertiary/.test(w.c) ? [255, 170, 60] : /residential|living|service|unclassified/.test(w.c) ? [150, 150, 230] : [120, 200, 120]; for (let i = 0; i + 3 < w.p.length; i += 2) line([ox + w.p[i] / 10, oz + w.p[i + 1] / 10], [ox + w.p[i + 2] / 10, oz + w.p[i + 3] / 10], col); nr++; }
  }
}
for (const f of files) {
  const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  if (f.startsWith('b_')) {
    const ox = j.t[0] * j.s, oz = j.t[1] * j.s;
    for (const b of j.b) { const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([ox + b.p[i] / 10, oz + b.p[i + 1] / 10]); fillPoly(pts, b.wl ? [200, 0, 0] : b.k === 'her' ? [160, 40, 160] : [40, 40, 60]); nb++; }
  }
}
const man = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const mark = (x, z, c, r = 5) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) px(x + dx * M, z + dz * M, c); };
for (const g of man.gates) mark(g.x, g.z, [255, 0, 0], 4);
for (const [k, l] of Object.entries(man.landmarks)) if (['hawaMahal', 'jantarMantar', 'cityPalace', 'jalMahal'].includes(k) && l[0]) mark(l[0].x, l[0].z, [0, 160, 0], 6);
mark(0, 0, [0, 0, 255], 5); // Badi Chaupar origin
await mkdir(path.dirname(args.out || 'shots-tmp/coverage.png'), { recursive: true });
writeFileSync(args.out || 'shots-tmp/coverage.png', PNG.sync.write(img));
console.log(`coverage map ${W}x${H} @ ${M} m/px: ${nb} buildings, ${nr} road ways from ${files.length} chunks`);
