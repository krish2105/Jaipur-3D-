// Task A stills: the real Walled City at street level and from above (Badi Chaupar, Johari Bazaar, Hawa Mahal Road, aerial, Aravalli view).
import { mkdir } from 'node:fs/promises';
import { openSession } from './lib/session.mjs';
const OUT = 'shots-tmp/taskA';
await mkdir(OUT, { recursive: true });
const sess = await openSession({ w: 1600, h: 900, tier: 'high', query: { t: '9.3' } });
// [name, eye[x,z], look[x,z], eyeHeight, lookHeight, fov, hour]
const shots = [
  ['badi-chaupar-from-south', [20, 260], [20, 100], 3.0, 6, 66, 9.3],
  ['badi-chaupar-square', [140, 100], [10, 100], 3.0, 5, 66, 9.3],
  ['johari-bazaar', [-30, 330], [-40, 560], 2.6, 6, 62, 9.3],
  ['johari-bazaar-aerial', [10, 130], [-100, 700], 70, 0, 60, 9.3],
  ['hawa-mahal-road', [95, 0], [40, -60], 3.0, 10, 66, 9.3],
  ['walled-city-aerial', [-200, 1300], [-150, -400], 330, 0, 58, 9.3],
  ['walled-city-golden', [-200, 1300], [-150, -400], 330, 0, 58, 17.4],
];
for (const [name, eye, look, eh, lh, fov, t] of shots) {
  const info = await sess.shot({ date: '2026-10-20', t, out: `${OUT}/${name}.png`, eval: `
    const eye=${JSON.stringify(eye)}, look=${JSON.stringify(look)};
    a.setView([eye[0], a.hf.heightAt(eye[0], eye[1]) + ${eh}, eye[1]], [look[0], a.hf.heightAt(look[0], look[1]) + ${lh}, look[1]], ${fov});
    await a.city.settle(a.camera, 120000);` });
  console.log(name.padEnd(28), `draws ${info.info.drawCalls} tris ${(info.info.triangles / 1e6).toFixed(2)}M`);
}
console.log(sess.logs.join('\n') || 'no console problems');
await sess.close(); process.exit(0);
