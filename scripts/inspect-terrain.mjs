// Dev helper: hillshade PNG of the baked near grid + elevation probes at known places.
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { project } from '../src/core/geo.js';
const man = JSON.parse(await readFile('public/data/terrain/manifest.json', 'utf8'));
const { size, chunks, chunkSize, halfM } = man.near;
const H = new Float32Array(size * size);
for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
  const b = await readFile(`public/data/terrain/near_${ci}_${cj}.bin`);
  const u = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  for (let j = 0; j < chunkSize; j++) for (let i = 0; i < chunkSize; i++) H[(cj * chunkSize + j) * size + ci * chunkSize + i] = u[j * chunkSize + i] / man.scale;
}
const texel = (2 * halfM) / size;
const at = (lat, lon) => { const p = project(lat, lon); const i = Math.round((p.x + halfM) / texel - 0.5), j = Math.round((p.z + halfM) / texel - 0.5); return { x: Math.round(p.x), z: Math.round(p.z), h: H[j * size + i] }; };
const probes = { origin: [26.9235, 75.8265], hawa: [26.9239, 75.8267], jantar: [26.9247, 75.8244], jalmahal: [26.9537, 75.8463], lakeN: [26.9600, 75.8440], amerFort: [26.9855, 75.8513], jaigarh: [26.9859, 75.8507], nahargarh: [26.9373, 75.8155], chandpole: [26.9245, 75.8125], surajpole: [26.9245, 75.8420] };
for (const [k, v] of Object.entries(probes)) console.log(k.padEnd(10), JSON.stringify(at(...v)));
// hillshade
const png = new PNG({ width: size, height: size });
for (let j = 1; j < size - 1; j++) for (let i = 1; i < size - 1; i++) {
  const dx = (H[j * size + i + 1] - H[j * size + i - 1]) / (2 * texel), dy = (H[(j + 1) * size + i] - H[(j - 1) * size + i]) / (2 * texel);
  const s = Math.max(0, Math.min(1, 0.55 + 6 * (dx * -0.6 + dy * -0.7)));
  const v = (H[j*size+i]-350)/300;
  const k = (j * size + i) * 4; png.data[k] = 255 * s * (0.6 + 0.4 * v); png.data[k + 1] = 235 * s * (0.6+0.4*v); png.data[k + 2] = 200 * s * (0.6+0.4*v); png.data[k + 3] = 255;
}
await writeFile('shots-tmp/terrain-hillshade.png', PNG.sync.write(png));
