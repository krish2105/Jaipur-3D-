// Weather state machine: presets + smooth blending. Rendering of rain/lightning lives in other modules;
// sky, fog and lighting read `weather.s` (the blended state).

export const WEATHER_PRESETS = {
  clear: {
    label: 'Clear & hot',
    cloudCover: 0.2, cloudDensity: 0.95, cloudBase: 1900, cloudThick: 1300, cirrus: 0.25, overcast: 0,
    rain: 0, dust: 0.12, storm: 0, mist: 0, windSpeed: 3.5, windDir: 0.9,
    mieScale: 20, fogGain: 1.35, fogFalloff: 1 / 1200, dustTint: [1, 1, 1], lightningRate: 0,
  },
  dust: {
    label: 'Dust haze',
    cloudCover: 0.1, cloudDensity: 0.7, cloudBase: 2200, cloudThick: 1000, cirrus: 0.1, overcast: 0.05,
    rain: 0, dust: 0.75, storm: 0.1, mist: 0, windSpeed: 5.5, windDir: 1.0,
    mieScale: 110, fogGain: 3.4, fogFalloff: 1 / 950, dustTint: [1, 0.86, 0.62], lightningRate: 0,
  },
  loo: {
    label: 'Loo dust storm',
    cloudCover: 0.06, cloudDensity: 0.6, cloudBase: 2600, cloudThick: 900, cirrus: 0, overcast: 0.25,
    rain: 0, dust: 1, storm: 1, mist: 0, windSpeed: 15, windDir: 1.05,
    mieScale: 260, fogGain: 6.5, fogFalloff: 1 / 700, dustTint: [1, 0.76, 0.42], lightningRate: 0,
  },
  winter: {
    // crisp January day with a steady breeze (Makar Sankranti kite weather). APPROX: the wind speed is a modelling choice so kites fly, not a climate record.
    label: 'Winter breeze',
    cloudCover: 0.12, cloudDensity: 0.8, cloudBase: 2100, cloudThick: 1000, cirrus: 0.3, overcast: 0,
    rain: 0, dust: 0.07, storm: 0, mist: 0, windSpeed: 7, windDir: 0.42,
    mieScale: 14, fogGain: 1.0, fogFalloff: 1 / 1300, dustTint: [1, 1, 1], lightningRate: 0,
  },
  monsoon: {
    label: 'Monsoon',
    cloudCover: 0.97, cloudDensity: 1.9, cloudBase: 900, cloudThick: 2600, cirrus: 0, overcast: 0.9,
    rain: 0.9, dust: 0.04, storm: 0.35, mist: 0.6, windSpeed: 9, windDir: 4.0,
    mieScale: 20, fogGain: 2.0, fogFalloff: 1 / 900, dustTint: [1, 1, 1], lightningRate: 0.1,
  },
};

const NUM_KEYS = ['cloudCover', 'cloudDensity', 'cloudBase', 'cloudThick', 'cirrus', 'overcast', 'rain', 'dust', 'storm', 'mist', 'windSpeed', 'windDir', 'mieScale', 'fogGain', 'fogFalloff', 'lightningRate'];

export class Weather {
  constructor(preset = 'clear') {
    this.name = preset;
    this.target = { ...WEATHER_PRESETS[preset] };
    this.s = { ...WEATHER_PRESETS[preset], dustTint: [...WEATHER_PRESETS[preset].dustTint], wetness: 0, puddles: 0 };
    this.tau = 12; // seconds (real) time-constant for blending
    this.windOffset = [0, 0]; // accumulated cloud advection (m)
    this.flash = 0; // lightning flash intensity 0..1 (multi-stroke envelope)
    this._flashT = 0;
    this._boltAge = 99;   // seconds since the newest strike
    this._boltId = 0;
    this._nextBolt = 8;
    this._rand = 1;
    this.bolts = []; // {t, dist, bearing} for audio + render
  }

  set(name, instant = false) {
    if (!WEATHER_PRESETS[name]) return;
    this.name = name;
    this.target = { ...WEATHER_PRESETS[name] };
    if (instant) {
      for (const k of NUM_KEYS) this.s[k] = this.target[k];
      this.s.dustTint = [...this.target.dustTint];
      this.s.wetness = name === 'monsoon' ? 0.9 : 0;
      this.s.puddles = name === 'monsoon' ? 0.8 : 0;
    }
  }

  /** fixed-step update (dt real seconds; simSpeed scales weather dynamics mildly) */
  update(dt, simSpeed = 1) {
    const k = 1 - Math.exp(-dt / (this.tau / Math.max(1, Math.min(4, simSpeed ** 0.3))));
    const s = this.s, t = this.target;
    for (const key of NUM_KEYS) s[key] += (t[key] - s[key]) * k;
    for (let i = 0; i < 3; i++) s.dustTint[i] += (t.dustTint[i] - s.dustTint[i]) * k;
    // wetness lags rain: streets soak quickly, dry slowly (puddles slower still)
    const wetTarget = Math.min(1, s.rain * 1.6);
    s.wetness += (wetTarget - s.wetness) * (wetTarget > s.wetness ? 1 - Math.exp(-dt / 10) : 1 - Math.exp(-dt / 140));
    const pudTarget = Math.min(1, Math.max(0, (s.rain - 0.35) * 1.8));
    s.puddles += (pudTarget - s.puddles) * (pudTarget > s.puddles ? 1 - Math.exp(-dt / 40) : 1 - Math.exp(-dt / 260));
    // cloud advection
    const sp = s.windSpeed * Math.min(simSpeed, 30) ** 0.5;
    this.windOffset[0] += Math.sin(s.windDir) * sp * dt;
    this.windOffset[1] += Math.cos(s.windDir) * sp * dt;
    // lightning: Poisson-ish bolts while it is stormy
    this._flashT += dt;
    // a real flash is several return strokes within ~0.4 s: pulses at 0, 0.07, 0.17, 0.31 s decaying quickly, with a dim afterglow
    this._boltAge += dt;
    const ba = this._boltAge;
    let f = 0;
    for (const [t0, a] of [[0, 1], [0.07, 0.55], [0.17, 0.85], [0.31, 0.4]]) if (ba >= t0) f += a * Math.exp(-(ba - t0) / 0.035);
    f += 0.35 * Math.exp(-ba / 0.22);
    this.flash = Math.min(1, f);
    if (s.lightningRate > 0.005 && s.rain > 0.3) {
      this._nextBolt -= dt;
      if (this._nextBolt <= 0) {
        this._rand = (this._rand * 16807) % 2147483647;
        const r = this._rand / 2147483647;
        this._nextBolt = 4 + (1 - s.lightningRate * 4) * 18 * r + r * 5;
        this._strike(r);
      }
    }
    this.bolts = this.bolts.filter((b) => this._flashT - b.t < 12);
  }

  _strike(r) {
    this._boltAge = 0;
    this.flash = 1;
    this.bolts.push({ id: ++this._boltId, t: this._flashT, dist: 800 + r * 6000, bearing: r * Math.PI * 2 });
  }

  /** debug/verification: fire a bolt now */
  strikeNow(r = 0.3) {
    this._strike(r);
  }
}
