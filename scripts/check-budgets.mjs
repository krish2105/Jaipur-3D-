// Enforces the per-tier hard budgets in src/core/budgets.js (draw calls, triangles, texture MB, geometries, instances).
// The numbers are GPU-independent (renderer.info of a rendered frame, estimated texture bytes, instance counts), so this gate means
// the same thing on a laptop GPU and in a software-rendering sandbox. Each tier is driven to its WORST representative views
// (dense street level, high drone over the centre, a landmark close-up) and the maximum per metric is compared with the budget.
// Usage: node scripts/check-budgets.mjs [--tier low,medium,high] [--json out.json]   (build first: npm run build)
import { writeFileSync } from 'node:fs';
import { TIERS, TIER_ORDER } from '../src/core/budgets.js';
import { openSession } from './lib/session.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const tiers = args.tier ? args.tier.split(',') : TIER_ORDER;
// world metres: x east, z south, origin Badi Chaupar. [label, eye(x,z), look(x,z), eyeHeightAboveGround, fov]
const VIEWS = [
  ['street-johari', [-40, 300], [-40, 520], 2.5, 62],
  ['street-badi-chaupar', [30, 200], [30, 60], 2.5, 62],
  ['drone-centre', [-200, 900], [-150, -300], 140, 55],
  ['drone-high', [-100, 1500], [-100, 0], 420, 55],
  ['hawa-mahal', [150, 20], [40, -48], 6, 62],
  ['sky-only', [0, 0], [0, -4000], 40, 60],
];

const rows = [];
let failed = 0;
for (const tier of tiers) {
  const sess = await openSession({ w: 1280, h: 720, tier });
  try {
    const worst = { drawCalls: 0, triangles: 0, geometries: 0, textureMB: 0, instances: 0 };
    let detail = null;
    for (const [label, eye, look, eh, fov] of VIEWS) {
      const res = await sess.page.evaluate(async ([eye, look, eh, fov]) => {
        const a = window.__jaipur;
        a.setTime(15.5);
        const g = (x, z) => a.hf.heightAt(x, z);
        a.setView([eye[0], g(eye[0], eye[1]) + eh, eye[1]], [look[0], g(look[0], look[1]) + (eh > 100 ? 0 : 8), look[1]], fov);
        await a.city.settle(a.camera, 90000);
        a.renderStill(3);
        return a.resourceReport();
      }, [eye, look, eh, fov]);
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], res[k]);
      if (!detail || res.textureMB > detail.textureMB) detail = res;
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
