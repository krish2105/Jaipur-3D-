// Weather stills: same views under each weather preset (and extras set through --eval-style overrides).
// Usage: node scripts/weather-shots.mjs [--only monsoon,loo] [--out shots-tmp/weather] [--tier high]
import { mkdir } from 'node:fs/promises';
import { openSession } from './lib/session.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const OUT = args.out || 'shots-tmp/weather';
await mkdir(OUT, { recursive: true });
const sess = await openSession({ w: 1600, h: 900, tier: args.tier || 'high', query: { t: '17' } });
const WEATHER = (args.only || 'clear,dust,loo,monsoon').split(',');
// [name, eye, look, eyeH, lookH, fov, hour]
const VIEWS = [
  ['street', [140, 100], [10, 100], 2.6, 6, 66, 17.2],
  ['aerial', [-200, 1300], [-150, -400], 330, 0, 58, 17.2],
];
for (const wname of WEATHER) {
  for (const [vn, eye, look, eh, lh, fov, t] of VIEWS) {
    await sess.shot({ date: '2026-08-15', t, weather: wname, out: `${OUT}/${wname}-${vn}.png`, n: 6, eval: `
      const eye=${JSON.stringify(eye)}, look=${JSON.stringify(look)};
      a.setView([eye[0], a.hf.heightAt(eye[0], eye[1]) + ${eh}, eye[1]], [look[0], a.hf.heightAt(look[0], look[1]) + ${lh}, look[1]], ${fov});
      await a.city.settle(a.camera, 120000);` });
    console.log(wname.padEnd(8), vn);
  }
}
console.log(sess.logs.join('\n') || 'no console problems');
await sess.close(); process.exit(0);
