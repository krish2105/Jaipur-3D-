// Performance monitor + overlay + dynamic-resolution controller.
// The overlay is what you open on real devices: fps, frame-time percentiles, draw calls,
// triangles, texture/geometry counts, tier, pixel ratio. "Copy report" puts a JSON blob on the
// clipboard so numbers can be pasted back.

const WINDOW = 180;

export class PerfMonitor {
  constructor() {
    this.ft = new Float32Array(WINDOW); // clamped-frame ms ring buffer (render-to-render)
    this.n = 0;
    this.i = 0;
    this.gpuInfo = null;
    this.extra = {}; // extra key/values shown in overlay (set by app)
    this.peak = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
    this.lastInfo = { drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
  }

  /** smoothed main-thread ms of a named frame section (exponential average) */
  mark(name, ms) {
    const c = this.cpu || (this.cpu = {});
    c[name] = c[name] === undefined ? ms : c[name] * 0.92 + ms * 0.08;
  }

  /** total of the marked sections: the JS / GL-submission cost of one frame on this device */
  cpuTotal() {
    let t = 0;
    for (const k in this.cpu || {}) t += this.cpu[k];
    return t;
  }

  pushFrame(ms) {
    this.ft[this.i] = ms;
    this.i = (this.i + 1) % WINDOW;
    if (this.n < WINDOW) this.n++;
  }

  /** Read renderer.info AFTER a render (autoReset must be off; call renderer.info.reset() after). */
  captureInfo(renderer) {
    const r = renderer.info.render;
    const m = renderer.info.memory;
    this.lastInfo = {
      drawCalls: r.calls,
      triangles: r.triangles,
      points: r.points,
      lines: r.lines,
      geometries: m.geometries,
      textures: m.textures,
      programs: renderer.info.programs ? renderer.info.programs.length : 0,
    };
    const p = this.peak;
    p.drawCalls = Math.max(p.drawCalls, r.calls);
    p.triangles = Math.max(p.triangles, r.triangles);
    p.geometries = Math.max(p.geometries, m.geometries);
    p.textures = Math.max(p.textures, m.textures);
  }

  stats() {
    const n = this.n;
    if (!n) return { fps: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
    const a = Array.from(this.ft.subarray(0, n)).sort((x, y) => x - y);
    let sum = 0;
    for (let k = 0; k < n; k++) sum += a[k];
    const avg = sum / n;
    return { fps: 1000 / avg, avgMs: avg, p95Ms: a[Math.min(n - 1, Math.floor(n * 0.95))], maxMs: a[n - 1] };
  }
}

/** Lowers/raises internal resolution to hold the frame-time target. */
export class DynamicResolution {
  /**
   * @param {{min:number, max:number, targetMs:number, enabled:boolean, slowFactor?:number, capMs?:number}} o
   *   slowFactor: how far over the target the averaged frame time may go before the resolution is lowered.
   *   capMs: the frame interval of an fps-capped device (30 fps phones = 33.3). A capped device always shows intervals of about capMs, even with time to
   *   spare, so "fast enough to raise the resolution" cannot be read from the interval: it probes upward slowly instead (8 s of holding the cap
   *   -> +5 %), and steps down as soon as it misses the cap (slowFactor should then be ~1.3).
   */
  constructor({ min, max, targetMs, enabled, slowFactor = 1.06, capMs = 0 }) {
    this.slowFactor = slowFactor;
    this.capMs = capMs;
    this.min = min;
    this.max = max;
    this.scale = max; // effective pixel ratio
    this.targetMs = targetMs;
    this.enabled = enabled;
    this._slow = 0;
    this._fast = 0;
    this._acc = 0;
    this._frames = 0;
    this.atFloorSeconds = 0;
  }

  reconfigure({ min, max, targetMs, enabled }) {
    this.min = min;
    this.max = max;
    this.targetMs = targetMs;
    this.enabled = enabled;
    this.scale = Math.min(max, Math.max(min, this.scale));
  }

  /** feed clamped frame ms; returns new scale if it changed, else null */
  push(ms) {
    if (!this.enabled) return null;
    this._acc += ms;
    this._frames++;
    if (this._acc < 1000) return null;
    const avg = this._acc / this._frames;
    this._acc = 0;
    this._frames = 0;
    let changed = null;
    if (avg > this.targetMs * this.slowFactor) { // 60 fps target: step down as soon as a second averages more than ~17.7 ms
      this._slow++;
      this._fast = 0;
      if (this._slow >= 2 && this.scale > this.min) {
        this.scale = Math.max(this.min, +(this.scale * 0.88).toFixed(3));
        changed = this.scale;
        this._slow = 0;
      }
    } else if (avg < (this.capMs ? this.capMs * 1.08 : this.targetMs * 0.72)) {
      this._fast++;
      this._slow = 0;
      if (this._fast >= (this.capMs ? 8 : 4) && this.scale < this.max) {
        this.scale = Math.min(this.max, +(this.scale * (this.capMs ? 1.05 : 1.08)).toFixed(3));
        changed = this.scale;
        this._fast = 0;
      }
    } else {
      this._slow = 0;
      this._fast = 0;
    }
    this.atFloorSeconds = this.scale <= this.min + 1e-3 && avg > this.targetMs * this.slowFactor ? this.atFloorSeconds + 1 : 0;
    return changed;
  }
}

export class PerfOverlay {
  constructor(perf, getContext) {
    this.perf = perf;
    this.getContext = getContext; // () => object with extra values for report
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.hidden = true;
    this.pre = document.createElement('pre');
    this.btn = document.createElement('button');
    this.btn.textContent = 'copy report';
    this.btn.addEventListener('click', () => this.copy());
    this.el.append(this.pre, this.btn);
    document.body.appendChild(this.el);
    this._t = 0;
    this.visible = false;
  }

  toggle(force) {
    this.visible = force === undefined ? !this.visible : !!force;
    this.el.hidden = !this.visible;
  }

  report() {
    const s = this.perf.stats();
    const ctx = this.getContext();
    return {
      when: new Date().toISOString(),
      ua: navigator.userAgent,
      fps: +s.fps.toFixed(1),
      frameMsAvg: +s.avgMs.toFixed(2),
      frameMsP95: +s.p95Ms.toFixed(2),
      frameMsMax: +s.maxMs.toFixed(2),
      ...this.perf.lastInfo,
      peak: this.perf.peak,
      ...ctx,
    };
  }

  async copy() {
    const txt = JSON.stringify(this.report(), null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      this.btn.textContent = 'copied';
    } catch {
      window.prompt('Copy performance report:', txt);
    }
    setTimeout(() => (this.btn.textContent = 'copy report'), 1500);
  }

  update(nowMs) {
    if (!this.visible || nowMs - this._t < 250) return;
    this._t = nowMs;
    const s = this.perf.stats();
    const i = this.perf.lastInfo;
    const c = this.getContext();
    const lines = [
      `${s.fps.toFixed(0).padStart(3)} fps  ${s.avgMs.toFixed(1)} ms  p95 ${s.p95Ms.toFixed(1)}  max ${s.maxMs.toFixed(0)}`,
      `draws ${i.drawCalls}  tris ${(i.triangles / 1000).toFixed(0)}k  geo ${i.geometries}  tex ${i.textures}  prg ${i.programs}`,
      `tier ${c.tier}${c.tierForced ? ' (manual)' : ' (auto)'}  dpr ${c.pixelRatio}  ${c.width}x${c.height}`,
      `sim ${c.simTime}  ${c.weather}  ${c.mode}`,
    ];
    if (c.extra) for (const k of Object.keys(c.extra)) lines.push(`${k} ${c.extra[k]}`);
    if (c.gpu) lines.push(String(c.gpu).slice(0, 44));
    this.pre.textContent = lines.join('\n');
  }
}
