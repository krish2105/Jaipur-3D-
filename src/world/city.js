// Streams OSM tiles: fetch baked chunks -> worker builds geometry -> meshes/instances added to the scene.
import * as THREE from 'three';
import { createBuildingMaterial, makeTileGeometry } from './facadeMaterial.js';
import { createRoadMaterial } from './roadMaterial.js';
import { InstancePool, makeJharokhaGeometry, makeChhatriGeometry, makeLampPostGeometry, makeLampHeadGeometry, makeTreeGeometry, LinePool } from './props.js';
import TileWorker from './tileWorker.js?worker';

const TILE = 500;

/** Chunk source over the network (production). */
export class NetworkSource {
  constructor(base) { this.base = base; this.cache = new Map(); }
  async _json(url) {
    try {
      const r = await fetch(url);
      // static hosts may answer missing files with an HTML fallback page: treat as absent
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
      return await r.json();
    } catch {
      return null;
    }
  }
  manifest() {
    return this._json(this.base + 'manifest.json');
  }
  get(kind, ix, iz) {
    const k = `${kind}_${ix}_${iz}`;
    if (!this.cache.has(k)) {
      this.cache.set(k, this._json(`${this.base}${k}.json`));
    }
    return this.cache.get(k);
  }
}

/** Chunk source over in-memory objects (lab / tests). */
export class MemorySource {
  constructor(manifest, chunks) { this._m = manifest; this.chunks = chunks; }
  async manifest() { return this._m; }
  async get(kind, ix, iz) { return this.chunks.get(`${kind}_${ix}_${iz}`) || null; }
}

export class City {
  /**
   * @param {object} o { scene, lighting, settings, source, hf (Heightfield|null), flatGround }
   */
  constructor(o) {
    this.scene = o.scene;
    this.lighting = o.lighting;
    this.settings = o.settings;
    this.source = o.source;
    this.hf = o.hf || null;
    this.flatGround = o.flatGround ?? null;
    this.onManifest = o.onManifest || null; // (manifest) => exclusion list for the tile worker
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.tiles = new Map();
    this.available = false;
    this.manifest = null;
    this.inFlight = 0;
    this.maxInFlight = 2;
    this.queue = [];
    this._acc = 0;
    this.stats = { tiles: 0, detail: 0, buildings: 0, tris: 0, workerMs: 0 };

    this.bldMat = createBuildingMaterial();
    this.roadMat = createRoadMaterial();
    o.lighting?.setupMaterial(this.bldMat);
    o.lighting?.setupMaterial(this.roadMat);
    const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    propMat.userData.programKey = 'props';
    o.lighting?.setupMaterial(propMat);
    this.propMat = propMat;
    const s = this.settings;
    this.pools = {
      // oriels are ~1.5 m: they do not cast a shadow worth a second (and third, fourth) pass over every instance
      jharokha: new InstancePool(makeJharokhaGeometry(), propMat, s.jharokhaPool ?? Math.max(500, s.vehicles * 6), { name: 'jharokha', castShadow: false }),
      chhatri: new InstancePool(makeChhatriGeometry(), propMat, 400, { name: 'chhatri' }),
      lamp: new InstancePool(makeLampPostGeometry(), propMat, 1500, { name: 'lamps' }),
      tree: new InstancePool(makeTreeGeometry(), propMat, 2500, { name: 'trees', castShadow: false }),
    };
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.45, 0.4), toneMapped: false });
    this.pools.lampHead = new InstancePool(makeLampHeadGeometry(), this.lampHeadMat, 1500, { name: 'lampHeads', castShadow: false, receiveShadow: false });
    // overhead utility wires: one shared line buffer, dark, fading out with distance (lines do not get the aerial-perspective fog)
    const wireMat = new THREE.LineBasicMaterial({ color: 0x14110e, transparent: true, depthWrite: false });
    wireMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vWireD;\nvoid main() {').replace('#include <project_vertex>', '#include <project_vertex>\n vWireD = length(mvPosition.xyz);');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vWireD;\nvoid main() {').replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= 1.0 - smoothstep(70.0, 190.0, vWireD);');
    };
    wireMat.userData.programKey = 'wires';
    this.pools.wire = new LinePool(s.wireVerts ?? 20000, wireMat, 'wires');
    for (const p of Object.values(this.pools)) this.group.add(p.mesh);
    this.scene.add(this.group);

    this.worker = new TileWorker();
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this._ready = new Promise((res) => { this._readyRes = res; });
    this._pending = new Map();
  }

  async init() {
    const w = this.worker;
    // the manifest comes first: the landmark plan derived from it says which OSM footprints the worker must drop
    this.manifest = await this.source.manifest();
    this.available = !!this.manifest && Object.keys(this.manifest.tiles || {}).length > 0;
    const exclude = this.onManifest ? this.onManifest(this.manifest) : null;
    if (this.hf && this.hf.sampler) {
      const s = this.hf.sampler;
      w.postMessage({ type: 'init', near: s.near, nearN: s.nearN, nearHalf: s.nearHalf, far: s.far, farN: s.farN, farHalf: s.farHalf, exclude });
    } else {
      w.postMessage({ type: 'init', flat: this.flatGround ?? 0, exclude });
    }
    await this._ready;
    return this.available;
  }

  setNight(k, open) {
    // lamp heads glow after dark
    const g = 0.4 + k * 14;
    this.lampHeadMat.color.setRGB(g, g * 0.72, g * 0.38);
    this.bldMat.uniforms;
  }

  _wanted(cam) {
    const S = this.settings;
    const R = S.farTileRadius;
    const c = TILE;
    const cx = cam.x / c, cz = cam.z / c;
    const r = Math.ceil(R / c) + 1;
    const want = new Map();
    const man = this.manifest.tiles;
    for (let ix = Math.floor(cx) - r; ix <= Math.floor(cx) + r; ix++)
      for (let iz = Math.floor(cz) - r; iz <= Math.floor(cz) + r; iz++) {
        const key = `${ix}_${iz}`;
        if (!man[key]) continue;
        const dx = Math.max(ix * c - cam.x, 0, cam.x - (ix + 1) * c);
        const dz = Math.max(iz * c - cam.z, 0, cam.z - (iz + 1) * c);
        const d = Math.hypot(dx, dz);
        if (d <= R) want.set(key, { ix, iz, d, detail: d <= S.tileRadius, ov: d <= (S.overtureRadius ?? Infinity) });
      }
    return want;
  }

  update(camera, dt) {
    if (!this.available) return;
    this._acc += dt;
    if (this._acc < 0.25) return;
    this._acc = 0;
    const want = this._wanted(camera.position);
    // unload
    for (const [key, t] of this.tiles) {
      const w = want.get(key);
      if (!w && !t.loading) {
        const d = Math.hypot(Math.max(t.ix * TILE - camera.position.x, 0, camera.position.x - (t.ix + 1) * TILE), Math.max(t.iz * TILE - camera.position.z, 0, camera.position.z - (t.iz + 1) * TILE));
        if (d > this.settings.farTileRadius * 1.2) this._unload(key);
      }
    }
    // request (nearest first)
    const todo = [...want.entries()].sort((a, b) => a[1].d - b[1].d);
    for (const [key, w] of todo) {
      const t = this.tiles.get(key);
      if (t && (t.loading || !this._needs(t, w))) continue;
      if (this.inFlight >= this.maxInFlight) break;
      // never downgrade a built tile (avoids thrash): the request keeps whatever richness the tile already has
      this._request(key, t && t.detail != null ? { ...w, detail: w.detail || t.detail, ov: w.ov || t.ov } : w);
    }
  }

  /** does a wanted state need a (re)build of tile t? Only upgrades (far -> detail, OSM-only -> with Overture fill) do; downgrades wait for the unload. */
  _needs(t, w) {
    return t.detail == null || (w.detail && !t.detail) || (w.ov && !t.ov);
  }

  async _request(key, w) {
    this.inFlight++;
    let t = this.tiles.get(key);
    if (!t) { t = { ix: w.ix, iz: w.iz, key, loading: true, detail: null, parts: [], ranges: {} }; this.tiles.set(key, t); }
    t.loading = true;
    const { ix, iz } = w;
    try {
      const need = [];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) need.push(this.source.get('r', ix + dx, iz + dz));
      const [b, m, ...roads] = await Promise.all([this.source.get('b', ix, iz), w.detail ? this.source.get('m', ix, iz) : Promise.resolve(null), ...need]);
      this.worker.postMessage({ type: 'tile', key, ix, iz, detail: w.detail, ov: w.ov, ovPlain: !!this.settings.overturePlain, b, misc: m, roads });
    } catch (err) {
      console.warn('tile request failed', key, err);
      this.inFlight--;
      t.loading = false;
    }
  }

  _onWorker(m) {
    if (m.type === 'ready') { this._readyRes(); return; }
    if (m.type !== 'tile') return;
    this.inFlight = Math.max(0, this.inFlight - 1);
    const t = this.tiles.get(m.key);
    if (!t) return;
    t.loading = false;
    if (m.error) { console.error('tile build failed', m.key, m.error); return; }
    this._clearParts(t);
    t.detail = m.detail;
    t.ov = m.ov;
    const ox = m.ix * TILE, oz = m.iz * TILE;
    if (m.bld && m.bld.vertexCount) {
      const mesh = new THREE.Mesh(makeTileGeometry(m.bld), this.bldMat);
      mesh.position.set(ox, 0, oz);
      mesh.castShadow = m.detail;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      t.parts.push(mesh);
      this.stats.tris += m.bld.triCount;
      // instances (detail only)
      const inst = m.bld.inst;
      if (m.detail && inst.jharokha.length) this._placeJharokhas(t, inst.jharokha, ox, oz);
      if (m.detail && inst.chhatri.length) this._placeChhatris(t, inst.chhatri, ox, oz);
    }
    if (m.detail && m.wires && m.wires.length) {
      const wr = this.pools.wire.alloc(m.wires.length / 3);
      if (wr) { this.pools.wire.write(wr, m.wires, ox, oz); t.ranges.wire = wr; }
    }
    if (m.roads && m.roads.vertexCount) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.roads.pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(m.roads.uv, 2));
      g.setAttribute('aR', new THREE.BufferAttribute(m.roads.aR, 4));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m.roads.vertexCount * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(new THREE.BufferAttribute(m.roads.idx, 1));
      g.computeBoundingSphere();
      const rm = new THREE.Mesh(g, this.roadMat);
      rm.position.set(ox, 0, oz);
      rm.receiveShadow = true;
      rm.matrixAutoUpdate = false;
      rm.updateMatrix();
      this.group.add(rm);
      t.parts.push(rm);
    }
    if (m.detail) {
      if (m.lamps && m.lamps.length) this._placeSimple(t, 'lamp', m.lamps, ox, oz, 1);
      if (m.trees && m.trees.length) this._placeSimple(t, 'tree', m.trees, ox, oz, 2);
    }
    this._recount();
  }

  _placeJharokhas(t, a, ox, oz) {
    const n = a.length / 7;
    const r = this.pools.jharokha.alloc(n);
    if (!r) return;
    t.ranges.jharokha = r;
    const e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.pools.jharokha.write(r, (i, M) => {
      const k = i * 7;
      const sc = a[k + 4] / 1.56;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a[k + 3]);
      // instance heights from the tile worker are ABSOLUTE (they already include the building's base height): adding the terrain height again floats them
      p.set(ox + a[k], a[k + 1], oz + a[k + 2]);
      s.set(sc, sc, sc);
      M.compose(p, q, s);
    });
  }

  _placeChhatris(t, a, ox, oz) {
    const n = a.length / 5;
    const r = this.pools.chhatri.alloc(n);
    if (!r) return;
    t.ranges.chhatri = r;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.pools.chhatri.write(r, (i, M) => {
      const k = i * 5;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a[k + 4] * 6.28);
      p.set(ox + a[k], a[k + 1], oz + a[k + 2]); // absolute height, see above
      const sc = a[k + 3] * 0.9;
      s.set(sc, sc, sc);
      M.compose(p, q, s);
    });
  }

  _placeSimple(t, type, arr, ox, oz, scaleMode) {
    const n = arr.length / 3;
    const pool = this.pools[type];
    const r = pool.alloc(n);
    if (!r) return;
    t.ranges[type] = r;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    pool.write(r, (i, M) => {
      const k = i * 3;
      const h = Math.abs(Math.sin((ox + arr[k]) * 12.9898 + (oz + arr[k + 2]) * 78.233)) ;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h * 6.28);
      p.set(ox + arr[k], arr[k + 1], oz + arr[k + 2]);
      const sc = scaleMode === 2 ? 0.8 + h * 0.7 : 1;
      s.set(sc, sc, sc);
      M.compose(p, q, s);
    });
    if (type === 'lamp') {
      // heads share transforms
      const hr = this.pools.lampHead.alloc(n);
      if (hr) {
        t.ranges.lampHead = hr;
        this.pools.lampHead.write(hr, (i, M) => {
          const k = i * 3;
          const h = Math.abs(Math.sin((ox + arr[k]) * 12.9898 + (oz + arr[k + 2]) * 78.233));
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h * 6.28);
          p.set(ox + arr[k], arr[k + 1], oz + arr[k + 2]);
          s.set(1, 1, 1);
          M.compose(p, q, s);
        });
      }
    }
  }

  _ground(x, z) {
    return this.hf ? this.hf.heightAt(x, z) : (this.flatGround ?? 0);
  }

  _clearParts(t) {
    for (const p of t.parts) { this.group.remove(p); p.geometry.dispose(); }
    t.parts = [];
    for (const [type, r] of Object.entries(t.ranges)) this.pools[type].release(r);
    t.ranges = {};
  }

  _unload(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    this._clearParts(t);
    this.tiles.delete(key);
    this._recount();
  }

  _recount() {
    let d = 0;
    for (const t of this.tiles.values()) if (t.detail) d++;
    this.stats.tiles = this.tiles.size;
    this.stats.detail = d;
  }

  /** wait until the streaming queue is idle (harness) */
  async settle(camera, timeoutMs = 60000) {
    const t0 = performance.now();
    do {
      this._acc = 1;
      this.update(camera, 0.3);
      await new Promise((r) => setTimeout(r, 40));
      if (performance.now() - t0 > timeoutMs) break;
    } while (this.inFlight > 0 || [...this.tiles.values()].some((t) => t.loading) || [...this._wanted(camera.position).entries()].some(([k, w]) => !this.tiles.get(k) || this._needs(this.tiles.get(k), w)));
  }
}
