import { launch, startPreview } from './lib/browser.mjs';
const srv = await startPreview();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.addInitScript(() => { window.__fromHalf = (h) => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024); if (e === 0x1f) return NaN; return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024); }; });
await page.goto(srv.url + '?shot=1&pr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 90000 });
const out = await page.evaluate((mie) => {
  const a = window.__jaipur; const lu = a.sky.lutMat.uniforms;
  const w = a.sky.lutSize[0], h = a.sky.lutSize[1];
  const res = [];
  for (const alt of [5, 2, 0.7, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -12, -14, -16, -18, -20]) {
    lu.uSunElev.value = alt * Math.PI / 180; lu.uMieScale.value = mie; lu.uTwiGain.value = 1; lu.uDustTint.value.set(1, 1, 1); lu.uOvercast.value = 0;
    a.sky._blit(a.sky.lutMat, a.sky.lutRT);
    const raw = new Uint16Array(w * h * 4); a.renderer.readRenderTargetPixels(a.sky.lutRT, 0, 0, w, h, raw);
    const px = (u, v) => { const i = Math.min(w - 1, Math.round(u * (w - 1))), j = Math.min(h - 1, Math.round(v * (h - 1))); const k = (j * w + i) * 4; return [0, 1, 2].map((c) => window.__fromHalf(raw[k + c])); };
    const L = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    res.push({ alt, zen: L(px(1, 0.999)), el30: L(px(1, 0.8)), el10: L(px(1, 0.667)), hor: L(px(1, 0.52)) });
  }
  return res;
}, 20);
for (const r of out) console.log(String(r.alt).padStart(4), 'zen', r.zen.toExponential(2), 'el30', r.el30.toExponential(2), 'el10', r.el10.toExponential(2), 'hor', r.hor.toExponential(2));
await browser.close(); srv.stop(); process.exit(0);
