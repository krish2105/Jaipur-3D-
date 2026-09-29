// Verifies the camera rig, the cinematic tour and the compact UI in a real browser (desktop keyboard + mouse, and a touch phone via CDP touch events).
//   desktop: keys move the camera, terrain clamp holds, drag turns, walk keeps eye height, panels change the simulation, shortcuts work
//   tour:    every shot runs with the right date / weather / festival / height above ground, screenshots per shot, user input hands over to free-fly
//   phone:   touch stick moves, look drag turns, up / down buttons climb, tap targets >= 44 px, no horizontal overflow, panel fits the screen
// Usage: node scripts/ui-check.mjs [--tier high] [--out shots-tmp/ui]     (build first: npm run build). Exit code 1 on any failed check.
import { mkdir } from 'node:fs/promises';
import { launch, startPreview } from './lib/browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']] : a), []));
const OUT = args.out || 'shots-tmp/ui';
await mkdir(OUT, { recursive: true });
const srv = await startPreview();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const browser = await launch();

async function open(ctxOpts, query) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(srv.url + '?' + new URLSearchParams({ pr: '1', ...query }), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__jaipurReady || window.__jaipurError, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__jaipurError || null);
  if (err) throw new Error(err);
  return { ctx, page, logs };
}
const pose = (page) => page.evaluate(() => { const a = window.__jaipur, c = a.camera, g = a.hf.heightAt(c.position.x, c.position.z); const d = c.getWorldDirection(new c.position.constructor()); return { x: c.position.x, y: c.position.y, z: c.position.z, h: c.position.y - g, fx: d.x, fy: d.y, fz: d.z, yaw: a.rig.s.yaw, pitch: a.rig.s.pitch, mode: a.rig.mode, fov: c.fov }; });
const settle = (page) => page.evaluate(async () => { const a = window.__jaipur; await a.city.settle(a.camera, 60000); });

try {
  // ================= desktop =================
  const D = await open({ viewport: { width: 1280, height: 720 } }, { tier: 'high', tour: '0' });
  const p = D.page;
  await p.evaluate(() => { const a = window.__jaipur; a.setDate(2026, 10, 24, 11); a.setWeather('clear', true); a.goToView('badi'); });
  await settle(p);
  await p.waitForTimeout(500);
  check(await p.evaluate(() => document.querySelectorAll('#dock .dk').length) === 7, 'the dock has 7 buttons (camera, time, weather, traffic, festival, sound, quality)');
  check((await p.evaluate(() => document.getElementById('hud-time').textContent)).includes('IST'), 'the time readout shows IST');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page overflow on desktop');
  const credit = (page) => page.evaluate(() => { const el = document.getElementById('credit'), c = el.getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect(); return { top: c.top, bottom: c.bottom, dockBottom: d.bottom, ih: innerHeight, clipped: el.scrollWidth > el.clientWidth, text: [...el.querySelectorAll('span')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.textContent).join(' ') }; });
  const c1 = await credit(p);
  check(c1.bottom <= c1.ih && c1.top >= c1.dockBottom - 1 && !c1.clipped && /OpenStreetMap contributors/.test(c1.text) && /Mapzen\/Tilezen/.test(c1.text), `the attribution line is visible under the dock, not clipped: "${c1.text.slice(0, 60)}..."`);

  // keyboard: forward
  const p0 = await pose(p);
  await p.keyboard.down('w'); await p.waitForTimeout(900); await p.keyboard.up('w'); await p.waitForTimeout(250);
  const p1 = await pose(p);
  const mv = (p1.x - p0.x) * p0.fx + (p1.z - p0.z) * p0.fz;
  check(mv > 6, `W flies forward along the view (${mv.toFixed(1)} m in 0.9 s)`);
  // boost is faster
  await p.evaluate(() => window.__jaipur.goToView('badi')); await p.waitForTimeout(300);
  const b0 = await pose(p);
  await p.keyboard.down('Shift'); await p.keyboard.down('w'); await p.waitForTimeout(900); await p.keyboard.up('w'); await p.keyboard.up('Shift'); await p.waitForTimeout(250);
  const b1 = await pose(p);
  const mvb = Math.hypot(b1.x - b0.x, b1.z - b0.z);
  check(mvb > Math.hypot(p1.x - p0.x, p1.z - p0.z) * 1.6, `Shift boosts the speed (${mvb.toFixed(1)} m vs ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m)`);
  // up, then dive: terrain clamp
  await p.keyboard.down('e'); await p.waitForTimeout(800); await p.keyboard.up('e');
  const u1 = await pose(p);
  check(u1.h > b1.h + 4, `E climbs (${b1.h.toFixed(1)} -> ${u1.h.toFixed(1)} m above ground)`);
  await p.keyboard.down('q'); await p.waitForTimeout(3500); await p.keyboard.up('q'); await p.waitForTimeout(200);
  const q1 = await pose(p);
  check(q1.h >= 2.45 && q1.h < 3.2, `Q descends and the terrain clamp holds at 2.5 m (${q1.h.toFixed(2)} m)`);
  // mouse look
  const yaw0 = (await pose(p)).yaw;
  await p.mouse.move(640, 360); await p.mouse.down(); await p.mouse.move(840, 360, { steps: 8 }); await p.mouse.up();
  const yaw1 = (await pose(p)).yaw;
  check(yaw1 - yaw0 > 0.4 && yaw1 - yaw0 < 1.2, `dragging right turns right (${(yaw1 - yaw0).toFixed(2)} rad for 200 px)`);
  await p.mouse.move(640, 360); await p.mouse.down(); await p.mouse.move(640, 260, { steps: 6 }); await p.mouse.up();
  check((await pose(p)).pitch > 0.15, 'dragging up looks up');
  // walk mode keeps eye height
  await p.keyboard.press('g'); await p.waitForTimeout(200);
  await p.keyboard.down('w'); await p.waitForTimeout(1500); await p.keyboard.up('w'); await p.waitForTimeout(400);
  const w1 = await pose(p);
  check(w1.mode === 'walk' && Math.abs(w1.h - 1.7) < 0.35, `G switches to walking at eye height (${w1.h.toFixed(2)} m)`);
  await p.keyboard.press('f');
  check((await pose(p)).mode === 'fly', 'F returns to fly');

  // panels change the simulation
  await p.click('#dock .dk[data-key="time"]');
  check(await p.evaluate(() => !document.getElementById('panel').hidden), 'the Time button opens its panel');
  await p.evaluate(() => { const s = document.querySelector('#panel input[type=range]'); s.value = '19.5'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  check(Math.abs((await p.evaluate(() => window.__jaipur.clock.hours)) - 19.5) < 0.1, 'the time slider sets the sim time to 19:30');
  await p.screenshot({ path: `${OUT}/desktop-time-panel.png` });
  await p.click('#dock .dk[data-key="weather"]');
  await p.click('#panel .seg button:has-text("Monsoon")');
  check(await p.evaluate(() => window.__jaipur.weather.name) === 'monsoon', 'Weather > Monsoon sets the monsoon preset');
  await p.click('#dock .dk[data-key="traffic"]');
  await p.click('#panel .seg button:has-text("Off")');
  check(await p.evaluate(() => window.__jaipur.life.enabled === false), 'Traffic > Off switches street life off');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => window.__jaipur.life.stats.veh === 0 && window.__jaipur.life.stats.ped === 0), 'with street life off nothing is drawn');
  await p.click('#panel .seg button:has-text("Busy")');
  check(await p.evaluate(() => window.__jaipur.life.enabled && window.__jaipur.life.densityScale === 1.6), 'Traffic > Busy re-enables it at 1.6x');
  await p.click('#dock .dk[data-key="festival"]');
  await p.click('#panel .seg button:has-text("Diwali")');
  const fd = await p.evaluate(() => ({ mode: window.__jaipur.festival.mode, date: window.__jaipur.clock.dateISTString }));
  check(fd.mode === 'diwali' && fd.date.startsWith('2026-11-08'), `Festival > Diwali: ${JSON.stringify(fd)}`);
  await p.click('#panel button:has-text("Kites in the sky")');
  check(await p.evaluate(() => window.__jaipur.festival.kitesOn === true), 'the Kites toggle turns kites on');
  await p.click('#dock .dk[data-key="sound"]');
  await p.click('#panel button:has-text("On")');
  await p.waitForTimeout(500);
  check(await p.evaluate(() => !!(window.__jaipur.audio && window.__jaipur.audio.enabled)), 'Sound > On builds the audio graph (user gesture)');
  await p.keyboard.press('2');
  check(await p.evaluate(() => window.__jaipur.weather.name) === 'dust', 'key 2 selects dust haze');
  await p.keyboard.press('h');
  check(await p.evaluate(() => !document.getElementById('help').hidden), 'H opens the help sheet');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const a = window.__jaipur; a.setFestival('off', { moveClock: false }); a.setDate(2026, 10, 24, 17.2); a.setWeather('clear', true); });
  await p.click('#dock .dk[data-key="view"]');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/desktop-view-panel.png` });
  check(D.logs.length === 0, 'no console errors on desktop' + (D.logs.length ? ': ' + D.logs.slice(0, 3).join(' | ') : ''));
  await D.ctx.close();

  // ================= tour =================
  const T = await open({ viewport: { width: 1280, height: 720 } }, { tier: 'high', tour: '0' });
  const tp = T.page;
  await tp.evaluate(async () => { const a = window.__jaipur; await a.festival.ready; });
  await tp.keyboard.press('t');
  await tp.waitForTimeout(500);
  check(await tp.evaluate(() => window.__jaipur.tour.running), 'T starts the tour');
  const nShots = await tp.evaluate(() => window.__jaipur.tour.shots.length);
  check(nShots === 5, `all five shots are available from the real data (${nShots})`);
  const seen = [];
  for (let i = 0; i < nShots; i++) {
    await tp.waitForFunction((i) => { const t = window.__jaipur.tour; return t.i === i && t.state === 'play' && t.t > 0.5; }, i, { timeout: 90000 }).catch(() => {});
    const a0 = await tp.evaluate(() => {
      const a = window.__jaipur, t = a.tour, s = t.shot;
      const r = { id: s && s.id, dur: s && s.duration, date: a.clock.dateISTString, weather: a.weather.name, festival: a.festival.mode, sunAlt: +a.env.sunAlt.toFixed(1), moon: +a.env.moonIllum.toFixed(3), speed: a.clock.speed, state: t.state };
      // the sun altitude at the END of the shot: the clock runs shot.speed x real time for the remaining duration; evaluate the sky at that instant, then put the clock back
      const ms0 = a.clock.ms;
      a.clock.set(ms0 + (s.duration - t.t) * (s.speed || 1) * 1000); a.renderStill(1);
      r.endSun = +a.env.sunAlt.toFixed(1);
      a.clock.set(ms0); a.renderStill(1);
      return r;
    });
    // sample the flight at 25 %, 60 % and the end: camera above ground, finite, looking at something
    const samples = [];
    for (const f of [0.25, 0.6, 0.97]) {
      await tp.evaluate((f) => { const t = window.__jaipur.tour; t.t = t.shot.duration * f; }, f);
      await tp.waitForTimeout(900);
      const s = await pose(tp);
      samples.push(s);
      if (f === 0.6) await tp.screenshot({ path: `${OUT}/tour-${i + 1}-${a0.id}.png` });
    }
    const a1 = { sunAlt: a0.endSun };
    seen.push({ ...a0, end: a1, samples });
    console.log(`   shot ${i + 1} ${a0.id}: ${a0.date} ${a0.weather}/${a0.festival} x${a0.speed} sun ${a0.sunAlt} -> ${a1.sunAlt}, heights ${samples.map((s) => s.h.toFixed(0)).join('/')} m`);
    await tp.evaluate(() => { const t = window.__jaipur.tour; t.t = t.shot.duration + 0.01; });
    await tp.waitForTimeout(300);
  }
  check(seen.map((s) => s.id).join(',') === 'sunrise,johari,diwali,monsoon,amer', 'the shots run in the intended order: ' + seen.map((s) => s.id).join(', '));
  check(seen.every((s) => s.samples.every((p) => [p.x, p.y, p.z].every(Number.isFinite) && p.h > 1.5)), 'in every shot the camera stays finite and above the terrain');
  const S = Object.fromEntries(seen.map((s) => [s.id, s]));
  check(S.sunrise && S.sunrise.sunAlt < -1 && S.sunrise.sunAlt > -9 && S.sunrise.end.sunAlt > 2 && S.sunrise.end.sunAlt < 15, `sunrise shot starts before sunrise and ends with the sun up (${S.sunrise && S.sunrise.sunAlt} -> ${S.sunrise && S.sunrise.end.sunAlt} deg)`);
  check(S.johari && S.johari.date.startsWith('2026-10-25') && S.johari.samples.every((p) => p.h < 6), 'Johari shot: daytime, camera stays at street level');
  check(S.diwali && S.diwali.festival === 'diwali' && S.diwali.date.startsWith('2026-11-08') && S.diwali.moon < 0.03 && S.diwali.sunAlt < -12, `Diwali shot: festival on, 8 Nov, dark and moonless (illum ${S.diwali && S.diwali.moon})`);
  check(S.monsoon && S.monsoon.weather === 'monsoon' && S.monsoon.date.startsWith('2026-08-15') && S.monsoon.sunAlt > -1 && S.monsoon.sunAlt < 3.5 && S.monsoon.end.sunAlt < S.monsoon.sunAlt && S.monsoon.end.sunAlt > -8, `monsoon shot: rain at dusk on 15 Aug, sun ${S.monsoon && S.monsoon.sunAlt} -> ${S.monsoon && S.monsoon.end.sunAlt} deg (sets)`);
  check(S.amer && S.amer.sunAlt > 8 && S.amer.end.sunAlt > 0 && S.amer.end.sunAlt < 5 && S.amer.end.sunAlt < S.amer.sunAlt, `Jal Mahal -> Amer runs into the golden hour (sun ${S.amer && S.amer.sunAlt} -> ${S.amer && S.amer.end.sunAlt} deg)`);
  await tp.waitForFunction(() => !window.__jaipur.tour.running, null, { timeout: 30000 }).catch(() => {});
  check(await tp.evaluate(() => !window.__jaipur.tour.running && window.__jaipur.rig.mode === 'fly' && window.__jaipur.clock.speed === 1), 'after the last shot the tour ends in free-fly at normal clock speed');
  // input during a tour hands over to free-fly
  await tp.keyboard.press('t'); await tp.waitForTimeout(700);
  await tp.keyboard.down('w'); await tp.waitForTimeout(200); await tp.keyboard.up('w');
  check(await tp.evaluate(() => !window.__jaipur.tour.running && window.__jaipur.rig.mode === 'fly'), 'a key press during the tour hands over to free-fly');
  check(T.logs.length === 0, 'no console errors during the tour' + (T.logs.length ? ': ' + T.logs.slice(0, 3).join(' | ') : ''));
  await T.ctx.close();

  // ================= touch phone =================
  const M = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, { tier: 'low', tour: '0' });
  const mp = M.page;
  const cdp = await M.ctx.newCDPSession(mp);
  const touch = (type, x, y, id = 1) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id }] });
  await mp.evaluate(() => { const a = window.__jaipur; a.setDate(2026, 10, 24, 11); a.goToView('badi'); });
  await settle(mp);
  await mp.waitForTimeout(400);
  check(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow at 390 px');
  const c2 = await mp.evaluate(() => { const el = document.getElementById('credit'), c = el.getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect(); return { top: c.top, bottom: c.bottom, dockBottom: d.bottom, ih: innerHeight, clipped: el.scrollWidth > el.clientWidth, text: [...el.querySelectorAll('span')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.textContent).join(' ') }; });
  check(c2.bottom <= c2.ih && c2.top >= c2.dockBottom - 1 && !c2.clipped && /OpenStreetMap contributors/.test(c2.text), `on the phone the short attribution is visible under the dock, not clipped: "${c2.text}"`);
  const tiny = await mp.evaluate(() => [...document.querySelectorAll('#dock .dk, #touch .hold')].map((b) => { const r = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
  check(tiny.length === 0, 'every dock / touch button is at least 44 x 44 px' + (tiny.length ? ': ' + JSON.stringify(tiny) : ''));
  check(await mp.evaluate(() => document.body.classList.contains('touchy') || matchMedia('(pointer: coarse)').matches), 'touch UI is active on the phone');
  const m0 = await pose(mp);
  await touch('touchStart', 60, 700);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', 60, 700 - i * 6); await mp.waitForTimeout(90); }
  const stickOn = await mp.evaluate(() => !!window.__jaipur.rig.stick);
  await touch('touchEnd');
  await mp.waitForTimeout(250);
  const m1 = await pose(mp);
  const mvt = (m1.x - m0.x) * m0.fx + (m1.z - m0.z) * m0.fz;
  check(stickOn && mvt > 8, `the touch stick moves forward (${mvt.toFixed(1)} m)`);
  const my0 = (await pose(mp)).yaw;
  await touch('touchStart', 260, 380);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', 260 + i * 10, 380); await mp.waitForTimeout(30); }
  await touch('touchEnd');
  const my1 = (await pose(mp)).yaw;
  check(my1 - my0 > 0.3 && my1 - my0 < 1.4, `dragging on the right side turns the view (${(my1 - my0).toFixed(2)} rad for 100 px)`);
  const upRect = await mp.evaluate(() => { const r = document.querySelector('#touch .hold.up').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const h0 = (await pose(mp)).h;
  await touch('touchStart', upRect.x, upRect.y, 2);
  await mp.waitForTimeout(900);
  await touch('touchEnd');
  await mp.waitForTimeout(200);
  const h1 = (await pose(mp)).h;
  check(h1 > h0 + 5, `the up button climbs (${h0.toFixed(1)} -> ${h1.toFixed(1)} m)`);
  await mp.tap('#dock .dk[data-key="festival"]');
  const rect = await mp.evaluate(() => { const r = document.getElementById('panel').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight, hidden: document.getElementById('panel').hidden }; });
  check(!rect.hidden && rect.l >= 0 && rect.r <= rect.w && rect.t >= 0 && rect.b <= rect.h, 'a panel fits inside the phone screen');
  await mp.screenshot({ path: `${OUT}/phone-festival-panel.png` });
  await mp.tap('#dock .dk[data-key="festival"]'); // close
  await mp.evaluate(() => window.__jaipur.goToView('hawa'));
  await settle(mp);
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: `${OUT}/phone-hawa.png` });
  check(M.logs.length === 0, 'no console errors on the phone' + (M.logs.length ? ': ' + M.logs.slice(0, 3).join(' | ') : ''));
  await M.ctx.close();
} catch (e) {
  console.error('ui check crashed:', e);
  failed++;
} finally {
  await browser.close().catch(() => {});
  srv.stop();
}
console.log(failed ? `\nFAIL: ${failed} UI check(s) failed` : '\nOK: camera, tour and UI checks passed');
process.exit(failed ? 1 : 0);
