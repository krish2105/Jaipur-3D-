// Procedural soundscape (Web Audio only: no samples, no files). Starts after the first user gesture, has a mute + volume, is spatialised to the camera
// (listener = camera, HRTF panners for near voices) and follows the one simulation state: time of day, weather, street life, festival, camera height.
//   beds (always running, gain-modulated):  city murmur, crowd, traffic rumble, wind, rain hiss + patter, wet-road swish, insects (night), kite-string hum
//   spatial one-shots / voices:             vehicle engines (nearest few), horns, birds (chirps, pigeon coos, crows), temple bells, dhol-like drums,
//                                           Diwali crackers, fireworks (whistle + boom delayed by distance / 343 m/s), thunder (delayed by the bolt's distance)
// Voice budget = settings.audioVoices (24 / 16 / 10). The mixing model lives in mix.js (pure, tested); this file only builds nodes and schedules events.
// APPROX: every sound is synthesised art direction, not a recording of Jaipur.
import { computeMix, soundDelay, thunderFor, nearestSources, engineParams, hornFor, hornRate, birdRate, crackerRate, fillWhite, fillPink, fillBrown, fillPatter, fillImpulse, rms } from './mix.js';
import { mulberry32 } from '../core/rng.js';

const LS_MUTE = 'jaipur3d.muted', LS_VOL = 'jaipur3d.volume';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

export class AudioSystem {
  /** @param {{settings:{audioVoices:number}}} o */
  constructor(o) {
    this.maxVoices = o.settings.audioVoices;
    this.tierHigh = o.settings.audioVoices >= 16;
    this.ctx = null;
    this.enabled = false;         // graph built and context running
    this.muted = store.get(LS_MUTE) === '1';
    const v = parseFloat(store.get(LS_VOL));
    this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
    this.rng = mulberry32(90210);
    this.voices = 0;
    this.stats = { running: false, muted: this.muted, voices: 0, level: 0, mix: null };
    this._acc = 0;
    this._boltSeen = 0;
    this._drumT = 0;
    this._drumStep = 0;
    this._bellT = 0;
    this._lvBuf = new Float32Array(1024);
    this._vehPick = [];
    this._pendingGesture = null;
  }

  /** browsers only allow audio after a gesture: the first click / tap / key press builds the graph */
  attachGestureUnlock(target = window) {
    if (this._pendingGesture) return;
    const go = () => { this.enable(); if (this.enabled) { for (const e of ['pointerdown', 'keydown', 'touchend']) target.removeEventListener(e, go, true); this._pendingGesture = null; } };
    for (const e of ['pointerdown', 'keydown', 'touchend']) target.addEventListener(e, go, true);
    this._pendingGesture = go;
    target.addEventListener('keydown', (ev) => { if ((ev.key === 'm' || ev.key === 'M') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) this.toggleMute(); });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {}); else if (this.enabled) this.ctx.resume().catch(() => {});
    });
  }

  /** build (first call) / resume the audio graph. Must run inside a user gesture. */
  enable() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!this.ctx) { this.ctx = new AC({ latencyHint: 'interactive' }); this._build(); }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this.enabled = true;
      this.stats.running = true;
      this._applyMaster(0.15);
    } catch (e) {
      console.warn('audio unavailable', e);
      return false;
    }
    return true;
  }

  setMuted(m) { this.muted = !!m; store.set(LS_MUTE, this.muted ? '1' : '0'); this.stats.muted = this.muted; this._applyMaster(0.05); }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); store.set(LS_VOL, String(this.volume)); this._applyMaster(0.05); }
  _applyMaster(tc) { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, tc); }

  // ---- graph -----------------------------------------------------------------------------------------
  _buf(fill, seconds, ...args) {
    const sr = this.ctx.sampleRate, b = this.ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    fill(b.getChannelData(0), ...args);
    return b;
  }
  _loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = true;
    s.start(0, this.rng() * buffer.duration);
    return s;
  }
  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _filter(type, f, q = 0.7) { const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }
  _chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  _build() {
    const c = this.ctx, sr = c.sampleRate;
    this.master = this._gain(0);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 14; this.comp.ratio.value = 5; this.comp.attack.value = 0.005; this.comp.release.value = 0.25;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024;
    this.bus = this._gain(1);            // everything except the master
    this._chain(this.bus, this.comp, this.master, c.destination);
    this.master.connect(this.analyser);
    // a short street reverb (high / medium tiers)
    if (this.tierHigh) {
      this.reverb = c.createConvolver();
      const ib = c.createBuffer(1, Math.floor(sr * 1.1), sr);
      fillImpulse(ib.getChannelData(0), sr, 1.1, 5);
      this.reverb.buffer = ib;
      this.revSend = this._gain(0.22);
      this.revSend.connect(this.reverb);
      this.reverb.connect(this.comp);
    }
    this.buffers = {
      white: this._buf(fillWhite, 2, 11), pink: this._buf(fillPink, 5, 12), brown: this._buf(fillBrown, 5, 13),
      patter: this._buf((o) => fillPatter(o, sr, 480, 14), 3),
    };
    const B = this.buffers;
    this.layers = {};
    const layer = (name, src, ...nodes) => { const g = this._gain(0); this._chain(src, ...nodes, g); g.connect(this.bus); src.start && 0; this.layers[name] = g; return g; };
    layer('city', this._loop(B.pink), this._filter('lowpass', 900, 0.5));
    // syllabic wobble of the crowd murmur: an amplitude modulator IN SERIES with the layer gain (a modulator wired straight into the layer's gain
    // AudioParam would add to it, so a silent layer would still sound and the gain would swing negative)
    const wobG = this._gain(0.65), wob = c.createOscillator(), wd = this._gain(0.35);
    wob.frequency.value = 4.3; wob.connect(wd); wd.connect(wobG.gain); wob.start();
    layer('crowd', this._loop(B.pink), this._filter('bandpass', 620, 0.8), wobG);
    layer('traffic', this._loop(B.brown), this._filter('lowpass', 210, 0.6));
    const windF = this._filter('bandpass', 520, 0.45);
    layer('wind', this._loop(B.brown), windF);
    this.windF = windF;
    layer('windLow', this._loop(B.brown), this._filter('lowpass', 170, 0.7)); // the roar under the howl
    const gustL = c.createOscillator(); gustL.frequency.value = 0.17; const gustD = this._gain(260); gustL.connect(gustD); gustD.connect(windF.frequency); gustL.start();
    layer('rain', this._loop(B.white), this._filter('highpass', 1500, 0.6), this._filter('lowpass', 8500, 0.5));
    layer('patter', this._loop(B.patter), this._filter('bandpass', 4200, 0.6));
    layer('swish', this._loop(B.pink), this._filter('bandpass', 1900, 0.5));
    layer('kite', this._loop(B.white), this._filter('bandpass', 3100, 7));
    // insects: three AM-modulated sines (crickets), each gated slowly
    const ins = this._gain(0); ins.connect(this.bus); this.layers.insects = ins;
    for (const [f, lf, gf] of [[4300, 31, 0.21], [4720, 36, 0.13], [5150, 27, 0.17]]) {
      const o = c.createOscillator(); o.frequency.value = f;
      const am = this._gain(0.5);
      const lfo = c.createOscillator(); lfo.frequency.value = lf; const ld = this._gain(0.5); lfo.connect(ld); ld.connect(am.gain);
      const gate = c.createOscillator(); gate.frequency.value = gf; const gd = this._gain(0.4); gate.connect(gd);
      const gg = this._gain(0.55); gd.connect(gg.gain); // slow on / off
      this._chain(o, am, gg, ins);
      o.start(); lfo.start(); gate.start();
    }
    // engines: a few persistent voices that follow the nearest vehicles
    const n = Math.max(2, Math.min(8, Math.floor(this.maxVoices * 0.33)));
    this.engines = [];
    for (let i = 0; i < n; i++) {
      const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 50;
      const sq = c.createOscillator(); sq.type = 'square'; sq.frequency.value = 25;
      const g = this._gain(0), lp = this._filter('lowpass', 600, 0.8), p = this._panner(true, 4, 1.4);
      const mixg = this._gain(0.6), sqg = this._gain(0.4);
      saw.connect(mixg); sq.connect(sqg); mixg.connect(lp); sqg.connect(lp); this._chain(lp, g, p);
      p.connect(this.bus); if (this.revSend) p.connect(this.revSend);
      saw.start(); sq.start();
      this.engines.push({ saw, sq, g, lp, p, mixg, sqg });
    }
  }

  _panner(hrtf, ref = 3, roll = 1.2) {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 5000;
    return p;
  }
  _setPos(p, x, y, z, smooth = 0) {
    const t = this.ctx.currentTime;
    if (p.positionX) { if (smooth) { p.positionX.setTargetAtTime(x, t, smooth); p.positionY.setTargetAtTime(y, t, smooth); p.positionZ.setTargetAtTime(z, t, smooth); } else { p.positionX.setValueAtTime(x, t); p.positionY.setValueAtTime(y, t); p.positionZ.setValueAtTime(z, t); } }
    else p.setPosition(x, y, z);
  }

  /** run `build(out, t0)` as a one-shot voice at a world position; skipped when over the voice budget. dur = seconds it sounds. */
  _shot(x, y, z, dur, build, { delay = 0, hrtf = true, ref = 3, roll = 1.2, send = true } = {}) {
    if (!this.enabled || this.muted || this.voices >= this.maxVoices || this.ctx.state !== 'running') return false;
    const c = this.ctx, p = this._panner(hrtf && this.tierHigh || (hrtf && this.voices < this.maxVoices * 0.6), ref, roll);
    this._setPos(p, x, y, z);
    p.connect(this.bus);
    if (send && this.revSend) p.connect(this.revSend);
    const t0 = c.currentTime + Math.max(0, delay) + 0.005;
    const nodes = build(p, t0) || [];
    this.voices++;
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); try { p.disconnect(); } catch { /* already gone */ } for (const n of nodes) try { n.disconnect(); } catch { /* already gone */ } }, (Math.max(0, delay) + dur + 0.3) * 1000);
    return true;
  }
  // percussive: attack then exponential decay over d
  _env(g, t0, a, peak, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  // sustained (horns, calls): attack, hold at the peak for most of the duration, then release
  _hold(g, t0, a, peak, dur) { const r = Math.max(0.04, dur * 0.22); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.setValueAtTime(peak, t0 + Math.max(a, dur - r)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
  _noiseShot(out, t0, dur, type, f, q, peak, a = 0.002) {
    const s = this.ctx.createBufferSource(); s.buffer = this.buffers.white;
    const fl = this._filter(type, f, q), g = this._gain(0);
    this._chain(s, fl, g, out); this._env(g, t0, a, peak, dur);
    s.start(t0, this.rng() * 1.5, dur + 0.05); s.stop(t0 + dur + 0.1);
    return [s, fl, g];
  }
  _tone(out, t0, type, f0, f1, dur, peak, a = 0.004, sustain = false) {
    const o = this.ctx.createOscillator(), g = this._gain(0);
    o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    this._chain(o, g, out); if (sustain) this._hold(g, t0, a, peak, dur); else this._env(g, t0, a, peak, dur);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return [o, g];
  }

  // ---- one-shot sounds --------------------------------------------------------------------------------
  horn(x, y, z, type) {
    const [f1, f2, dur, peak] = hornFor(type, this.rng());
    this._shot(x, y, z, dur + 0.1, (out, t0) => {
      const lp = this._filter('lowpass', 2400, 0.6); lp.connect(out);
      const n = [lp, ...this._tone(lp, t0, 'sawtooth', f1, f1 * 0.985, dur, 0.22 * peak, 0.015, true)];
      if (f2) n.push(...this._tone(lp, t0, 'square', f2, f2 * 0.985, dur, 0.12 * peak, 0.015, true));
      return n;
    }, { ref: 6, roll: 1.1 });
  }
  chirp(x, y, z) {
    const r = this.rng(), notes = 2 + Math.floor(r * 4), base = 2400 + this.rng() * 2200;
    this._shot(x, y, z, notes * 0.12 + 0.1, (out, t0) => {
      const n = [];
      for (let i = 0; i < notes; i++) n.push(...this._tone(out, t0 + i * (0.09 + 0.03 * this.rng()), 'sine', base * (0.9 + 0.4 * this.rng()), base * (1.15 + 0.5 * this.rng()), 0.07, 0.05, 0.004));
      return n;
    }, { ref: 3, roll: 1.4 });
  }
  coo(x, y, z) {
    this._shot(x, y, z, 1.1, (out, t0) => {
      const n = [];
      for (const [dt, f, d] of [[0, 430, 0.22], [0.3, 400, 0.16], [0.52, 440, 0.34]]) {
        const [o, g] = this._tone(out, t0 + dt, 'sine', f, f * 0.93, d, 0.1, 0.03, true);
        const vib = this.ctx.createOscillator(); vib.frequency.value = 9; const vg = this._gain(9); vib.connect(vg); vg.connect(o.frequency); vib.start(t0 + dt); vib.stop(t0 + dt + d + 0.1);
        n.push(o, g, vib, vg);
      }
      return n;
    }, { ref: 3, roll: 1.3 });
  }
  caw(x, y, z) {
    this._shot(x, y, z, 1.2, (out, t0) => {
      const bp = this._filter('bandpass', 1100, 2.2); bp.connect(out);
      const n = [bp];
      for (let i = 0; i < 2 + Math.floor(this.rng() * 2); i++) n.push(...this._tone(bp, t0 + i * 0.42, 'sawtooth', 520, 300, 0.3, 0.2, 0.02, true));
      return n;
    }, { ref: 5, roll: 1.1 });
  }
  pop(x, y, z, big = false) {
    this._shot(x, y, z, 0.35, (out, t0) => [...this._noiseShot(out, t0, big ? 0.16 : 0.07, 'highpass', 700, 0.7, big ? 0.9 : 0.55), ...this._tone(out, t0, 'sine', big ? 150 : 210, 45, big ? 0.12 : 0.07, big ? 0.7 : 0.35)], { ref: 12, roll: 1.0, hrtf: false });
  }
  bell(x, y, z) {
    this._shot(x, y, z, 4.2, (out, t0) => {
      const n = [];
      const f0 = 330 + this.rng() * 90;
      for (const [r, a, d] of [[1, 0.5, 3.6], [2.76, 0.32, 2.4], [5.4, 0.2, 1.4], [8.93, 0.1, 0.8]]) n.push(...this._tone(out, t0, 'sine', f0 * r, f0 * r, d, a * 0.5, 0.004));
      return n;
    }, { ref: 15, roll: 0.9 });
  }
  drum(x, y, z, bass) {
    this._shot(x, y, z, 0.5, (out, t0) => bass ? this._tone(out, t0, 'sine', 108, 52, 0.3, 0.9, 0.003) : [...this._noiseShot(out, t0, 0.09, 'bandpass', 1900, 1.2, 0.5), ...this._tone(out, t0, 'triangle', 300, 220, 0.09, 0.2, 0.002)], { ref: 20, roll: 1.0, hrtf: false });
  }
  whistle(x, y, z, dur) {
    this._shot(x, y, z, dur, (out, t0) => {
      const [o, g] = this._tone(out, t0, 'sine', 700, 2600, dur, 0.18, 0.05, true);
      const trem = this.ctx.createOscillator(); trem.frequency.value = 22; const tg = this._gain(0.06); trem.connect(tg); tg.connect(g.gain); trem.start(t0); trem.stop(t0 + dur + 0.1);
      return [o, g, trem, tg];
    }, { delay: 0, ref: 60, roll: 0.8, hrtf: false });
  }
  boom(x, y, z, delay) {
    this._shot(x, y, z, 2.2, (out, t0) => {
      const n = [...this._tone(out, t0, 'sine', 95, 26, 1.0, 1.0, 0.006), ...this._noiseShot(out, t0, 0.5, 'lowpass', 500, 0.7, 0.7)];
      // crackle: a run of sparkle ticks
      for (let i = 0; i < 26; i++) n.push(...this._noiseShot(out, t0 + 0.12 + this.rng() * 1.5, 0.05, 'bandpass', 2500 + this.rng() * 3000, 1.5, 0.12 + 0.25 * this.rng()));
      return n;
    }, { delay, ref: 80, roll: 0.75, hrtf: false });
  }
  thunder(t, camPos) {
    const th = thunderFor(t);
    const R = Math.min(t.dist, 700);
    const x = camPos.x + Math.sin(t.bearing) * R, z = camPos.z + Math.cos(t.bearing) * R;
    this._shot(x, camPos.y + 60, z, th.delay + th.rumble + 1, (out, t0) => {
      const n = [...this._noiseShot(out, t0, 0.35, 'highpass', 1400, 0.6, 1.1 * th.crack * th.gain)];
      // rolling rumble: brown noise through a low-pass with irregular swells
      const s = this.ctx.createBufferSource(); s.buffer = this.buffers.brown;
      const lp = this._filter('lowpass', 240, 0.7), g = this._gain(0.0001);
      this._chain(s, lp, g, out);
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(1.3 * th.gain, t0 + 0.25);
      for (let i = 1; i <= 4; i++) g.gain.linearRampToValueAtTime((0.45 + 0.55 * this.rng()) * th.gain * (1 - i / 6), t0 + 0.25 + (i / 4) * th.rumble * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + th.rumble + 0.6);
      s.start(t0, this.rng() * 3, th.rumble + 0.8); s.stop(t0 + th.rumble + 0.9);
      return [...n, s, lp, g];
    }, { delay: th.delay, ref: 250, roll: 0.5, hrtf: false });
  }

  // ---- per-frame --------------------------------------------------------------------------------------
  _listener(cam) {
    const c = this.ctx, L = c.listener, t = c.currentTime;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.setValueAtTime(cam.position.x, t); L.positionY.setValueAtTime(cam.position.y, t); L.positionZ.setValueAtTime(cam.position.z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  _mixState(app) {
    const w = app.weather.s, cam = app.camera.position, life = app.life, snap = life && life.snap;
    let nearPeds = 0, nearVeh = 0;
    if (snap) {
      const p = snap.ped;
      for (let i = 0; i < snap.np; i++) { const dx = p[i * 8] - cam.x, dz = p[i * 8 + 2] - cam.z; if (dx * dx + dz * dz < 2025) nearPeds++; }
      const v = snap.veh;
      for (let i = 0; i < snap.nv; i++) { const dx = v[i * 8] - cam.x, dz = v[i * 8 + 2] - cam.z; if (dx * dx + dz * dz < 3600) nearVeh++; }
    }
    const f = app.festival;
    return {
      hour: app.clock.hours, sunAlt: app.env.sunAlt, rain: w.rain, wetness: w.wetness, windSpeed: w.windSpeed, dust: w.dust, storm: w.storm, overcast: w.overcast,
      veh: life ? life.stats.veh : 0, ped: life ? life.stats.ped : 0, nearPeds, nearVeh, birds: life ? life.stats.bird : 0, kites: f ? f.stats.kites : 0,
      altitude: cam.y - app.hf.heightAt(cam.x, cam.z), festival: f ? f.mode : 'off', festivalStrength: f ? f.strength : 0,
    };
  }

  /** per rendered frame (dt = clamped real frame time) */
  frame(dt, app) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, cam = app.camera;
    this._listener(cam);
    this._acc += dt;
    if (this._acc < 0.1) return;
    const step = this._acc; this._acc = 0;
    const st = this._mixState(app);
    const m = computeMix(st);
    this.stats.mix = m;
    const t = c.currentTime, L = this.layers, tc = 0.35;
    const set = (g, v) => g.gain.setTargetAtTime(v, t, tc);
    set(L.city, 0.10 * m.city); set(L.crowd, 0.16 * m.crowd); set(L.traffic, 0.34 * m.trafficBed);
    set(L.wind, 0.20 * m.wind); set(L.windLow, 0.55 * m.wind); this.windF.frequency.setTargetAtTime(380 + 900 * Math.min(1, st.windSpeed / 14), t, 1.0);
    set(L.rain, 0.085 * m.rain); set(L.patter, 0.22 * m.rain); set(L.swish, 0.07 * m.swish);
    set(L.insects, 0.05 * m.insects); set(L.kite, 0.12 * m.kiteHum);
    this._engines(app, m);
    if (this.muted) { this._level(); return; }

    const ground = (x, z) => app.hf.heightAt(x, z);
    const cx = cam.position.x, cz = cam.position.z, rnd = this.rng;
    const around = (rmin, rmax) => { const a = rnd() * Math.PI * 2, r = rmin + rnd() * (rmax - rmin); return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
    const snap = app.life && app.life.snap;
    // horns from the nearest vehicles
    if (snap && rnd() < hornRate(st.nearVeh, m.busy, m.night) * step) {
      const near = nearestSources(snap.veh, snap.nv, 8, 0, 2, cx, cz, 6, 70, this._vehPick);
      if (near.length) { const o = near[Math.floor(rnd() * near.length)], k = o.i * 8; this.horn(snap.veh[k], snap.veh[k + 1] + 1, snap.veh[k + 2], snap.veh[k + 4] | 0); }
    }
    // birds
    if (m.birds > 0.02 && rnd() < birdRate(m.birds) * step) {
      const [x, z] = around(8, 70);
      const kind = rnd();
      if (kind < 0.62) this.chirp(x, ground(x, z) + 4 + rnd() * 14, z);
      else if (kind < 0.86) this.coo(x, ground(x, z) + 2, z);
      else this.caw(x, ground(x, z) + 10 + rnd() * 20, z);
    }
    // bells (dawn / dusk aarti-like ringing from a distance)
    this._bellT -= step;
    if (m.bells > 0.05 && this._bellT <= 0) { this._bellT = 1.2 + rnd() * 3.2; const [x, z] = around(160, 420); this.bell(x, ground(x, z) + 8, z); }
    // Diwali crackers, sometimes a long string of them
    if (m.crackers > 0.02 && rnd() < crackerRate(m.crackers) * step) {
      const [x, z] = around(20, 320), gy = ground(x, z);
      if (rnd() < 0.12) for (let i = 0; i < 18; i++) setTimeout(() => this.pop(x + (rnd() - 0.5) * 3, gy + 1, z + (rnd() - 0.5) * 3, false), i * (55 + rnd() * 40));
      else this.pop(x, gy + 1 + rnd() * 6, z, rnd() < 0.2);
    }
    // drums: a looping pattern scheduled a little ahead
    if (m.drums > 0.03) {
      const pat = [1, 0, 2, 0, 1, 1, 2, 2, 1, 0, 2, 0, 1, 2, 2, 0]; // 1 bass, 2 treble
      const dur = 60 / 108 / 4 * 1000;
      const now = performance.now();
      if (this._drumT < now - 500) this._drumT = now;
      while (this._drumT < now + 250) {
        const hit = pat[this._drumStep++ % pat.length];
        if (hit) { const wait = Math.max(0, this._drumT - now); const [px, pz] = this._drumPos || (this._drumPos = around(90, 200)); setTimeout(() => this.drum(px, ground(px, pz) + 10, pz, hit === 1), wait); }
        this._drumT += dur;
      }
      if (rnd() < 0.002) this._drumPos = null;
    }
    // fireworks: launch whistles and booms delayed by distance / 343
    const fw = app.festival && app.festival.fireworks;
    if (fw) {
      for (const e of fw.drainLaunches()) { const d = Math.hypot(e.x - cx, e.z - cz); this.whistle(e.x, e.y, e.z, e.dur); void d; }
      for (const e of fw.drainEvents()) { const d = Math.hypot(e.x - cx, e.y - cam.position.y, e.z - cz); this.boom(e.x, e.y, e.z, soundDelay(d)); }
    }
    // thunder for each new bolt
    for (const b of app.weather.bolts) if (b.id > this._boltSeen) { this._boltSeen = b.id; this.thunder(b, cam.position); }
    this.stats.voices = this.voices;
    this._level();
  }

  _engines(app, m) {
    const snap = app.life && app.life.snap, t = this.ctx.currentTime, cam = app.camera.position;
    const n = this.engines.length;
    const near = snap ? nearestSources(snap.veh, snap.nv, 8, 0, 2, cam.x, cam.z, n, 55, this._vehPick) : [];
    for (let i = 0; i < n; i++) {
      const e = this.engines[i], o = near[i];
      if (!o || this.muted) { e.g.gain.setTargetAtTime(0, t, 0.15); continue; }
      const k = o.i * 8, ep = engineParams(snap.veh[k + 4] | 0, snap.veh[k + 6]);
      this._setPos(e.p, snap.veh[k], snap.veh[k + 1] + 0.7, snap.veh[k + 2], 0.06);
      e.saw.frequency.setTargetAtTime(ep.f, t, 0.12); e.sq.frequency.setTargetAtTime(ep.f * 0.5, t, 0.12);
      e.lp.frequency.setTargetAtTime(ep.cut, t, 0.12);
      e.sqg.gain.setTargetAtTime(0.25 + 0.5 * ep.buzz, t, 0.2);
      e.g.gain.setTargetAtTime(0.11 * ep.gain * (0.35 + 0.65 * m.ground) * (1 - 0.5 * m.air), t, 0.15);
    }
  }

  _level() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this._lvBuf);
    this.stats.level = rms(this._lvBuf);
  }
}
