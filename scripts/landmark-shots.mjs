// Street-level and drone stills of every planned landmark (uses the running app's landmark plan, so it follows the data).
// Usage: node scripts/landmark-shots.mjs [--only hawa,jm,jal] [--w 1280] [--h 720] [--t 8.3] [--date 2026-10-20] [--tier high] [--out shots-tmp]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openSession } from './lib/session.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const W = +(args.w || 1280), H = +(args.h || 720);
const OUT = args.out || 'shots-tmp';
const only = args.only ? args.only.split(',') : null;
await mkdir(OUT, { recursive: true });

const sess = await openSession({ w: W, h: H, tier: args.tier || 'high', query: { t: args.t || '8.3' } });
try {
  const plan = await sess.page.evaluate(() => window.__jaipur.landmarkPlan.items.map((i) => ({ key: i.key, kind: i.kind, source: i.source, x: i.x, z: i.z, yaw: i.yaw, len: i.len, dep: i.dep, name: i.name || null })));
  console.log(`plan: ${plan.length} items`);
  for (const it of plan) console.log(`  ${it.key.padEnd(24)} ${it.kind.padEnd(10)} ${it.source.padEnd(8)} @ ${it.x.toFixed(1)}, ${it.z.toFixed(1)}`);
  // one hero of each kind (gates: the first three), unless --only names keys/kinds
  const pick = plan.filter((i) => (only ? only.includes(i.kind) || only.includes(i.key) : i.kind !== 'gate')).concat(plan.filter((i) => i.kind === 'gate' && (!only || only.includes('gate'))).slice(0, only ? 6 : 2));
  for (const it of pick) {
    for (const mode of ['street', 'drone']) {
      const file = path.join(OUT, `lm-${it.key.replace(/[^a-z0-9]+/gi, '_')}-${mode}.png`);
      const info = await sess.shot({
        date: args.date || '2026-10-20', t: +(args.t || 8.3), file, out: file,
        eval: `
          const it = ${JSON.stringify(it)};
          const hf = a.hf, big = Math.max(it.len || 0, it.dep || 0, 45);
          // street: stand on the facade side (+z of the model = direction (sin yaw, cos yaw)), drone: further out and high
          const fx = Math.sin(it.yaw), fz = Math.cos(it.yaw);
          const D = ${'"' + 'mode' + '"'} === 'x' ? 0 : (${JSON.stringify(mode)} === 'street' ? Math.max(55, big * 1.5) : Math.max(140, big * 3.2));
          const px = it.x + fx * D, pz = it.z + fz * D;
          const g = hf.heightAt(px, pz);
          const ty = hf.heightAt(it.x, it.z);
          const eye = ${JSON.stringify(mode)} === 'street' ? g + 2.6 : g + Math.max(85, big * 1.4);
          const look = ${JSON.stringify(mode)} === 'street' ? [it.x, ty + Math.max(9, big * 0.3), it.z] : [it.x, ty + 4, it.z];
          a.setView([px, eye, pz], look, ${JSON.stringify(mode)} === 'street' ? 62 : 50);
          await a.city.settle(a.camera, 90000);
        `,
      });
      console.log(`${file}: draws ${info.info.drawCalls}, tris ${info.info.triangles}`);
    }
  }
  console.log('console problems:', sess.logs.length ? '\n' + sess.logs.slice(0, 20).join('\n') : 'none');
} finally {
  await sess.close();
}
process.exit(0);
