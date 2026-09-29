// Application shell: renderer, clock, weather, environment, sky, terrain, lighting, post, systems.
import * as THREE from 'three';
import { TIERS } from './core/budgets.js';
import { resolveTier } from './core/tier.js';
import { Loop } from './core/loop.js';
import { PerfMonitor, PerfOverlay, DynamicResolution } from './core/perf.js';
import { SimClock } from './core/clock.js';
import { Weather, WEATHER_PRESETS } from './weather/weather.js';
import { EnvState, computeEnv } from './sky/environment.js';
import { installEnvironmentHooks, ENV } from './render/env.js';
import { SkySystem } from './sky/sky.js';
import { PostFX } from './render/postfx.js';
import { Lighting } from './render/lighting.js';
import { Heightfield } from './world/heightfield.js';
import { Terrain } from './world/terrain.js';
import { fromIST } from './astro/astro.js';
import { City, NetworkSource, MemorySource } from './world/city.js';
import { BUILDING_UNIFORMS } from './world/facadeMaterial.js';
import { planLandmarks, Landmarks } from './world/landmarks/index.js';
import { estimateTextureMB, countInstances } from './core/gpumem.js';
import { WeatherFx } from './weather/fx.js';
import { PlanarReflection } from './render/reflection.js';

function shopOpenFraction(h) {
  // bazaars open ~9:30-21:30 and shut their shutters late; smooth ramps
  const up = Math.min(1, Math.max(0, (h - 8.8) / 1.2));
  const down = Math.min(1, Math.max(0, (22.6 - h) / 1.4));
  return Math.min(up, down) * 0.93 + 0.02;
}

export class App {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.q = new URLSearchParams(location.search);
    const t = resolveTier();
    this.detected = t.detected;
    this.tierName = t.tier;
    this.tierForced = t.forced;
    this.tier = structuredClone(TIERS[this.tierName]);
    this.settings = this.tier.settings;
    // MSAA: real GPUs only (software renderer / phones skip it)
    this.settings.msaa = this.tierName === 'high' ? 4 : this.tierName === 'medium' ? 2 : 0;
    this.settings.cloudMode = this.tierName === 'high' ? 'volumetric' : this.tierName === 'medium' ? 'layered' : 'flat';
    this.settings.fogNoise = this.tierName !== 'low';
    if (this.detected.info.software && !t.forced) {
      // headless/software-GL verification: keep it cheap but structurally representative
      this.settings.msaa = 0;
    }
    if (this.q.has('msaa')) this.settings.msaa = +this.q.get('msaa');
    this.opts = opts;
    this.systems = [];
    this.frameHooks = [];
    this.updateHooks = [];
    this.perf = new PerfMonitor();
    this.clock = new SimClock();
    this.weather = new Weather('clear');
    this.env = new EnvState();
    this.mode = 'explore';
    this.flash = 0;
    this.debug = { fogScale: 1, exposure: 1, bloom: 1 }; // harness / tuning overrides
  }

  async init(progress = () => {}) {
    const s = this.settings;
    installEnvironmentHooks();
    progress('renderer');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: !!this.q.has('shot') });
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = s.shadowCascades > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xffffff, 1e-5); // only to switch USE_FOG on; density comes from ENV
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 90000);
    this.camera.position.set(0, 60, 250);
    this.camera.lookAt(0, 30, 0);

    this.drs = new DynamicResolution({ min: s.minPixelRatio, max: Math.min(s.maxPixelRatio, window.devicePixelRatio || 1), targetMs: 1000 / this.tier.targetFps, enabled: s.dynamicResolution && !this.q.has('shot') });
    if (this.q.has('pr')) { this.drs.enabled = false; this.drs.scale = +this.q.get('pr'); }
    this.pixelRatio = this.drs.scale;

    progress('sky');
    this.post = new PostFX(this.renderer, s);
    this.sky = new SkySystem(this.renderer, this.scene, s);
    this.lighting = new Lighting(this.scene, this.camera, s);

    progress('terrain');
    this.hf = new Heightfield();
    await this.hf.load(`${import.meta.env.BASE_URL}data/terrain/`);
    this.terrain = new Terrain(this.hf, s);
    for (const r of this.terrain.rings) this.lighting.setupMaterial(r.material);
    this.scene.add(this.terrain.group);

    progress('city');
    await this.initCity();

    this.fx = new WeatherFx({ scene: this.scene, settings: s, hf: this.hf });
    // wet-street planar reflection (high / medium tiers): the road material samples it
    this.reflection = new PlanarReflection(this.renderer, s);
    if (this.reflection.enabled) {
      const ex = this.city.roadMat.userData.extra;
      ex.uReflTex.value = this.reflection.rt.texture;
      ex.uReflMat.value = this.reflection.textureMatrix;
    }

    this.overlay = new PerfOverlay(this.perf, () => this.reportContext());
    if (this.q.has('perf')) this.overlay.toggle(true);
    window.addEventListener('keydown', (e) => { if (e.key === '`' || (e.key === 'p' && !e.ctrlKey && !e.metaKey)) this.overlay.toggle(); });
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.loop = new Loop({
      fixedDt: 1 / 30,
      update: (dt) => this.update(dt),
      render: (dt, alpha) => this.frame(dt, alpha),
    });
    this.loop.fpsCap = s.fpsCap;
    this.loop.onFrameTime = (raw) => {
      this.perf.pushFrame(raw);
      const sc = this.drs.push(raw);
      if (sc !== null) { this.pixelRatio = sc; this.resize(); }
    };

    // initial state
    this.setTime(this.q.get('t') ? +this.q.get('t') : 6.6);
    if (this.q.get('weather')) this.setWeather(this.q.get('weather'), true);
    this.sky.updateEnvironment(this.env);
    return this;
  }

  async initCity() {
    let source;
    if (import.meta.env.VITE_LAB) {
      // dev-only synthetic test district (NOT Jaipur): lets the renderer be exercised while real OSM data is unreachable
      const [{ syntheticDistrict }, { bakeElements }] = await Promise.all([
        import('../tests/fixtures/synthetic-district.mjs'),
        import('../scripts/lib/bake-elements.mjs'),
      ]);
      const { files, manifest } = bakeElements(syntheticDistrict());
      const chunks = new Map();
      for (const [name, obj] of files) if (name !== 'manifest.json' && name !== 'graph.json') chunks.set(name.replace('.json', ''), obj);
      source = new MemorySource(manifest, chunks);
      this.labMode = true;
    } else {
      source = new NetworkSource(`${import.meta.env.BASE_URL}data/osm/`);
    }
    // lab district is synthetic and not Jaipur: no landmarks there
    this.city = new City({
      scene: this.scene, lighting: this.lighting, settings: this.settings, source, hf: this.hf,
      onManifest: this.labMode ? null : (man) => { this.landmarkPlan = planLandmarks(man); return this.landmarkPlan.exclude; },
    });
    const ok = await this.city.init();
    await this.loadCover(this.city.manifest);
    if (!this.labMode) {
      if (!this.landmarkPlan) this.landmarkPlan = planLandmarks(null); // no OSM data baked: sourced fallback coordinates only
      this.landmarks = new Landmarks({ scene: this.scene, lighting: this.lighting, hf: this.hf, plan: this.landmarkPlan });
    }
    const notice = document.getElementById('notice');
    if (!ok && notice) {
      notice.textContent = 'OpenStreetMap city data (buildings, streets) is not baked into this build yet, because the build sandbox could not reach the Overpass API. Terrain, sky, weather and landmarks are shown. See PROGRESS.md.';
      notice.hidden = false;
    } else if (this.labMode && notice) {
      notice.textContent = 'RENDERER LAB: synthetic test geometry, not Jaipur.';
      notice.hidden = false;
    }
  }

  /** OSM land cover raster (water, vegetation, parks, built-up land) for the terrain shader; absent data just leaves the terrain as is */
  async loadCover(manifest) {
    const c = manifest && manifest.cover;
    if (!c || this.labMode) return;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/osm/${c.file}`);
      if (!r.ok || (r.headers.get('content-type') || '').includes('html')) return;
      // a host may or may not add its own Content-Encoding on top: accept raw RGBA as well as our gzip payload (detected by its magic bytes)
      let bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length !== c.w * c.h * 4 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (typeof DecompressionStream === 'undefined') { console.warn('land cover needs DecompressionStream; skipped'); return; }
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      }
      if (bytes.length !== c.w * c.h * 4) { console.warn('land cover size mismatch, ignored'); return; }
      this.terrain.setCover(bytes, c);
    } catch (e) {
      console.warn('land cover unavailable', e);
    }
  }

  // ---- state helpers (also used by the screenshot harness) ---------------------------------
  setTime(hours, preset) {
    if (preset) this.clock.setPreset(preset, hours);
    else this.clock.setHours(hours);
  }
  setDate(y, mo, d, hours) {
    this.clock.set(fromIST(y, mo, d, Math.floor(hours), Math.round((hours % 1) * 60)));
  }
  setWeather(name, instant = false) {
    if (WEATHER_PRESETS[name]) this.weather.set(name, instant);
  }
  setView(pos, look, fov) {
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.lookAt(look[0], look[1], look[2]);
    if (fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
  }

  add(system) {
    this.systems.push(system);
    return system;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const bw = Math.round(w * this.pixelRatio), bh = Math.round(h * this.pixelRatio);
    this.post.setSize(bw, bh);
    this.reflection?.setSize(bw, bh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lighting?.updateFrustums();
  }

  /** GPU-independent resource numbers for the budget gate (draw calls, triangles and geometries come from the last rendered frame). */
  resourceReport() {
    const info = this.perf.lastInfo;
    const tex = estimateTextureMB({ post: this.post, sky: this.sky, lighting: this.lighting, terrain: this.terrain, hf: this.hf, ENV }, this.scene);
    const inst = countInstances(this.scene);
    return { tier: this.tierName, drawCalls: info.drawCalls, triangles: info.triangles, geometries: info.geometries, textureMB: +tex.mb.toFixed(1), textureTop: tex.rows.slice(0, 8).map((r) => `${r.label} ${r.mb.toFixed(1)}MB`), instances: inst.total, instancesBy: inst.by };
  }

  reportContext() {
    return {
      tier: this.tierName,
      tierForced: this.tierForced,
      pixelRatio: +this.pixelRatio.toFixed(2),
      width: this.renderer.domElement.width,
      height: this.renderer.domElement.height,
      simTime: this.clock.dateISTString,
      weather: this.weather.name,
      mode: this.mode,
      gpu: this.detected.info.gpu,
      detected: this.detected.tier,
      reasons: this.detected.reasons,
      extra: this.perf.extra,
    };
  }

  // ---- loop ---------------------------------------------------------------------------------
  update(dt) {
    this.clock.step(dt);
    this.weather.update(dt, this.clock.speed);
    for (const s of this.systems) s.update?.(dt, this);
  }

  frame(dt, alpha) {
    const cam = this.camera;
    for (const h of this.frameHooks) h(dt, this);
    for (const s of this.systems) s.frame?.(dt, alpha, this);

    computeEnv(this.env, this.clock.ms, this.weather.s);
    const flash = this.weather.flash;
    this.sky.update(this.env, this.weather.s, dt, { windOffset: this.weather.windOffset, time: this.clock.elapsed, flash, camera: cam });
    ENV.uFog.value.x *= this.debug.fogScale;
    this.updateWetUniforms();
    this.fx.frame(dt, this);
    this.lighting.update(this.env, dt);
    this.terrain.update(cam);
    this.updateVeg();
    this.city.update(cam, dt);
    this.city.setNight(this.env.night);
    BUILDING_UNIFORMS.uShopOpen.value = shopOpenFraction(this.clock.hours);

    // dynamic near plane keeps depth precision when close to the ground
    const h = Math.max(0.5, cam.position.y - this.hf.heightAt(cam.position.x, cam.position.z));
    const near = Math.min(20, Math.max(0.4, h * 0.02));
    if (Math.abs(near - cam.near) > 0.05 * cam.near) { cam.near = near; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    const r = this.renderer;
    // planar reflection first (only while the ground is wet and the camera is near the ground)
    const refl = this.reflection;
    if (refl && refl.enabled) {
      const wet = this.weather.s.wetness, gy = this.hf.heightAt(cam.position.x, cam.position.z);
      const ex = this.city.roadMat.userData.extra, rex = ex.uRefl.value;
      // shadow maps must exist before a second render pass (their samplers would bind an empty non-depth texture), and the road material
      // must not sample the reflection target while roads are drawn into it (framebuffer feedback loop): give it a dummy for the pass
      const shadowsReady = !this.lighting.csm || this.lighting.csm.lights.every((l) => l.shadow.map);
      let done = false;
      const hAbove = cam.position.y - gy, maxH = this.settings.reflectionMaxHeight || 200;
      if (wet > 0.03 && shadowsReady && hAbove < maxH) {
        if (!this._dummyTex) { this._dummyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this._dummyTex.needsUpdate = true; }
        ex.uReflTex.value = this._dummyTex;
        done = refl.render(this.scene, cam, gy + 0.05, [this.fx.rain.group]);
        ex.uReflTex.value = refl.rt.texture;
      }
      if (done) { rex.x = Math.min(1, wet * 1.15); rex.y = 1.0 - Math.min(1, Math.max(0, (hAbove - 0.6 * maxH) / (0.4 * maxH))); } else rex.x = 0;
    }
    r.setRenderTarget(this.post.target);
    r.clear();
    r.render(this.scene, cam);
    this.perf.captureInfo(r);
    const e = this.env;
    this.post.finish({
      exposure: e.exposure * this.debug.exposure,
      bloom: this.settings.bloom ? (0.06 + 0.05 * e.night) * this.debug.bloom : 0,
      time: this.clock.elapsed,
      flash,
      vignette: 0.24,
      dust: Math.min(1, this.weather.s.dust * (0.1 + 0.9 * this.weather.s.storm)) * 0.9,
      grade: [1.0 + 0.04 * (1 - e.night), 1, Math.max(0, 1 - Math.abs(e.sunAlt - 4) / 25)],
    });
    r.info.reset();
    this.overlay.update(performance.now());
  }

  updateWetUniforms() {
    const w = this.weather.s;
    ENV.uWet.value.set(w.wetness, w.rain, w.puddles, this.weather.flash);
  }

  updateVeg() {
    const w = this.weather.s;
    // greenness lags wetness (monsoon greens the Aravalli slowly); simple proxy here
    const u = this.terrain.uniforms.uVeg.value;
    u.x += ((0.25 + 0.7 * w.wetness) - u.x) * 0.002;
    u.y = 1 - 0.7 * w.wetness;
    u.z = w.wetness;
  }

  /** Deterministic still: settle lighting/IBL for the current state and render `n` frames (harness / tests). */
  renderStill(n = 2) {
    this.clock.step(0);
    for (let i = 0; i < n; i++) {
      computeEnv(this.env, this.clock.ms, this.weather.s);
      this.sky._lutKey = '';
      this.sky.update(this.env, this.weather.s, 10, { windOffset: this.weather.windOffset, time: this.clock.elapsed, flash: this.weather.flash, camera: this.camera });
      this.frame(0.016, 0);
    }
  }

  start() {
    if (this.q.has('shot')) return; // harness drives frames itself
    this.loop.start();
  }
}
