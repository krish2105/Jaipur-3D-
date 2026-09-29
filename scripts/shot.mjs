// Usage: node scripts/shot.mjs [--t 7.5] [--date 2026-11-08] [--weather clear] [--pos x,y,z] [--look x,y,z] [--fov 55]
//                              [--w 640] [--h 360] [--tier low|medium|high] [--out shots-tmp/x.png] [--eval "js"]
import { launch, startPreview } from './lib/browser.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const W = +(args.w || 640), H = +(args.h || 360);
const srv = await startPreview();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'log' || args.verbose) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const q = new URLSearchParams({ shot: '1', pr: '1' });
if (args.tier) q.set('tier', args.tier);
if (args.perf) q.set('perf', '1');
await page.goto(srv.url + '?' + q, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 90000 });
} catch { logs.push('[harness] timeout waiting for ready'); }
const err = await page.evaluate(() => window.__jaipurError || null);
if (err) console.log('APP ERROR', err);
else {
  const cfg = { t: args.t ? +args.t : null, date: args.date || null, weather: args.weather || null, pos: args.pos?.split(',').map(Number), look: args.look?.split(',').map(Number), fov: args.fov ? +args.fov : null, evalJs: args.eval || null, n: +(args.n || 2) };
  const res = await page.evaluate(async (c) => {
    const a = window.__jaipur;
    if (c.date) { const [y, m, d] = c.date.split('-').map(Number); a.setDate(y, m, d, c.t ?? 12); }
    else if (c.t !== null) a.setTime(c.t);
    if (c.weather) a.setWeather(c.weather, true);
    if (c.pos) a.setView(c.pos, c.look || [0, 30, 0], c.fov);
    if (c.evalJs) await (new Function('a', 'return (async()=>{' + c.evalJs + '})()'))(a);
    a.renderStill(c.n);
    return { info: a.perf.lastInfo, env: { sunAlt: +a.env.sunAlt.toFixed(1), moonAlt: +a.env.moonAlt.toFixed(1), illum: +a.env.moonIllum.toFixed(3), exposure: +a.env.exposure.toFixed(2) }, time: a.clock.dateISTString, tier: a.tierName };
  }, cfg);
  console.log(JSON.stringify(res));
}
await page.screenshot({ path: args.out || 'shots-tmp/shot.png' });
if (logs.length) console.log(logs.slice(0, 25).join('\n'));
await browser.close();
srv.stop();
process.exit(0);
