// Fixed-seed screenshot matrix: every time of day, every weather, both festival modes, every quality tier, through the same harness session
// (scripts/lib/session.mjs). Street life, kites and fireworks use fixed seeds, the sky is evaluated at an exact instant, tiles are awaited: the same command gives
// the same pictures. Each image is checked for sanity (not black, not flat, not blown out) and a determinism check re-renders one state and diffs it.
//   node scripts/screenshots.mjs [--tier high|medium|low|all] [--only id,id|group] [--out shots-tmp/matrix] [--readme] [--w 1280] [--h 720]
//   --readme also copies the curated set to docs/screenshots/ (small JPEGs that the README shows). Output: <out>/<tier>/<id>.jpg, index.html, matrix.json
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { openSession } from './lib/session.mjs';
import { SPOT_JS } from './lib/festival-spot.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const OUT = args.out || 'shots-tmp/matrix';
const W = +(args.w || 1280), H = +(args.h || 720);
const TIERS = !args.tier || args.tier === 'high' ? ['high'] : args.tier === 'all' ? ['high', 'medium', 'low'] : args.tier.split(',');
const only = args.only ? args.only.split(',') : null;
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const hh = (t) => pad2(t) + pad2(Math.round((t % 1) * 60));

// ---- the matrix ------------------------------------------------------------------------------------------------------------------------------
const DAY = [2026, 10, 24];
const TIMES = [[5.75, 'dawn'], [6.7, 'sunrise'], [9.0, 'morning'], [12.5, 'noon'], [16.9, 'golden'], [18.3, 'dusk'], [21.5, 'night']];
const S = [];
for (const [t, name] of TIMES) for (const view of ['street', 'hawa', 'aerial']) S.push({ id: `t${hh(t)}-${name}-${view}`, group: 'time', date: DAY, t, weather: 'clear', festival: 'off', view });
for (const wx of ['dust', 'loo', 'monsoon', 'winter']) for (const [t, name] of [[12.5, 'noon'], [18.3, 'dusk']]) for (const view of ['street', 'aerial']) S.push({ id: `wx-${wx}-${name}-${view}`, group: 'weather', date: wx === 'winter' ? [2027, 1, 14] : wx === 'monsoon' ? [2026, 8, 15] : DAY, t, weather: wx, festival: 'off', view });
S.push({ id: 'diwali-street', group: 'festival', date: [2026, 11, 8], t: 20.3, weather: 'clear', festival: 'diwali', view: 'fstreet' });
S.push({ id: 'diwali-aerial', group: 'festival', date: [2026, 11, 8], t: 20.9, weather: 'clear', festival: 'diwali', view: 'faerial' });
S.push({ id: 'diwali-fireworks', group: 'festival', date: [2026, 11, 8], t: 21.4, weather: 'clear', festival: 'diwali', view: 'fireworks' });
S.push({ id: 'diwali-hawa', group: 'festival', date: [2026, 11, 8], t: 20.6, weather: 'clear', festival: 'diwali', view: 'hawa' });
S.push({ id: 'kites-flyer', group: 'festival', date: [2027, 1, 14], t: 15.6, weather: 'winter', festival: 'sankranti', view: 'kites-flyer' });
S.push({ id: 'kites-street', group: 'festival', date: [2027, 1, 14], t: 11, weather: 'winter', festival: 'sankranti', view: 'kites-street' });
S.push({ id: 'kites-aerial', group: 'festival', date: [2027, 1, 14], t: 16.4, weather: 'winter', festival: 'sankranti', view: 'aerial' });
// medium / low run a representative subset
const SUBSET = ['t1230-noon-street', 't1818-dusk-aerial', 't2130-night-street', 'wx-monsoon-dusk-street', 'diwali-street', 'kites-flyer'];
// curated set that the README shows
const README = { 't0642-sunrise-hawa': 'hawa-sunrise', 't1230-noon-street': 'street-noon', 't1654-golden-aerial': 'aerial-golden', 'wx-monsoon-dusk-street': 'monsoon-dusk', 'wx-loo-noon-aerial': 'dust-storm', 't2130-night-hawa': 'hawa-night', 'diwali-street': 'diwali-street', 'diwali-fireworks': 'diwali-fireworks', 'kites-flyer': 'kites' };

// ---- in-page camera / state scripts ----------------------------------------------------------------------------------------------------------
const SPOT = `const spot = await (async () => {${SPOT_JS}})();`;
function script(st) {
  const fest = `a.setFestival('${st.festival}', { moveClock: false }); ${st.festival === 'diwali' ? 'a.festival.strength = 1;' : ''} if (a.festival) await a.festival.settle(a, ${st.festival === 'sankranti' ? 30 : 0});`;
  const life = `a.life.teleport(a); await a.life.run(a, 1); await a.city.settle(a.camera, 120000); await a.life.run(a, 120);`;
  const g = 'const hf = a.hf;';
  switch (st.view) {
    case 'street': return `${fest} ${g} a.setView([140, hf.heightAt(140, 100) + 2.4, 100], [10, hf.heightAt(10, 100) + 3, 100], 66); ${life}`;
    case 'aerial': return `${fest} ${g} a.setView([-200, hf.heightAt(-200, 900) + 140, 900], [-150, hf.heightAt(-150, -300), -300], 55); await a.city.settle(a.camera, 120000); await a.life.run(a, 30);`;
    case 'hawa': return `${fest} ${g} const it = a.landmarkPlan.items.find((k) => k.kind === 'hawa'); const px = it.x + it.nx * 30 + it.ux * 16, pz = it.z + it.nz * 30 + it.uz * 16; a.setView([px, hf.heightAt(px, pz) + 3.5, pz], [it.x, hf.heightAt(it.x, it.z) + 9, it.z], 62); ${life}`;
    case 'fstreet': return `${fest} ${SPOT} ${g} const px = spot.mx - spot.tx * 16, pz = spot.mz - spot.tz * 16, lx = spot.mx + spot.tx * 60, lz = spot.mz + spot.tz * 60; a.setView([px, hf.heightAt(px, pz) + 2.6, pz], [lx, hf.heightAt(lx, lz) + 6, lz], 64); ${life}`;
    case 'faerial': return `${fest} ${SPOT} ${g} a.setView([spot.mx - spot.tx * 260, hf.heightAt(spot.mx, spot.mz) + 190, spot.mz - spot.tz * 260], [spot.mx + spot.tx * 200, hf.heightAt(spot.mx, spot.mz), spot.mz + spot.tz * 200], 58); await a.city.settle(a.camera, 120000);`;
    case 'fireworks': return `${fest} ${SPOT} ${g} const fw = a.festival.fireworks; fw.clear();
      a.setView([spot.mx - spot.tx * 30, hf.heightAt(spot.mx, spot.mz) + 3, spot.mz - spot.tz * 30], [spot.mx + spot.tx * 260, hf.heightAt(spot.mx, spot.mz) + 130, spot.mz + spot.tz * 260], 64); await a.city.settle(a.camera, 120000);
      const at = (d, h, side) => [spot.mx + spot.tx * d - spot.tz * side, hf.heightAt(spot.mx, spot.mz) + h, spot.mz + spot.tz * d + spot.tx * side];
      const C = [[1, 0.62, 0.18], [1, 0.1, 0.6], [0.1, 1, 0.2], [0.12, 0.3, 1], [1, 0.06, 0.04]];
      [[380, 200, -40, 0, 0], [520, 250, 120, 1, 1], [700, 300, -150, 2, 2], [450, 170, 200, 3, 3], [900, 320, 20, 0, 4]].forEach(([d, h, sd, k, c], j) => { const p = at(d, h, sd); fw.time = 0; fw.burst(p[0], p[1], p[2], k, C[c]); fw.time = 0.35 + j * 0.28; });
      fw.time = 1.9; fw.uniforms.uT.value = 1.9; for (const b of fw.bursts) b.t0 = 1;`;
    case 'kites-flyer': return `${fest} ${g} const v = a.festival.flyerView(); a.setView(v.pos, [v.look[0], v.look[1] - 8, v.look[2]], 70); ${life}`;
    case 'kites-street': return `${fest} ${g} const w = a.weather.s, px = -40, pz = 300; a.setView([px, hf.heightAt(px, pz) + 2.6, pz], [px + Math.sin(w.windDir) * 120, hf.heightAt(px, pz) + 78, pz + Math.cos(w.windDir) * 120], 72); a.festival.setKites(true, a); await a.festival.settle(a, 25); ${life}`;
    default: throw new Error('unknown view ' + st.view);
  }
}

// in-page image statistics on the WebGL canvas (needs preserveDrawingBuffer, which ?shot enables)
const METRICS = () => {
  const src = window.__jaipur.renderer.domElement, c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, 160, 90);
  const d = x.getImageData(0, 0, 160, 90).data;
  let s = 0, s2 = 0, hi = 0, lo = 0;
  const n = 160 * 90;
  for (let i = 0; i < n; i++) { const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; s += l; s2 += l * l; if (l > 0.97) hi++; if (l < 0.03) lo++; }
  const m = s / n;
  return { mean: +m.toFixed(4), std: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(4), clipped: +(hi / n).toFixed(4), dark: +(lo / n).toFixed(4), px: Array.from(d) };
};

const results = [];
let failed = 0;
for (const tier of TIERS) {
  const list = S.filter((st) => (tier === 'high' || SUBSET.includes(st.id)) && (!only || only.includes(st.id) || only.includes(st.group)));
  await mkdir(`${OUT}/${tier}`, { recursive: true });
  const sess = await openSession({ w: W, h: H, tier, query: { t: '12' } });
  try {
    await sess.page.evaluate(async () => { const a = window.__jaipur; if (a.festival) await a.festival.ready; });
    for (const st of list) {
      const file = `${OUT}/${tier}/${st.id}.jpg`;
      const info = await sess.shot({ date: `${st.date[0]}-${st.date[1]}-${st.date[2]}`, t: st.t, weather: st.weather, out: file, n: 3, eval: script(st) });
      const m = await sess.page.evaluate(METRICS);
      const bad = [];
      if (!(m.mean > 0.012)) bad.push('black');
      if (!(m.std > 0.012)) bad.push('flat');
      if (!(m.clipped < 0.35)) bad.push('blown out');
      if (![m.mean, m.std].every(Number.isFinite)) bad.push('NaN');
      if (bad.length) failed++;
      const row = { tier, id: st.id, group: st.group, sunAlt: info.sunAlt, moonAlt: info.moonAlt, moonIllum: info.illum, exposure: info.exposure, time: info.time, draws: info.info.drawCalls, tris: info.info.triangles, mean: m.mean, std: m.std, clipped: m.clipped, dark: m.dark, bad };
      results.push(row);
      console.log(`${tier.padEnd(6)} ${st.id.padEnd(30)} sun ${String(info.sunAlt).padStart(6)}  mean ${m.mean.toFixed(3)} std ${m.std.toFixed(3)} clip ${m.clipped.toFixed(3)}  draws ${String(info.info.drawCalls).padStart(3)} tris ${(info.info.triangles / 1e6).toFixed(2)}M  ${bad.length ? 'FAIL ' + bad.join(',') : 'ok'}`);
    }
    if (tier === TIERS[0] && (!only || only.includes('determinism'))) {
      // determinism: the same state rendered twice gives the same picture (street life off: its agents are re-seeded on every teleport)
      const st = S.find((s) => s.id === 't1230-noon-street');
      const grab = async () => { await sess.shot({ date: `${st.date[0]}-${st.date[1]}-${st.date[2]}`, t: st.t, weather: 'clear', out: `${OUT}/${tier}/_determinism.jpg`, n: 3, eval: script(st) + 'a.life.setDensity(0); a.life.frame(0.016, a);' }); return sess.page.evaluate(METRICS); };
      const a = await grab(), b = await grab();
      let diff = 0;
      for (let i = 0; i < a.px.length; i += 4) diff += (Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2])) / 3;
      diff /= a.px.length / 4;
      const ok = diff < 1.0;
      if (!ok) failed++;
      console.log(`determinism: two renders of ${st.id} differ by ${diff.toFixed(3)} / 255 on average  ${ok ? 'ok' : 'FAIL'}`);
      results.push({ tier, id: '_determinism', diff, ok });
    }
    if (sess.logs.length) { console.log('console problems:\n' + sess.logs.slice(0, 8).join('\n')); failed++; }
  } finally {
    await sess.close();
  }
}

// contact sheet + machine-readable results
const rows = results.filter((r) => r.id[0] !== '_');
const html = `<!doctype html><meta charset="utf-8"><title>Jaipur 3D screenshot matrix</title><style>body{background:#111;color:#ddd;font:12px ui-monospace,monospace;margin:16px}h2{margin:24px 0 8px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}figure{margin:0}img{width:100%;display:block;border:1px solid #333}figcaption{padding:3px 0;color:#9a9a9a}.bad{color:#f66}</style>
${TIERS.map((tier) => `<h2>${tier}</h2><div class="g">${rows.filter((r) => r.tier === tier).map((r) => `<figure><a href="${tier}/${r.id}.jpg"><img loading="lazy" src="${tier}/${r.id}.jpg"></a><figcaption>${r.id} · ${r.time} · sun ${r.sunAlt}° · draws ${r.draws} · ${(r.tris / 1e6).toFixed(2)}M tris ${r.bad.length ? `<span class="bad">${r.bad.join(',')}</span>` : ''}</figcaption></figure>`).join('')}</div>`).join('')}`;
await writeFile(`${OUT}/index.html`, html);
await writeFile(`${OUT}/matrix.json`, JSON.stringify(results, null, 1));
if (args.readme) {
  await mkdir('docs/screenshots', { recursive: true });
  let n = 0;
  for (const [id, name] of Object.entries(README)) { try { await copyFile(`${OUT}/high/${id}.jpg`, `docs/screenshots/${name}.jpg`); n++; } catch { console.log(`readme: ${id} not rendered (use --tier high without --only)`); } }
  console.log(`copied ${n} README screenshots to docs/screenshots/`);
}
console.log(`\n${rows.length} images -> ${OUT}/index.html` + (failed ? `\nFAIL: ${failed} problem(s)` : '\nOK: every image passed the sanity checks'));
process.exit(failed ? 1 : 0);
