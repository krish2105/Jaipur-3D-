// One browser + preview server, many deterministic stills.
import { launch, startPreview } from './browser.mjs';

export async function openSession({ w = 640, h = 360, query = {}, tier } = {}) {
  const srv = await startPreview();
  let browser;
  try {
    browser = await launch();
  } catch (e) { srv.stop(); throw e; }
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 600)}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const q = new URLSearchParams({ shot: '1', pr: '1', ...query });
  if (tier) q.set('tier', tier);
  try {
    await page.goto(srv.url + '?' + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__jaipurError || null);
    if (err) throw new Error('app failed to start: ' + err);
  } catch (e) {
    await browser.close().catch(() => {});
    srv.stop();
    throw e;
  }
  return {
    page, logs,
    async setSize(W, H) { await page.setViewportSize({ width: W, height: H }); await page.evaluate(() => window.dispatchEvent(new Event('resize'))); },
    /** cfg: {t, date:'YYYY-MM-DD', weather, pos, look, fov, eval, n, out} */
    async shot(cfg) {
      const res = await page.evaluate(async (c) => {
        const a = window.__jaipur;
        if (c.date) { const [y, m, d] = c.date.split('-').map(Number); a.setDate(y, m, d, c.t ?? 12); } else if (c.t != null) a.setTime(c.t);
        if (c.weather) a.setWeather(c.weather, true);
        if (c.pos) a.setView(c.pos, c.look || [0, 30, 0], c.fov);
        if (c.eval) await (new Function('a', 'return (async()=>{' + c.eval + '})()'))(a);
        a.renderStill(c.n ?? 2);
        return { info: a.perf.lastInfo, sunAlt: +a.env.sunAlt.toFixed(1), moonAlt: +a.env.moonAlt.toFixed(1), illum: +a.env.moonIllum.toFixed(3), exposure: +a.env.exposure.toFixed(2), time: a.clock.dateISTString };
      }, cfg);
      await page.screenshot({ path: cfg.out });
      return res;
    },
    async close() { await browser.close(); srv.stop(); },
  };
}
