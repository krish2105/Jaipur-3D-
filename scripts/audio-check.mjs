// Verifies the procedural audio in a real browser (Chrome + Web Audio): the output level and spectrum of the master bus are measured with AnalyserNodes.
//  1. autoplay policy: without a gesture the context stays suspended; a click builds the graph and it runs
//  2. beds follow the simulation: quiet dawn vs noon vs night vs rain vs Diwali (band energies + rms)
//  3. spatialisation: a horn on the listener's right / left is louder in that ear
//  4. delays: a boom scheduled at 1.5 s and thunder at distance / 343 m/s start when they should
//  5. mute silences the master, unmute restores it
// Usage: node scripts/audio-check.mjs [--tier high]     (build first: npm run build). Exit code 1 on any failed check.
import { launch, startPreview } from './lib/browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const tier = args.tier || 'high';
const srv = await startPreview();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

async function open(extra = [], query = {}) {
  const browser = await launch(extra);
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const q = new URLSearchParams({ tier, pr: '1', ...query });
  await page.goto(srv.url + '?' + q, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__jaipurError || null);
  if (err) throw new Error(err);
  return { browser, page, logs };
}

try {
  // ---- 1. autoplay policy: the graph is only built after a real gesture
  {
    const s = await open(['--autoplay-policy=document-user-activation-required'], { t: '12' });
    const before = await s.page.evaluate(() => { const a = window.__jaipur; return { has: !!a.audio, ctx: !!a.audio && !!a.audio.ctx, enabled: !!a.audio && a.audio.enabled }; });
    check(before.has && !before.ctx && !before.enabled, `no AudioContext before a gesture (${JSON.stringify(before)})`);
    await s.page.mouse.click(300, 200);
    await s.page.waitForTimeout(600);
    const after = await s.page.evaluate(() => { const a = window.__jaipur.audio; return { enabled: a.enabled, state: a.ctx && a.ctx.state, sr: a.ctx && a.ctx.sampleRate, engines: a.engines && a.engines.length }; });
    check(after.enabled && after.state === 'running', `a click builds the graph and the context runs (${JSON.stringify(after)})`);
    await s.page.keyboard.press('m');
    const muted = await s.page.evaluate(() => window.__jaipur.audio.muted);
    await s.page.keyboard.press('m');
    const unmuted = await s.page.evaluate(() => !window.__jaipur.audio.muted);
    check(muted && unmuted, 'the M key toggles mute');
    await s.browser.close();
  }

  // ---- 2..5 with a running context (autoplay allowed by the harness flag)
  const s = await open([], { audio: '1', shot: '1', t: '12' });
  await s.page.mouse.click(300, 200);
  const ready = await s.page.evaluate(async () => { const a = window.__jaipur; a.audio.enable(); for (let i = 0; i < 50 && a.audio.ctx.state !== 'running'; i++) await new Promise((r) => setTimeout(r, 100)); return a.audio.ctx.state; });
  check(ready === 'running', 'context running in the harness browser: ' + ready);

  // measurement helpers live in the page
  await s.page.evaluate(() => {
    const a = window.__jaipur, au = a.audio, ctx = au.ctx;
    const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; au.master.connect(an);
    const sp = ctx.createChannelSplitter(2), anL = ctx.createAnalyser(), anR = ctx.createAnalyser(); anL.fftSize = anR.fftSize = 2048;
    au.master.connect(sp); sp.connect(anL, 0); sp.connect(anR, 1);
    const rmsOf = (node) => { const b = new Float32Array(node.fftSize); node.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); };
    const bands = () => { const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f); const hz = ctx.sampleRate / an.fftSize; const e = (lo, hi) => { let s = 0; for (let i = Math.floor(lo / hz); i < Math.min(f.length, Math.ceil(hi / hz)); i++) s += Math.pow(10, f[i] / 10); return s; }; return { low: e(20, 200), mid: e(200, 2000), high: e(2000, 9000) }; };
    window.__m = {
      an, anL, anR, rmsOf, bands,
      // beds and engines carry scheduled (setTargetAtTime) automation from the app's frames: cancel it, or a plain .value assignment is overridden
      silence() { const t = ctx.currentTime; for (const g of [...Object.values(au.layers), ...au.engines.map((e) => e.g)]) { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, t); } },
      level(v) { const t = ctx.currentTime; for (const g of Object.values(au.layers)) { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(v, t); } },
      // run the app's audio update for `sec` real seconds and return the average master rms and band energies
      async run(sec, tick = () => {}) { let n = 0, r = 0; const b = { low: 0, mid: 0, high: 0 }; const t0 = performance.now(); while (performance.now() - t0 < sec * 1000) { tick(); au.frame(0.11, a); await new Promise((res) => setTimeout(res, 100)); if (performance.now() - t0 > 1500) { r += rmsOf(an); const bb = bands(); b.low += bb.low; b.mid += bb.mid; b.high += bb.high; n++; } } return { rms: r / Math.max(1, n), low: b.low / Math.max(1, n), mid: b.mid / Math.max(1, n), high: b.high / Math.max(1, n), voices: au.voices }; },
    };
  });
  const scenario = (name, setup, sec = 5) => s.page.evaluate(async ([setup, sec]) => {
    const a = window.__jaipur;
    await (new Function('a', 'return (async()=>{' + setup + '})()'))(a);
    a.life && a.life.teleport(a); await a.city.settle(a.camera, 90000); if (a.life) await a.life.run(a, 90);
    a.renderStill(2); // the harness does not run the app loop: refresh the sky / environment and the street-life culling the audio reads
    a.audio.setMuted(false);
    return window.__m.run(sec, () => {});
  }, [setup, sec]);
  const street = `a.setView([140, a.hf.heightAt(140,100)+2.4, 100], [10, a.hf.heightAt(10,100)+3, 100], 66);`;
  const R = {};
  R.noon = await scenario('noon bazaar', `a.setDate(2026,10,20,12.5); a.setWeather('clear', true); a.setFestival('off',{moveClock:false}); ${street}`);
  R.dawn = await scenario('dawn', `a.setDate(2026,10,20,5.8); a.setWeather('clear', true); ${street}`);
  R.night = await scenario('night', `a.setDate(2026,10,20,23.2); a.setWeather('clear', true); ${street}`);
  R.rain = await scenario('monsoon rain', `a.setDate(2026,10,20,15); a.setWeather('monsoon', true); a.weather.s.rain = 1; a.weather.s.wetness = 1; ${street}`);
  R.loo = await scenario('dust storm', `a.setDate(2026,10,20,15); a.setWeather('loo', true); ${street}`);
  R.diwali = await scenario('Diwali night', `a.setWeather('clear', true); a.setDate(2026,11,8,21.2); a.setFestival('diwali',{moveClock:false}); a.festival.strength = 1; ${street}`, 6);
  R.drone = await scenario('drone at 400 m', `a.setDate(2026,10,20,12.5); a.setWeather('clear', true); a.setFestival('off',{moveClock:false}); a.setView([-100, a.hf.heightAt(-100,900)+420, 900],[-100, a.hf.heightAt(-100,0), 0], 55);`);
  const f = (x) => x.toExponential(2);
  for (const [k, v] of Object.entries(R)) console.log(`   ${k.padEnd(7)} rms ${v.rms.toFixed(4)}  low ${f(v.low)}  mid ${f(v.mid)}  high ${f(v.high)}  voices ${v.voices}`);
  check(Object.values(R).every((v) => Number.isFinite(v.rms) && v.rms > 1e-4), 'every scenario produces audible output (rms > 1e-4)');
  check(Object.values(R).every((v) => v.rms < 0.9), 'nothing clips (rms < 0.9)');
  check(R.rain.high > R.noon.high * 2, `rain raises the high band (hiss/patter): ${f(R.rain.high)} vs ${f(R.noon.high)}`);
  check(R.night.high > R.noon.high * 0.5 || R.night.mid < R.noon.mid, 'night is different from noon: less murmur or more insect band');
  check(R.night.mid < R.noon.mid, `the bazaar murmur is quieter at 23:00 than at noon: ${f(R.night.mid)} vs ${f(R.noon.mid)}`);
  check(R.loo.low > R.noon.low, `the dust storm's wind adds low-band energy: ${f(R.loo.low)} vs ${f(R.noon.low)}`);
  check(R.drone.mid < R.noon.mid, `at 400 m the street murmur thins out: ${f(R.drone.mid)} vs ${f(R.noon.mid)}`);
  // measured ratio is ~2x: events are sporadic, so the averaged low band only rises moderately (the voice count below is the sharper test)
  check(R.diwali.low > R.night.low * 1.5, `Diwali night has the drum / cracker thumps an ordinary night lacks (low band): ${f(R.diwali.low)} vs ${f(R.night.low)}`);
  check(R.diwali.voices >= 3, `Diwali night runs several spatial voices (crackers, drums, engines): ${R.diwali.voices}`);

  // ---- 3. spatialisation: horn on the right vs the left
  await s.page.evaluate(async () => { const a = window.__jaipur; a.setDate(2026, 10, 20, 12.5); a.setWeather('clear', true); a.setFestival('off', { moveClock: false }); a.setView([140, a.hf.heightAt(140, 100) + 2.4, 100], [10, a.hf.heightAt(10, 100) + 3, 100], 66); a.camera.updateMatrixWorld(true); a.renderStill(2); await new Promise((r) => setTimeout(r, 300)); });
  const pan = await s.page.evaluate(async () => {
    const a = window.__jaipur, au = a.audio, e = a.camera.matrixWorld.elements, cam = a.camera.position, m = window.__m;
    au.setMuted(false);
    m.silence(); await new Promise((r) => setTimeout(r, 300)); // beds off so only the horn is measured
    const measure = async (side) => {
      const rx = e[0], rz = e[2]; // camera right vector
      let pl = 0, pr = 0;
      for (let k = 0; k < 3; k++) {
        au.horn(cam.x + side * rx * 12, cam.y, cam.z + side * rz * 12, 1);
        const t0 = performance.now();
        while (performance.now() - t0 < 500) { const L = m.rmsOf(m.anL), Rr = m.rmsOf(m.anR); pl = Math.max(pl, L); pr = Math.max(pr, Rr); await new Promise((r) => setTimeout(r, 20)); }
      }
      return { l: pl, r: pr };
    };
    const right = await measure(1), left = await measure(-1);
    return { right, left };
  });
  check(pan.right.r > pan.right.l * 1.15 && pan.left.l > pan.left.r * 1.15, `a horn on the right is louder in the right ear, on the left in the left ear (R: L ${pan.right.l.toFixed(4)} / R ${pan.right.r.toFixed(4)}; L: L ${pan.left.l.toFixed(4)} / R ${pan.left.r.toFixed(4)})`);

  // ---- 4. delays: a boom scheduled at +1.5 s, thunder at distance / 343
  const delays = await s.page.evaluate(async () => {
    const a = window.__jaipur, au = a.audio, cam = a.camera.position, m = window.__m;
    m.silence(); await new Promise((r) => setTimeout(r, 300));
    const onset = async (fire, maxSec, thr) => {
      const base = (() => { let mx = 0; for (let i = 0; i < 6; i++) mx = Math.max(mx, m.rmsOf(m.an)); return mx; })();
      const t0 = performance.now(); fire();
      while (performance.now() - t0 < maxSec * 1000) { if (m.rmsOf(m.an) > Math.max(thr, base * 4)) return (performance.now() - t0) / 1000; await new Promise((r) => setTimeout(r, 10)); }
      return null;
    };
    const boomT = await onset(() => au.boom(cam.x + 20, cam.y + 60, cam.z, 1.5), 4, 0.004);
    // one bolt at 800 m (r = 0): thunder must arrive after 800 / 343 = 2.33 s
    await new Promise((r) => setTimeout(r, 2500));
    a.weather.bolts.length = 0; a.weather.strikeNow(0);
    const bolt = a.weather.bolts[a.weather.bolts.length - 1];
    au._boltSeen = bolt.id - 1;
    const thT = await onset(() => au.thunder(bolt, cam), 8, 0.004);
    return { boomT, thT, dist: bolt.dist, expect: bolt.dist / 343 };
  });
  check(delays.boomT !== null && Math.abs(delays.boomT - 1.5) < 0.35, `a boom scheduled at +1.5 s is heard at ${delays.boomT && delays.boomT.toFixed(2)} s`);
  check(delays.thT !== null && Math.abs(delays.thT - delays.expect) < 0.6, `thunder from ${delays.dist.toFixed(0)} m is heard after ${delays.thT && delays.thT.toFixed(2)} s (distance / 343 m/s = ${delays.expect.toFixed(2)} s)`);

  // ---- 5. mute
  const mute = await s.page.evaluate(async () => {
    const a = window.__jaipur, au = a.audio, m = window.__m;
    m.level(0.2);
    au.setMuted(false); await new Promise((r) => setTimeout(r, 600));
    const on = m.rmsOf(m.an);
    au.setMuted(true); await new Promise((r) => setTimeout(r, 700));
    const off = m.rmsOf(m.an);
    au.setMuted(false); await new Promise((r) => setTimeout(r, 700));
    const back = m.rmsOf(m.an);
    return { on, off, back };
  });
  check(mute.on > 0.003 && mute.off < mute.on * 0.02 && mute.back > mute.on * 0.5, `mute silences the master and unmute restores it (on ${mute.on.toFixed(4)}, muted ${mute.off.toFixed(5)}, back ${mute.back.toFixed(4)})`);

  console.log(s.logs.length ? 'console problems:\n' + s.logs.slice(0, 10).join('\n') : 'no console problems');
  check(s.logs.length === 0, 'no console errors or warnings');
  await s.browser.close();
} catch (e) {
  console.error('audio check crashed:', e);
  failed++;
} finally {
  srv.stop();
}
console.log(failed ? `\nFAIL: ${failed} audio check(s) failed` : '\nOK: audio checks passed');
process.exit(failed ? 1 : 0);
