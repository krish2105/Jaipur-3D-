// Frame loop: clamped frame deltas + fixed-timestep simulation accumulator + optional fps cap.
// Nothing in the simulation may depend on the raw frame delta; visual-only code (camera, particles
// that are purely cosmetic) uses the clamped `dt` passed to render().

export class Loop {
  /**
   * @param {object} o
   * @param {number} [o.fixedDt=1/30]   simulation step (s)
   * @param {number} [o.maxDelta=0.1]   largest frame delta accepted (s); tab-switch / hitch guard
   * @param {number} [o.maxSubsteps=5]  fixed steps per frame before we drop the backlog
   * @param {(dt:number)=>void} o.update  fixed-step update
   * @param {(dt:number, alpha:number)=>void} o.render  per-frame render; dt clamped, alpha = interpolation
   */
  constructor({ fixedDt = 1 / 30, maxDelta = 0.1, maxSubsteps = 5, update, render }) {
    this.fixedDt = fixedDt;
    this.maxDelta = maxDelta;
    this.maxSubsteps = maxSubsteps;
    this.update = update;
    this.render = render;
    this.fpsCap = 0;
    this.paused = false;
    this._acc = 0;
    this._last = 0;
    this._lastRender = 0;
    this._raf = 0;
    this._running = false;
    this.frame = 0;
    this._tick = this._tick.bind(this);
    this.onFrameTime = null; // (rawMs, clampedMs) hook for the perf monitor
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._lastRender = this._last;
    this._raf = requestAnimationFrame(this._tick);
    document.addEventListener('visibilitychange', this._onVis);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    document.removeEventListener('visibilitychange', this._onVis);
  }

  _onVis = () => {
    // Avoid a huge delta / backlog when the tab becomes visible again.
    this._last = performance.now();
    this._acc = 0;
  };

  /** Manually advance N fixed steps then render once (deterministic screenshots / tests). */
  stepManual(steps = 1, renderAfter = true) {
    for (let i = 0; i < steps; i++) this.update(this.fixedDt);
    if (renderAfter) this.render(0, 0);
  }

  _tick(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick);
    if (this.fpsCap > 0) {
      const minInterval = 1000 / this.fpsCap - 1.5; // small slack so 30 does not alias to 20
      if (now - this._lastRender < minInterval) return;
    }
    const raw = now - this._last;
    this._last = now;
    this._lastRender = now;
    let dt = raw / 1000;
    if (dt > this.maxDelta) dt = this.maxDelta;
    if (dt < 0) dt = 0;
    if (this.onFrameTime) this.onFrameTime(raw, dt * 1000);

    if (!this.paused) {
      this._acc += dt;
      let steps = 0;
      while (this._acc >= this.fixedDt && steps < this.maxSubsteps) {
        this.update(this.fixedDt);
        this._acc -= this.fixedDt;
        steps++;
      }
      if (steps === this.maxSubsteps) this._acc = 0; // drop backlog rather than spiral
    }
    this.frame++;
    this.render(dt, this.paused ? 0 : this._acc / this.fixedDt);
  }
}
