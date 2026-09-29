import { launch, startPreview } from './lib/browser.mjs';
const srv = await startPreview();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto(srv.url + '?shot=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 90000 });
await page.addInitScript(() => { window.__fromHalf = (h) => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity); return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); }; });
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const a = window.__jaipur;
  const res = {};
  for (const [name, t] of [['noon', 12], ['goldenhr', 17.2], ['sunset', 17.75], ['civil-3', 18.0], ['civil-6', 18.2], ['naut-9', 18.4], ['naut-12', 18.6], ['astro-16', 18.85], ['night', 21]]) {
    a.setTime(t);
    a.renderStill(1);
    const w = a.sky.lutSize[0], h = a.sky.lutSize[1];
    const raw = new Uint16Array(w * h * 4);
    try { a.renderer.readRenderTargetPixels(a.sky.lutRT, 0, 0, w, h, raw); } catch (e) { return { err: String(e) }; }
    const buf = Float32Array.from(raw, (x) => window.__fromHalf(x));
    const px = (u, v) => { const i = Math.min(w - 1, Math.round(u * (w - 1))), j = Math.min(h - 1, Math.round(v * (h - 1))); const k = (j * w + i) * 4; return [buf[k], buf[k + 1], buf[k + 2]].map((x) => +x.toPrecision(3)); };
    // v = 0.5 + 0.5*sqrt(e/(pi/2)) -> elevations: zenith v=1; 45deg e=.785 -> v=.5+.5*sqrt(.5)=.854; 10deg e=.1745 -> v=.5+.5*sqrt(.111)=.667; 2deg -> v=.5+.5*sqrt(.0222)=.575
    res[name] = { sunAlt: +a.env.sunAlt.toFixed(1), zenith_away: px(1, 0.999), zenith_sun: px(0, 0.999), el45_away: px(1, 0.854), el10_away: px(1, 0.667), el2_away: px(1, 0.575), el10_sun: px(0.02, 0.667), el2_sun: px(0.02, 0.575), horizon: px(1, 0.505), sunTrans: a.env.sunTrans.map((x) => +x.toPrecision(3)), sunColor: [a.env.sunColor.r, a.env.sunColor.g, a.env.sunColor.b].map((x) => +x.toFixed(2)), expo: +a.env.exposure.toFixed(2) };
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.stop(); process.exit(0);
