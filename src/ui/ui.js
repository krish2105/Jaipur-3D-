// Compact monochrome UI: a bottom dock (camera, time, weather, traffic, festival + kites, sound, quality) with one popover panel at a time,
// a time readout, tour title cards + skip / stop, the touch stick overlay and a keyboard help sheet. Plain DOM, no framework.
// Everything the panels do goes through the App API (setTime, setWeather, setFestival, life.setDensity, audio, rig, tour, goToView).
import { WEATHER_PRESETS } from '../weather/weather.js';
import { toIST } from '../astro/astro.js';

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  view: '<circle cx="12" cy="12" r="3"/><path d="M2 12c3-5 6.5-7.5 10-7.5S19 7 22 12c-3 5-6.5 7.5-10 7.5S5 17 2 12z"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  weather: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5 4.75 4.75 0 0 1 17.5 18z"/>',
  traffic: '<path d="M4 15v-3l2-5h12l2 5v3z"/><path d="M4 15v2.5M20 15v2.5"/><circle cx="8" cy="13.5" r="0.6"/><circle cx="16" cy="13.5" r="0.6"/>',
  festival: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  kite: '<path d="M12 2l5 8-5 8-5-8z"/><path d="M12 2v16M7 10h10"/><path d="M12 18c0 2-2 2-1.5 4"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  quality: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
};
function icon(name) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEATHER_ORDER = ['clear', 'dust', 'loo', 'monsoon', 'winter'];
const WEATHER_SHORT = { clear: 'Clear', dust: 'Haze', loo: 'Loo', monsoon: 'Monsoon', winter: 'Winter' };
const VIEWPOINTS = [['hawa', 'Hawa Mahal'], ['jantar', 'Jantar Mantar'], ['jal', 'Jal Mahal'], ['palace', 'City Palace'], ['amer', 'Amer Fort'], ['badi', 'Badi Chaupar'], ['johari', 'Johari Bazaar']];

export class UI {
  /** @param {{app:object, root:HTMLElement}} o */
  constructor(o) {
    this.app = o.app;
    this.root = o.root;
    this.open = null;
    this.acc = 0;
    this.refreshers = [];
    this._build();
    const app = this.app;
    app.tour.hooks.fade = (v) => { this.fade.style.opacity = String(v); };
    app.tour.hooks.title = (t, s) => this._title(t, s);
    app.tour.hooks.end = () => this._sync();
    window.addEventListener('keydown', (e) => this._key(e));
    document.addEventListener('pointerdown', (e) => { if (this.open && !this.dock.contains(e.target) && !this.panel.contains(e.target)) this._panel(null); }, true);
    this._sync();
  }

  // ---- building blocks --------------------------------------------------------------------------------
  _seg(items, get, set) {
    const wrap = h('div', { class: 'seg', role: 'group' });
    const btns = items.map(([v, label]) => { const b = h('button', { type: 'button', onclick: () => { this._touch(); set(v); this._sync(); } }, label); b.dataset.v = String(v); wrap.append(b); return b; });
    this.refreshers.push(() => { const cur = String(get()); for (const b of btns) b.setAttribute('aria-pressed', b.dataset.v === cur ? 'true' : 'false'); });
    return wrap;
  }
  _toggle(label, get, set) {
    const b = h('button', { type: 'button', class: 'tgl', onclick: () => { this._touch(); set(!get()); this._sync(); } }, label);
    this.refreshers.push(() => b.setAttribute('aria-pressed', get() ? 'true' : 'false'));
    return b;
  }
  _row(label, ...kids) { return h('div', { class: 'row' }, h('span', { class: 'lbl' }, label), ...kids); }
  /** user changed the simulation: an ongoing tour would fight the change, so it ends */
  _touch() { if (this.app.tour.running) this.app.tour.stop(); }

  _build() {
    const app = this.app;
    this.timeHud = h('div', { id: 'hud-time', 'aria-live': 'off' });
    this.fade = h('div', { id: 'fade' });
    this.titleCard = h('div', { id: 'hud-title', 'aria-live': 'polite' });
    this.tourBar = h('div', { id: 'tour-bar' },
      h('button', { type: 'button', onclick: () => app.tour.next() }, 'Next shot'),
      h('button', { type: 'button', onclick: () => app.tour.stop() }, 'Free fly'));
    this.soundHint = h('div', { id: 'sound-hint' }, 'tap or press any key for sound');
    this.dock = h('div', { id: 'dock', role: 'toolbar' });
    this.panel = h('div', { id: 'panel', hidden: true });
    this.help = h('div', { id: 'help', hidden: true, onclick: () => { this.help.hidden = true; } },
      h('div', {}, h('b', {}, 'Keys'),
        h('p', {}, 'W A S D / arrows move · E or Space up · Q or C down · Shift fast · Ctrl slow · drag to look · wheel = speed'),
        h('p', {}, 'T tour · F fly · G walk · 1-5 weather · [ ] time · M sound · P stats · H this help · Esc close'),
        h('p', {}, 'Touch: left third = move stick, elsewhere = look, ▲ ▼ buttons for height'),
        h('p', { class: 'dim' }, 'Map data © OpenStreetMap contributors · Terrain: Mapzen Terrarium')));
    this.touch = h('div', { id: 'touch' },
      h('div', { class: 'ring' }, h('div', { class: 'knob' })),
      h('button', { type: 'button', class: 'hold up', 'aria-label': 'up', onpointerdown: (e) => { e.preventDefault(); app.rig.setHold('up', true); }, onpointerup: () => app.rig.setHold('up', false), onpointercancel: () => app.rig.setHold('up', false), onpointerleave: () => app.rig.setHold('up', false) }, '▲'),
      h('button', { type: 'button', class: 'hold down', 'aria-label': 'down', onpointerdown: (e) => { e.preventDefault(); app.rig.setHold('down', true); }, onpointerup: () => app.rig.setHold('down', false), onpointercancel: () => app.rig.setHold('down', false), onpointerleave: () => app.rig.setHold('down', false) }, '▼'));
    this.ring = this.touch.querySelector('.ring'); this.knob = this.touch.querySelector('.knob');
    this.root.append(this.timeHud, this.fade, this.titleCard, this.tourBar, this.soundHint, this.touch, this.panel, this.dock, this.help);

    // ---- panels
    const panels = {};
    panels.view = h('div', {},
      this._row('Camera', this._seg([['tour', 'Tour'], ['fly', 'Fly'], ['walk', 'Walk']], () => app.tour.running ? 'tour' : app.rig.mode, (v) => {
        if (v === 'tour') { if (!app.tour.running) app.tour.start(); } else { if (app.tour.running) app.tour.stop(); app.rig.setMode(v); }
      })),
      h('div', { class: 'grid' }, VIEWPOINTS.map(([k, label]) => h('button', { type: 'button', onclick: () => { this._touch(); app.goToView(k); this._panel(null); } }, label))));
    const slider = h('input', { type: 'range', min: '0', max: '24', step: '0.05', 'aria-label': 'time of day', oninput: (e) => { this._touch(); app.setTime(+e.target.value % 24); this._sync(); } });
    this.timeSlider = slider;
    panels.time = h('div', {}, h('div', { class: 'big', id: 'time-big' }), slider,
      this._row('Speed', this._seg([[0, 'Pause'], [1, '1×'], [60, '60×'], [600, '600×'], [3600, '3600×']], () => (app.clock.paused ? 0 : app.clock.speed), (v) => { if (v === 0) app.clock.paused = true; else { app.clock.paused = false; app.clock.speed = v; } })),
      this._row('Date', this._seg([['oct', '24 Oct'], ['diwali', 'Diwali'], ['teej', 'Teej'], ['sankranti', 'Sankranti'], ['summer', 'Summer']], () => this._datePreset(), (v) => { if (v === 'oct') app.setDate(2026, 10, 24, app.clock.hours); else app.clock.setPreset(v, Math.floor(app.clock.hours)); })));
    panels.weather = h('div', {}, this._row('Weather', this._seg(WEATHER_ORDER.filter((k) => WEATHER_PRESETS[k]).map((k) => [k, WEATHER_SHORT[k]]), () => app.weather.name, (v) => app.setWeather(v))));
    panels.traffic = h('div', {}, this._row('Street life', this._seg([[0, 'Off'], [0.4, 'Light'], [1, 'Normal'], [1.6, 'Busy']], () => (app.life ? (app.life.enabled ? app.life.densityScale : 0) : 1), (v) => app.life && app.life.setDensity(v))),
      h('p', { class: 'dim' }, 'Traffic, people, cows and pigeons follow the OpenStreetMap street graph.'));
    panels.festival = h('div', {}, this._row('Festival', this._seg([['off', 'Off'], ['diwali', 'Diwali'], ['sankranti', 'Sankranti']], () => (app.festival ? app.festival.mode : 'off'), (v) => app.setFestival(v))),
      this._row('Kites', this._toggle('Kites in the sky', () => !!(app.festival && app.festival.kitesOn), (v) => { if (app.festival) { app.festival.setKites(v, app); if (v && app.weather.s.windSpeed < 5) app.setWeather('winter'); } })),
      h('p', { class: 'dim' }, 'Diwali: 8 Nov 2026, a moonless night. Sankranti: 14 Jan 2027.'));
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'volume', oninput: (e) => { if (app.audio) { app.audio.enable(); app.audio.setVolume(+e.target.value); } } });
    this.volSlider = vol;
    panels.sound = h('div', {}, this._row('Sound', this._toggle('On', () => !!(app.audio && app.audio.enabled && !app.audio.muted), (v) => { if (!app.audio) return; app.audio.enable(); app.audio.setMuted(!v); })), this._row('Volume', vol),
      h('p', { class: 'dim' }, 'All sound is synthesised in the browser. It starts after your first tap or key press. M mutes.'));
    const tiers = app.tierName;
    panels.quality = h('div', {}, this._row('Quality', this._seg([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => app.tierName, (v) => { if (v !== app.tierName) { const u = new URL(location.href); u.searchParams.set('tier', v); location.href = u.toString(); } })),
      this._row('Stats', this._toggle('Performance overlay', () => !!(app.overlay && app.overlay.visible), () => app.overlay && app.overlay.toggle())),
      h('p', { class: 'dim' }, `Detected: ${tiers}. Changing quality reloads the page.`));
    this.panels = panels;

    const btn = (key, label, ic = key) => { const b = h('button', { type: 'button', class: 'dk', 'aria-label': label, 'aria-expanded': 'false', onclick: () => this._panel(this.open === key ? null : key) }, icon(ic), h('span', {}, label)); b.dataset.key = key; this.dock.append(b); return b; };
    this.btns = { view: btn('view', 'Camera'), time: btn('time', 'Time'), weather: btn('weather', 'Weather'), traffic: btn('traffic', 'Traffic'), festival: btn('festival', 'Festival'), sound: btn('sound', 'Sound'), quality: btn('quality', 'Quality') };
    this.soundIcon = this.btns.sound.querySelector('svg');
  }

  _panel(key) {
    this.open = key;
    for (const [k, b] of Object.entries(this.btns)) { b.setAttribute('aria-expanded', k === key ? 'true' : 'false'); b.classList.toggle('on', k === key); }
    if (!key) { this.panel.hidden = true; return; }
    this.panel.replaceChildren(this.panels[key]);
    this.panel.hidden = false;
    this._sync();
  }

  _datePreset() {
    const t = toIST(this.app.clock.ms);
    const k = `${t.y}-${t.mo}-${t.d}`;
    return { '2026-11-8': 'diwali', '2026-8-15': 'teej', '2027-1-14': 'sankranti', '2026-5-20': 'summer', '2026-10-24': 'oct' }[k] || '';
  }

  _title(text, sub) {
    this.titleCard.replaceChildren(text ? h('div', { class: 't' }, text) : '', sub ? h('div', { class: 's' }, sub) : '');
    this.titleCard.classList.toggle('on', !!text);
    clearTimeout(this._titleT);
    if (text) this._titleT = setTimeout(() => this.titleCard.classList.remove('on'), 4200);
  }

  _key(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const app = this.app;
    switch (e.key) {
      case 't': case 'T': app.tour.running ? app.tour.stop() : app.tour.start(); break;
      case 'f': case 'F': if (app.tour.running) app.tour.stop(); app.rig.setMode('fly'); break;
      case 'g': case 'G': if (app.tour.running) app.tour.stop(); app.rig.setMode('walk'); break;
      case 'h': case 'H': case '?': this.help.hidden = !this.help.hidden; break;
      case 'n': case 'N': app.tour.next(); break;
      case 'Escape': this._panel(null); this.help.hidden = true; break;
      case '[': case ']': { this._touch(); const d = e.key === ']' ? 0.5 : -0.5; app.setTime(((app.clock.hours + d) % 24 + 24) % 24); break; }
      default: {
        const i = '12345'.indexOf(e.key);
        if (i >= 0) { const name = WEATHER_ORDER[i]; if (WEATHER_PRESETS[name]) { this._touch(); app.setWeather(name); } }
      }
    }
    this._sync();
  }

  /** refresh every readout / pressed state (cheap; also called at 4 Hz and after every action) */
  _sync() {
    const app = this.app, t = toIST(app.clock.ms);
    const d = new Date(Date.UTC(t.y, t.mo - 1, t.d));
    this.timeHud.textContent = `${DAYS[d.getUTCDay()]} ${t.d} ${MONTHS[t.mo - 1]} ${t.y} · ${pad(t.h)}:${pad(t.mi)} IST`;
    const big = this.panel.querySelector('#time-big');
    if (big) big.textContent = `${pad(t.h)}:${pad(t.mi)} IST · ${DAYS[d.getUTCDay()]} ${t.d} ${MONTHS[t.mo - 1]} ${t.y}`;
    if (this.timeSlider && document.activeElement !== this.timeSlider) this.timeSlider.value = String(app.clock.hours);
    if (this.volSlider && document.activeElement !== this.volSlider) this.volSlider.value = String(app.audio ? app.audio.volume : 0.8);
    for (const r of this.refreshers) r();
    const au = app.audio;
    this.soundIcon.innerHTML = ICONS[au && au.enabled && !au.muted ? 'sound' : 'mute'];
    this.soundHint.classList.toggle('on', !!au && !au.enabled);
    this.tourBar.classList.toggle('on', app.tour.running);
    this.btns.view.classList.toggle('live', app.tour.running);
    document.body.classList.toggle('touchy', this._touchy());
  }

  _touchy() { return this._sawTouch || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches); }

  /** per rendered frame: touch stick visuals + a 4 Hz state refresh */
  frame(dt) {
    const rig = this.app.rig;
    if (!this._sawTouch && (rig.stick || rig.lookTouch)) { this._sawTouch = true; document.body.classList.add('touchy'); }
    const s = rig.stick;
    this.ring.style.display = s ? 'block' : 'none';
    if (s) {
      this.ring.style.transform = `translate(${s.x0}px, ${s.y0}px)`;
      const dx = s.x - s.x0, dy = s.y - s.y0, l = Math.hypot(dx, dy), k = l > rig.stickRadius ? rig.stickRadius / l : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
    this.acc += dt;
    if (this.acc > 0.25) { this.acc = 0; this._sync(); }
  }
}
