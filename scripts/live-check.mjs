// Runs the app for real (no shot mode: the actual requestAnimationFrame loop, worker sim, dynamic resolution) and reports
// frame times, street-life counts and console problems. On a machine with a GPU this gives real fps numbers.
// Usage: [UNCAPPED=1] node scripts/live-check.mjs [--only street] [--q 'msaa=0&pr=1.5'] [--tier high] [--seconds 8] [--w 1600] [--h 900] [--dsf 2] [--weather clear] [--t 10.5]
import { launch, startPreview, CHROMIUM, GL_MODE } from './lib/browser.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const W = +(args.w || 1600), H = +(args.h || 900), SEC = +(args.seconds || 8);
const srv = await startPreview();
const browser = await launch();
const DSF = +(args.dsf || 1);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
// tour=0: measure the views below, not the cinematic tour that would otherwise start on load (--tour 1 measures the tour flight itself)
const q = new URLSearchParams({ perf: '1', tour: args.tour || '0' });
if (args.tier) q.set('tier', args.tier);
if (args.weather) q.set('weather', args.weather);
if (args.t) q.set('t', args.t);
if (args.festival) q.set('festival', args.festival);
if (args.off) q.set('off', args.off);
if (args.q) for (const kv of args.q.split('&')) { const [k, v] = kv.split('='); q.set(k, v ?? '1'); }
// --throttle N: slow the main thread N-fold (CDP), a rough stand-in for a mid-range phone CPU (the GPU is not throttled)
if (args.throttle) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: +args.throttle });
await page.goto(srv.url + '?' + q, { waitUntil: 'load' });
await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 120000 });
const err = await page.evaluate(() => window.__jaipurError || null);
if (err) { console.log('APP ERROR', err); await browser.close(); srv.stop(); process.exit(1); }
const views = [
  ['street (Badi Chaupar)', [140, 100, 2.6], [10, 100, 3]],
  ['bazaar road', [20, 250, 2.4], [20, 60, 3]],
  ['aerial over the Walled City', [-100, 500, 95], [-60, -300, 0]],
  ['high drone', [0, 1500, 420], [-100, -300, 0]],
];
console.log(`${CHROMIUM.split('/').slice(-3).join('/')}  GL_MODE=${GL_MODE}  viewport ${W}x${H} @${DSF}x  ${process.env.UNCAPPED === '1' ? 'UNCAPPED' : 'vsync'}  tier ${args.tier || 'auto'}`);
const only = args.only ? views.filter((v) => v[0].startsWith(args.only)) : views;
for (const [name, eye, look] of only) {
  await page.evaluate(([eye, look]) => {
    const a = window.__jaipur;
    a.setView([eye[0], a.hf.heightAt(eye[0], eye[1]) + eye[2], eye[1]], [look[0], a.hf.heightAt(look[0], look[1]) + look[2], look[1]], 62);
    a.life?.teleport(a);
    a.perf.n = 0; a.perf.i = 0; // restart the frame-time window
  }, [eye, look]);
  await page.waitForTimeout(2500); // tiles stream in, worker fills the area
  await page.evaluate(() => { const a = window.__jaipur; a.perf.n = 0; a.perf.i = 0; });
  await page.waitForTimeout(SEC * 1000);
  const r = await page.evaluate(() => {
    const a = window.__jaipur; const s = a.perf.stats();
    const cpu = Object.fromEntries(Object.entries(a.perf.cpu || {}).map(([k, v]) => [k, +v.toFixed(2)]));
    return { fps: +s.fps.toFixed(1), avg: +s.avgMs.toFixed(2), p95: +s.p95Ms.toFixed(2), max: +s.maxMs.toFixed(1), draws: a.perf.lastInfo.drawCalls, tris: +(a.perf.lastInfo.triangles / 1e6).toFixed(2), dpr: +a.pixelRatio.toFixed(2), tier: a.tierName, life: a.life ? { ...a.life.stats, worker: undefined } : null, cpu, cpuTotal: +a.perf.cpuTotal().toFixed(2), gpu: a.detected.info.gpu };
  });
  console.log(`${name.padEnd(30)} ${String(r.fps).padStart(5)} fps  avg ${r.avg} ms  p95 ${r.p95}  max ${r.max}  draws ${r.draws}  tris ${r.tris}M  pixelRatio ${r.dpr}  life ${JSON.stringify(r.life)}`);
  if (args.cpu) console.log(`   main-thread ms per frame: total ${r.cpuTotal}  ${Object.entries(r.cpu).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
}
const gpu = await page.evaluate(() => window.__jaipur.detected.info.gpu);
console.log('GPU:', gpu);
console.log(logs.length ? 'console problems:\n' + logs.slice(0, 15).join('\n') : 'no console problems');
await browser.close();
srv.stop();
process.exit(0);
