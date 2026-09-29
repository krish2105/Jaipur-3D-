// Landmarks: place the hand-modelled heroes at their OSM positions/orientations, sit them on the terrain, and tell the tile worker
// which OSM footprints they replace. Split in two so the suppression list exists BEFORE any tile is built:
//   planLandmarks(manifest)  pure, no three.js objects  -> { items, exclude }
//   new Landmarks({...})     builds meshes from the plan and adds them to the scene
import * as THREE from 'three';
import { createHeroMaterial } from './kit.js';
import { buildHawaMahal } from './hawaMahal.js';
import { buildJantarMantar, buildJantarMantarFromSite } from './jantarMantar.js';
import { buildJalMahal } from './jalMahal.js';
import { buildChandraMahal, buildMubarakMahal, buildGatehouse, poseFromBox } from './cityPalace.js';
import { locate, hawaPose, buildExclusion, addFootprints, rectRing, orientedBox } from './plan.js';

// model footprints used for suppression (metres); Hawa Mahal: facade width + storey overhangs, depth of plinth + rear block
const HAWA = { width: 40, depth: 27.5 };
const GATE_MAX = { len: 60, dep: 26 }; // larger city_gate outlines stay as plain OSM buildings (they are compounds, not gatehouses)

/**
 * @returns {{items: object[], exclude: {ids:string[], rings:number[][][], discs:object[], foots?:object[]}}}
 *   item: { key, kind, x, z, yaw, ... }  (x,z = model origin in world metres)
 */
export function planLandmarks(manifest) {
  const man = manifest || { landmarks: {}, sites: {}, gates: [] };
  const items = [];
  const placements = []; // for buildExclusion()
  const foots = [];
  const extraIds = [];

  // ---- Hawa Mahal: facade on the east edge of its block, facing east (the street side)
  const hp = hawaPose(man);
  if (hp) {
    const ux = hp.nz, uz = -hp.nx; // model +x in world
    items.push({ key: 'hawaMahal', kind: 'hawa', source: hp.source, x: hp.x, z: hp.z, yaw: hp.yaw, ux, uz, nx: hp.nx, nz: hp.nz, blockId: hp.blockId });
    foots.push(rectRing(hp.x - hp.nx * (HAWA.depth / 2 - 1), hp.z - hp.nz * (HAWA.depth / 2 - 1), ux, uz, HAWA.width, HAWA.depth));
  }

  // ---- Jantar Mantar: compound ring + mapped instruments (OSM) or the approx fallback layout at the sourced coordinate
  const site = man.sites?.jantarMantar;
  if (site && site.ring) {
    let ox = 0, oz = 0;
    for (const [x, z] of site.ring) { ox += x; oz += z; }
    ox /= site.ring.length; oz /= site.ring.length;
    items.push({ key: 'jantarMantar', kind: 'jm', source: 'osm', x: ox, z: oz, yaw: 0, site });
    for (const i of site.instruments) extraIds.push(i.id);
  } else {
    const l = locate(man, 'jantarMantar');
    if (l) { items.push({ key: 'jantarMantar', kind: 'jmFallback', source: l.source, x: l.x, z: l.z, yaw: 0 }); placements.push({ key: 'jantarMantar', x: l.x, z: l.z, ring: null }); }
  }

  // ---- Jal Mahal: long axis along the OSM footprint's long axis when mapped
  const jal = locate(man, 'jalMahal');
  if (jal) {
    const yaw = jal.box ? Math.atan2(-jal.box.uz, jal.box.ux) : 0;
    items.push({ key: 'jalMahal', kind: 'jal', source: jal.source, x: jal.x, z: jal.z, yaw, box: jal.box });
    placements.push({ key: 'jalMahal', id: jal.id, x: jal.x, z: jal.z, ring: jal.ring });
  }

  // ---- City Palace pieces (only when mapped: no fallback positions are invented)
  for (const [key, kind] of [['chandraMahal', 'chandra'], ['mubarakMahal', 'mubarak']]) {
    const l = locate({ landmarks: man.landmarks }, key);
    if (l && l.source === 'osm' && l.box) {
      const p = poseFromBox(l.box, [0, 1]); // facade toward the courtyard side (south)
      items.push({ key, kind, source: 'osm', x: p.x, z: p.z, yaw: p.yaw, len: l.box.len, dep: l.box.dep });
      extraIds.push(l.id);
    }
  }

  // ---- city gates whose OSM outline is gatehouse-sized
  for (const g of man.gates || []) {
    if (!g.ring || g.ring.length < 4) continue;
    const box = orientedBox(g.ring);
    if (!box || box.len < 8 || box.len > GATE_MAX.len || box.dep > GATE_MAX.dep) continue;
    const p = poseFromBox(box, [0, 1]);
    items.push({ key: 'gate:' + g.id, kind: 'gate', source: 'osm', name: g.n || null, x: p.x, z: p.z, yaw: p.yaw, len: box.len, dep: box.dep });
    extraIds.push(g.id);
  }

  const exclude = buildExclusion(placements, { margin: 3, discRadius: { jalMahal: 45, jantarMantar: 60 } });
  for (const id of extraIds) if (!exclude.ids.includes(id)) exclude.ids.push(id);
  addFootprints(exclude, foots, 0.6);
  return { items, exclude };
}

/** min terrain height under a set of sample points (world metres) */
function groundMin(hf, pts) {
  let lo = 1e9;
  for (const [x, z] of pts) lo = Math.min(lo, hf.heightAt(x, z));
  return lo;
}

function samples(cx, cz, ux, uz, len, dep) {
  const out = [[cx, cz]];
  for (const a of [-0.5, 0, 0.5]) for (const b of [-0.5, 0.5]) out.push([cx + ux * a * len - uz * b * dep, cz + uz * a * len + ux * b * dep]);
  return out;
}

export class Landmarks {
  /**
   * @param {object} o { scene, lighting, hf, plan }
   */
  constructor(o) {
    this.plan = o.plan;
    this.hf = o.hf;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.items = {};
    this.heroMat = createHeroMaterial('hero');
    o.lighting?.setupMaterial(this.heroMat);
    for (const it of this.plan.items) {
      const obj = this._build(it);
      if (!obj) continue;
      this.items[it.key] = obj;
      this.group.add(obj);
    }
    o.scene.add(this.group);
  }

  _place(obj, it, groundY) {
    obj.position.set(it.x, groundY, it.z);
    obj.rotation.y = it.yaw;
    obj.userData.plan = it;
    obj.updateMatrixWorld(true);
    return obj;
  }

  _build(it) {
    const hf = this.hf;
    const m = this.heroMat;
    switch (it.kind) {
      case 'hawa': {
        const g = buildHawaMahal(m, m);
        const ground = groundMin(hf, samples(it.x - it.nx * 13, it.z - it.nz * 13, it.ux, it.uz, HAWA.width, HAWA.depth));
        return this._place(g, it, ground - 0.1);
      }
      case 'jm': {
        const g = buildJantarMantarFromSite(m, it.site);
        const o = g.userData.origin;
        let lo = 1e9, hi = -1e9;
        for (const [x, z] of it.site.ring) { const h = hf.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        // the floor and walls are flat: sit on the median so both cut and fill stay small; the model carries a skirt below y = 0
        const ground = (lo + hi) / 2;
        return this._place(g, { ...it, x: o.x, z: o.z }, ground);
      }
      case 'jmFallback': {
        const g = buildJantarMantar(m);
        return this._place(g, it, hf.heightAt(it.x, it.z));
      }
      case 'jal': {
        const g = buildJalMahal(m); // dims default to the mapped OSM body (~59 x 55 m)
        // the lake surface is the terrain's flat water level; the model's y = 0 is the water line
        const y = hf.isLake(it.x, it.z) ? hf.lakeLevel : hf.heightAt(it.x, it.z);
        return this._place(g, it, y);
      }
      case 'chandra':
      case 'mubarak': {
        const g = it.kind === 'chandra' ? buildChandraMahal(m, { len: it.len, dep: it.dep }) : buildMubarakMahal(m, { len: it.len, dep: it.dep });
        const ux = Math.cos(it.yaw), uz = -Math.sin(it.yaw);
        return this._place(g, it, groundMin(hf, samples(it.x, it.z, ux, uz, it.len, it.dep)) - 0.1);
      }
      case 'gate': {
        const g = buildGatehouse(m, { len: it.len, dep: it.dep });
        const ux = Math.cos(it.yaw), uz = -Math.sin(it.yaw);
        return this._place(g, it, groundMin(hf, samples(it.x, it.z, ux, uz, it.len, it.dep)) - 0.1);
      }
      default:
        return null;
    }
  }
}
