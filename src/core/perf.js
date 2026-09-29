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
  constructor({ min, max, targetMs, enabled }) {
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
    if (avg > this.targetMs * 1.15) {
      this._slow++;
      this._fast = 0;
      if (this._slow >= 2 && this.scale > this.min) {
        this.scale = Math.max(this.min, +(this.scale * 0.88).toFixed(3));
        changed = this.scale;
        this._slow = 0;
      }
    } else if (avg < this.targetMs * 0.72) {
      this._fast++;
      this._slow = 0;
      if (this._fast >= 4 && this.scale < this.max) {
        this.scale = Math.min(this.max, +(this.scale * 1.08).toFixed(3));
        changed = this.scale;
        this._fast = 0;
      }
    } else {
      this._slow = 0;
      this._fast = 0;
    }
    this.atFloorSeconds = this.scale <= this.min + 1e-3 && avg > this.targetMs * 1.15 ? this.atFloorSeconds + 1 : 0;
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
