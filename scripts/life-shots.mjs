// Street-life stills: agents are advanced by a burst of fixed steps in the worker, then rendered.
// Usage: node scripts/life-shots.mjs [--tier high] [--out shots-tmp/life]
import { mkdir } from 'node:fs/promises';
import { openSession } from './lib/session.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const OUT = args.out || 'shots-tmp/life';
await mkdir(OUT, { recursive: true });
const sess = await openSession({ w: 1600, h: 900, tier: args.tier || 'high', query: { t: '10.5' } });
// [name, hour, eye[x,z], look[x,z], eyeH, lookH, fov]
const VIEWS = [
  ['badi-chaupar', 10.8, [140, 100], [10, 100], 2.4, 3, 66],
  ['bazaar-street', 11.2, [20, 250], [20, 60], 2.2, 3, 62],
  ['hawa-mahal-road', 18.4, [95, 0], [40, -60], 2.6, 6, 66],
  ['aerial-morning', 9.5, [-100, 500], [-60, -300], 95, 0, 58],
  ['night-road', 22.3, [140, 100], [10, 100], 2.4, 3, 66],
];
for (const [name, hour, eye, look, eh, lh, fov] of VIEWS) {
  const info = await sess.shot({ date: '2026-10-20', t: hour, out: `${OUT}/${name}.png`, n: 3, eval: `
    a.setView([${eye[0]}, a.hf.heightAt(${eye[0]}, ${eye[1]}) + ${eh}, ${eye[1]}], [${look[0]}, a.hf.heightAt(${look[0]}, ${look[1]}) + ${lh}, ${look[1]}], ${fov});
    a.life.teleport(a); await a.life.run(a, 1);
    await a.city.settle(a.camera, 120000);
    await a.life.run(a, 150);` });
  const st = await sess.page.evaluate(() => { const l = window.__jaipur.life; return { ...l.stats, err: l.error }; });
  console.log(name.padEnd(18), 'draws', info.info.drawCalls, 'tris', (info.info.triangles / 1e6).toFixed(2) + 'M', JSON.stringify(st));
}
console.log(sess.logs.join('\n') || 'no console problems');
await sess.close(); process.exit(0);
