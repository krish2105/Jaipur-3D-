// Enforces the per-tier hard budgets in src/core/budgets.js (draw calls, triangles, texture MB, geometries, instances).
// The numbers are GPU-independent (renderer.info of a rendered frame, estimated texture bytes, instance counts), so this gate means
// the same thing on a laptop GPU and in a software-rendering sandbox. Each tier is driven to its WORST representative views
// (dense street level, high drone over the centre, a landmark close-up) and the maximum per metric is compared with the budget.
// Usage: node scripts/check-budgets.mjs [--tier low,medium,high] [--view street-diwali,drone-high] [--by] [--json out.json]   (build first: npm run build)
// --view runs only the named views (a partial run is for tuning, the gate is the full run); --by prints the instance counts per mesh for every view
import { writeFileSync } from 'node:fs';
import { TIERS, TIER_ORDER } from '../src/core/budgets.js';
import { openSession } from './lib/session.mjs';
import { SPOT_JS } from './lib/festival-spot.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const tiers = args.tier ? args.tier.split(',') : TIER_ORDER;
const onlyViews = args.view ? args.view.split(',') : null;
// world metres: x east, z south, origin Badi Chaupar. [label, eye(x,z), look(x,z), eyeHeightAboveGround, fov]
const VIEWS = [
  ['street-johari', [-40, 300], [-40, 520], 2.5, 62],
  ['street-badi-chaupar', [30, 200], [30, 60], 2.5, 62],
  ['drone-centre', [-200, 900], [-150, -300], 140, 55],
  ['drone-high', [-100, 1500], [-100, 0], 420, 55],
  ['hawa-mahal', [150, 20], [40, -48], 6, 62],
  ['sky-only', [0, 0], [0, -4000], 40, 60],
  // the reflection pass re-renders the near scene: budget it in the worst wet case (heavy rain + a lightning strike + dust flow)
  ['street-monsoon', [140, 100], [10, 100], 2.6, 66, 'monsoon'],
  ['drone-monsoon', [-200, 900], [-150, -300], 140, 55, 'monsoon'],
  ['street-loo', [140, 100], [10, 100], 2.6, 66, 'loo'],
  // night / festival: lamps, strings, diyas, far glow, fireworks in the sky; kites in a Sankranti sky. 'spot' = the densest festival street of the real layout
  ['night-lamps', [-40, 300], [-40, 520], 2.5, 62, 'clear', { date: [2026, 10, 20, 20.5], festival: 'off' }],
  ['street-diwali', 'spot', 'spot', 2.6, 64, 'clear', { date: [2026, 11, 8, 20.4], festival: 'diwali', cam: 'street' }],
  ['drone-diwali', 'spot', 'spot', 190, 58, 'clear', { date: [2026, 11, 8, 20.9], festival: 'diwali', cam: 'drone', fireworks: true }],
  ['hawa-diwali', [150, 20], [40, -48], 6, 62, 'clear', { date: [2026, 11, 8, 20.6], festival: 'diwali' }],
  ['street-kites', 'spot', 'spot', 2.6, 72, 'winter', { date: [2027, 1, 14, 11], festival: 'sankranti', cam: 'kites' }],
];

const rows = [];
let failed = 0;
for (const tier of tiers) {
  const sess = await openSession({ w: 1280, h: 720, tier });
  try {
    const worst = { drawCalls: 0, triangles: 0, geometries: 0, textureMB: 0, instances: 0 };
    let detail = null;
    for (const view of VIEWS.filter((v) => !onlyViews || onlyViews.includes(v[0]))) {
      const [label, eye, look, eh, fov, wx = null, opts = null] = view;
      const res = await sess.page.evaluate(async ([eye, look, eh, fov, wx, opts, spotJs]) => {
        const a = window.__jaipur;
        a.setTime(15.5);
        a.setWeather(wx || 'clear', true);
        if (a.festival) a.setFestival('off', { moveClock: false });
        if (opts && opts.date) a.setDate(...opts.date);
        if (opts && opts.festival && a.festival) {
          a.setFestival(opts.festival, { moveClock: false });
          a.festival.strength = opts.festival === 'diwali' ? 1 : 0;
        }
        if (eye === 'spot') {
          const s = await (new Function('a', 'return (async()=>{' + spotJs + '})()'))(a);
          if (!s) throw new Error('no festival spot');
          const g0 = (x, z) => a.hf.heightAt(x, z);
          if (opts.cam === 'drone') { eye = [s.mx - s.tx * 260, s.mz - s.tz * 260]; look = [s.mx + s.tx * 200, s.mz + s.tz * 200]; }
          else { eye = [s.mx - s.tx * 16, s.mz - s.tz * 16]; look = [s.mx + s.tx * 60, s.mz + s.tz * 60]; }
          if (opts.cam === 'kites') { const w = a.weather.s; look = [eye[0] + Math.sin(w.windDir) * 120, eye[1] + Math.cos(w.windDir) * 120]; }
          void g0;
        }
        if (wx === 'monsoon') { a.weather.s.rain = 1; a.weather.s.wetness = 1; a.weather.s.puddles = 1; a.weather.strikeNow(0.4); }
        const g = (x, z) => a.hf.heightAt(x, z);
        a.setView([eye[0], g(eye[0], eye[1]) + eh, eye[1]], [look[0], g(look[0], look[1]) + (opts && opts.cam === 'kites' ? 75 : eh > 100 ? 0 : 8), look[1]], fov);
        if (opts && opts.festival === 'sankranti') a.festival.setKites(true, a); // re-seed the kites around the final camera position
        // street life must be measured where the camera is: re-seed the population around the view, let the worker run a little, then settle tiles
        if (a.life) { a.life.teleport(a); await a.life.run(a, 1); }
        await a.city.settle(a.camera, 90000);
        if (a.life) await a.life.run(a, 60);
        if (opts && opts.festival === 'sankranti') await a.festival.settle(a, 25); else if (a.festival) await a.festival.settle(a, 0);
        if (opts && opts.fireworks) {
          const fw = a.festival.fireworks, c = a.camera.position, f = a.camera.getWorldDirection(new (a.camera.position.constructor)());
          for (let j = 0; j < 8; j++) { const d = 300 + j * 90, sd = (j % 2 ? 1 : -1) * (40 + j * 25); fw.time = j * 0.3; fw.burst(c.x + f.x * d - f.z * sd, c.y + 150 + j * 20, c.z + f.z * d + f.x * sd, j % 4, [[1, .62, .18], [1, .1, .6], [.1, 1, .2], [.12, .3, 1]][j % 4]); }
          fw.time = 2.6; fw.uniforms.uT.value = 2.6;
        }
        a.renderStill(3);
        return a.resourceReport();
      }, [eye, look, eh, fov, wx, opts, SPOT_JS]);
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], res[k]);
      if (!detail || res.textureMB > detail.textureMB) detail = res;
      if (args.by) console.log(`     instances: ${JSON.stringify(res.instancesBy)}`);
      console.log(`  ${tier.padEnd(6)} ${label.padEnd(20)} draws ${String(res.drawCalls).padStart(4)}  tris ${(res.triangles / 1e6).toFixed(2)}M  geo ${String(res.geometries).padStart(3)}  tex ${res.textureMB} MB  inst ${res.instances}`);
    }
    const budget = TIERS[tier].budget;
    const checks = Object.keys(worst).map((k) => ({ k, value: worst[k], limit: budget[k], ok: worst[k] <= budget[k] }));
    for (const c of checks) if (!c.ok) failed++;
    rows.push({ tier, worst, budget, checks, textureTop: detail?.textureTop, instancesBy: detail?.instancesBy, consoleProblems: sess.logs.length });
    if (sess.logs.length) console.log('  console problems:\n   ' + sess.logs.slice(0, 8).join('\n   '));
  } finally {
    await sess.close();
  }
}

console.log('\ntier   metric       worst        budget    result');
for (const r of rows) for (const c of r.checks) console.log(`${r.tier.padEnd(6)} ${c.k.padEnd(12)} ${String(c.k === 'triangles' ? (c.value / 1e6).toFixed(2) + 'M' : c.value).padStart(9)}  ${String(c.k === 'triangles' ? (c.limit / 1e6).toFixed(2) + 'M' : c.limit).padStart(9)}    ${c.ok ? 'ok' : 'OVER BUDGET'}`);
for (const r of rows) { console.log(`\n${r.tier}: largest textures / targets: ${r.textureTop?.join(', ')}`); console.log(`${r.tier}: instances by mesh: ${JSON.stringify(r.instancesBy)}`); }
if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 1));
console.log(failed ? `\nFAIL: ${failed} budget line(s) exceeded` : '\nOK: all tiers within budget');
process.exit(failed ? 1 : 0);
