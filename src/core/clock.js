// One simulation clock drives time of day, weather, traffic, festival lights and audio.
// Time is a real UTC instant (ms). `speed` = simulated seconds per real second.
import { fromIST, PRESET_DATES, toIST, IST_OFFSET_H } from '../astro/astro.js';

export class SimClock {
  constructor(startMs) {
    this.ms = startMs ?? fromIST(2026, 10, 24, 6, 30);
    this.speed = 1;
    this.paused = false;
    this.elapsed = 0; // real fixed-step seconds since start (for animation phases)
    this.simElapsed = 0; // simulated seconds since start
    this.listeners = new Set();
  }

  /** advance by one fixed step (real seconds) */
  step(dt) {
    this.elapsed += dt;
    if (this.paused) return;
    const d = dt * this.speed;
    this.ms += d * 1000;
    this.simElapsed += d;
  }

  set(ms) {
    this.ms = ms;
    for (const l of this.listeners) l(this);
  }

  /** local IST hours (0..24) */
  get hours() {
    const t = toIST(this.ms);
    return t.h + t.mi / 60 + t.s / 3600;
  }

  /** set the IST hour of the current IST date */
  setHours(h) {
    const t = toIST(this.ms);
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    this.set(fromIST(t.y, t.mo, t.d, hh, mm, Math.floor((((h - hh) * 60) - mm) * 60)));
  }

  setPreset(name, hour) {
    const p = PRESET_DATES[name];
    if (!p) return;
    const t = toIST(this.ms);
    this.set(fromIST(p.y, p.mo, p.d, hour ?? t.h, t.mi));
  }

  get dateISTString() {
    const t = toIST(this.ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${t.y}-${p(t.mo)}-${p(t.d)} ${p(t.h)}:${p(t.mi)} IST`;
  }
}

export { IST_OFFSET_H };
