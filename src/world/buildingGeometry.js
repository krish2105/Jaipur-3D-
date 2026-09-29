// Hand-written building extrusion (no ExtrudeGeometry). Pure functions, safe in a Web Worker and in node tests.
//
// Vertex data per tile (all coordinates tile-local metres; the mesh is positioned at the tile origin):
//   position f32x3, normal i8x3(+pad), uv f32x2   walls: u = metres along the wall (0..L), v = metres above the building base
//                                                 roofs: u,v = world-aligned metres (tile-local x,z)
//   a1 u8x4 : seedA, seedB, kind/16, class/16     kind: 0 wall 1 roof 2 parapet top 3 parapet inner 4 plinth 5 clutter 6 cornice 7 dome/pitched roof
//   a2 u16x4: buildingHeight/128, wallLength/256, storeys/32, flags/255   flags bit0 faceRoad, bit1 bazaar, bit2 heritage, bit3 lit-shopfront
import { ShapeUtils, Vector2 } from 'three';
import { hash01 } from '../core/rng.js';
import { q8, bayLayout, groundHeight, isShopWall, jharokhaAt, storeyHeight } from './facadeSpec.js';

export const KIND = { WALL: 0, ROOF: 1, PARAPET_TOP: 2, PARAPET_IN: 3, PLINTH: 4, CLUTTER: 5, CORNICE: 6, PITCHED: 7 };
export const CLASS_CODE = { res: 0, com: 1, rel: 2, pub: 3, ind: 4, her: 5, min: 6, oth: 7 };
const DM = 10;

const parseId = (s) => {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
};

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.a1 = [];
    this.a2 = [];
    this.idx = [];
    this.n = 0;
  }
  vert(x, y, z, nx, ny, nz, u, v, a1, a2) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.a1.push(a1[0], a1[1], a1[2], a1[3]);
    this.a2.push(a2[0], a2[1], a2[2], a2[3]);
    return this.n++;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  finish() {
    const n = this.n;
    const pos = new Float32Array(this.pos);
    const nrm = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) {
      nrm[i * 4] = Math.round(this.nrm[i * 3] * 127);
      nrm[i * 4 + 1] = Math.round(this.nrm[i * 3 + 1] * 127);
      nrm[i * 4 + 2] = Math.round(this.nrm[i * 3 + 2] * 127);
    }
    const uv = new Float32Array(this.uv);
    const a1 = new Uint8Array(n * 4);
    for (let i = 0; i < n * 4; i++) a1[i] = Math.max(0, Math.min(255, Math.round(this.a1[i] * 255)));
    const a2 = new Uint16Array(n * 4);
    for (let i = 0; i < n * 4; i++) a2[i] = Math.max(0, Math.min(65535, Math.round(this.a2[i] * 65535)));
    const idx = n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    return { pos, nrm, uv, a1, a2, idx, vertexCount: n, triCount: this.idx.length / 3 };
  }
}

function ringMetres(flat) {
  const out = new Array(flat.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = [flat[2 * i] / DM, flat[2 * i + 1] / DM];
  return out;
}

/** inset a ring by t metres (miter). Outer rings are CCW (from above); pass sign=+1 to shrink, -1 to grow. */
function insetRing(r, t) {
  const n = r.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = r[(i + n - 1) % n], p1 = r[i], p2 = r[(i + 1) % n];
    let d0x = p1[0] - p0[0], d0z = p1[1] - p0[1], l0 = Math.hypot(d0x, d0z) || 1;
    let d1x = p2[0] - p1[0], d1z = p2[1] - p1[1], l1 = Math.hypot(d1x, d1z) || 1;
    d0x /= l0; d0z /= l0; d1x /= l1; d1z /= l1;
    // outward normals (-dz, dx); inward = negative
    const n0x = d0z, n0z = -d0x, n1x = d1z, n1z = -d1x; // inward
    let mx = n0x + n1x, mz = n0z + n1z;
    const k = 1 + n0x * n1x + n0z * n1z;
    const s = k < 0.15 ? 1 : 1 / k;
    mx *= s; mz *= s;
    out[i] = [p1[0] + mx * t, p1[1] + mz * t];
  }
  return out;
}

function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function triangulate(outer, holes) {
  try {
    const c = outer.map((p) => new Vector2(p[0], p[1]));
    const hs = holes.map((h) => h.map((p) => new Vector2(p[0], p[1])));
    return ShapeUtils.triangulateShape(c, hs);
  } catch {
    return [];
  }
}

function polygonBounds(r) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, x1, z0, z1 };
}

/** Segment-hash of road polylines for "does this wall face a street" queries. */
export class RoadIndex {
  constructor(cell = 32) {
    this.cell = cell;
    this.map = new Map();
    this.segs = [];
  }
  addPolyline(pts, width, name, cls) {
    const bazaar = !!name && /baz+a?a?r|chaupar|chowk|rasta|market|gali/i.test(name) && /^(primary|secondary|tertiary|pedestrian|residential|unclassified|living_street)$/.test(cls);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = { ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], hw: width / 2, bazaar, cls };
      const id = this.segs.push(s) - 1;
      const x0 = Math.floor(Math.min(s.ax, s.bx) / this.cell), x1 = Math.floor(Math.max(s.ax, s.bx) / this.cell);
      const z0 = Math.floor(Math.min(s.az, s.bz) / this.cell), z1 = Math.floor(Math.max(s.az, s.bz) / this.cell);
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const k = cx * 73856093 ^ cz * 19349663;
          let a = this.map.get(k);
          if (!a) this.map.set(k, (a = []));
          a.push(id);
        }
    }
  }
  /** returns {face:boolean, bazaar:boolean, dist:number} for a point (wall midpoint pushed out along its normal) */
  query(x, z, reach = 14) {
    const c = this.cell;
    let best = 1e9, bazaar = false;
    const x0 = Math.floor((x - reach) / c), x1 = Math.floor((x + reach) / c), z0 = Math.floor((z - reach) / c), z1 = Math.floor((z + reach) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const a = this.map.get(cx * 73856093 ^ cz * 19349663);
        if (!a) continue;
        for (const id of a) {
          const s = this.segs[id];
          const dx = s.bx - s.ax, dz = s.bz - s.az;
          const l2 = dx * dx + dz * dz;
          let t = l2 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz)) - s.hw;
          if (d < best) { best = d; bazaar = s.bazaar; }
        }
      }
    return { face: best < reach * 0.55, bazaar: best < reach * 0.55 && bazaar, dist: best };
  }
}

/**
 * Build the merged geometry for one tile.
 * @param {object} chunk   baked building chunk ({t:[ix,iz], b:[...]})
 * @param {object} opts    { detail:boolean, roads:RoadIndex|null, ground: Float32Array(2*n) [baseY, skirt] or null, seed }
 */
export function buildTileGeometry(chunk, opts = {}) {
  const detail = !!opts.detail;
  const roads = opts.roads || null;
  const M = new MeshBuilder();
  const stats = { buildings: 0, walls: 0, facingRoad: 0 };
  const inst = { jharokha: [], chhatri: [] };
  const A2 = [0, 0, 0, 0];

  for (let bi = 0; bi < chunk.b.length; bi++) {
    const b = chunk.b[bi];
    if (!b.p || b.p.length < 6) continue;
    const outer = ringMetres(b.p);
    const holes = (b.q || []).map(ringMetres);
    const id = parseId(b.i);
    const seedA = hash01(id, 1, 11), seedB = hash01(id, 2, 13);
    const cls = CLASS_CODE[b.k] ?? 7;
    const baseY = opts.ground ? opts.ground[bi * 2] : 0;
    const skirt = opts.ground ? opts.ground[bi * 2 + 1] : 1.2;
    const minH = b.m || 0;
    const H = b.h;
    const y0 = baseY + minH;
    const heritage = b.k === 'her' || b.k === 'rel';
    const flatRoof = !b.r || b.r === 'f';
    // parapet only on flat roofs
    const parH = flatRoof && detail && H > 3.2 ? (heritage ? 1.35 : 0.85 + 0.25 * seedB) : 0;
    const storeys = Math.max(1, Math.round((H - 1) / 3.4));
    stats.buildings++;

    const rings = [outer, ...holes];
    let wallIdx = 0;
    for (let ri = 0; ri < rings.length; ri++) {
      const r = rings[ri];
      const n = r.length;
      let u0 = 0;
      for (let i = 0; i < n; i++) {
        const p = r[i], q = r[(i + 1) % n];
        const dx = q[0] - p[0], dz = q[1] - p[1];
        const L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const nx = -dz / L, nz = dx / L; // outward (away from solid)
        // does the wall face a street?
        let flags = 0;
        if (roads) {
          const mx = (p[0] + q[0]) * 0.5 + nx * 3.2, mz = (p[1] + q[1]) * 0.5 + nz * 3.2;
          const rq = roads.query(mx, mz);
          if (rq.face && ri === 0) { flags |= 1; stats.facingRoad++; }
          if (rq.bazaar && ri === 0) flags |= 2;
        }
        if (heritage) flags |= 4;
        wallIdx++;
        if (detail && ri === 0 && (flags & 1) && storeys >= 2 && L > 4.5) {
          const sa = q8(seedA), sb = q8(seedB);
          const shop = isShopWall(flags, cls, sa);
          const gH = groundHeight(sa, shop, sb), sH = storeyHeight(sb);
          const { n: nb, w: bw } = bayLayout(L, sa);
          const yaw = Math.atan2(nx, nz);
          for (let bay = 0; bay < nb; bay++) {
            if (!jharokhaAt(id, wallIdx, bay, (flags & 2) !== 0, nb)) continue;
            if (gH + sH + 0.4 > H) break;
            const t = ((bay + 0.5) * bw) / L;
            inst.jharokha.push(p[0] + dx * t + nx * 0.02, y0 + gH + 0.45, p[1] + dz * t + nz * 0.02, yaw, Math.min(bw * 0.62, 1.7), 1.95, hash01(id, bay, wallIdx));
          }
        }
        const top = y0 + (H - minH) + parH;
        const bottom = y0 - (minH ? 0 : skirt);
        const a1 = [seedA, seedB, KIND.WALL / 16, cls / 16];
        A2[0] = H / 128; A2[1] = L / 256; A2[2] = storeys / 32; A2[3] = flags / 255;
        const vBot = bottom - baseY, vTop = top - baseY;
        const v0 = M.vert(p[0], bottom, p[1], nx, 0, nz, 0, vBot, a1, A2);
        const v1 = M.vert(q[0], bottom, q[1], nx, 0, nz, L, vBot, a1, A2);
        const v2 = M.vert(q[0], top, q[1], nx, 0, nz, L, vTop, a1, A2);
        const v3 = M.vert(p[0], top, p[1], nx, 0, nz, 0, vTop, a1, A2);
        M.quad(v0, v1, v2, v3); // winding checked in tests: front face = outward
        stats.walls++;
        u0 += L;

        if (detail && ri === 0 && L > 3 && (cls === CLASS_CODE.com || heritage || cls === CLASS_CODE.oth || cls === CLASS_CODE.res)) {
          // cornice ledge under the parapet: a thin box protruding 0.16 m
          const cy0 = y0 + (H - minH) - 0.32, cy1 = y0 + (H - minH) + 0.02, e = 0.16;
          const a6 = [seedA, seedB, KIND.CORNICE / 16, cls / 16];
          const ox = nx * e, oz = nz * e;
          const c0 = M.vert(p[0] + ox, cy0, p[1] + oz, nx, 0, nz, 0, cy0 - baseY, a6, A2);
          const c1 = M.vert(q[0] + ox, cy0, q[1] + oz, nx, 0, nz, L, cy0 - baseY, a6, A2);
          const c2 = M.vert(q[0] + ox, cy1, q[1] + oz, nx, 0, nz, L, cy1 - baseY, a6, A2);
          const c3 = M.vert(p[0] + ox, cy1, p[1] + oz, nx, 0, nz, 0, cy1 - baseY, a6, A2);
          M.quad(c0, c1, c2, c3);
          const t0 = M.vert(p[0] + ox, cy1, p[1] + oz, 0, 1, 0, p[0], p[1], a6, A2);
          const t1 = M.vert(q[0] + ox, cy1, q[1] + oz, 0, 1, 0, q[0], q[1], a6, A2);
          const t2 = M.vert(q[0], cy1, q[1], 0, 1, 0, q[0], q[1], a6, A2);
          const t3 = M.vert(p[0], cy1, p[1], 0, 1, 0, p[0], p[1], a6, A2);
          M.quad(t0, t1, t2, t3);
        }
      }
    }

    // ---- roof
    const roofY = y0 + (H - minH);
    A2[0] = H / 128; A2[1] = 0; A2[2] = storeys / 32; A2[3] = heritage ? 4 / 255 : 0;
    const bnds = polygonBounds(outer);
    if (flatRoof || b.r === 's') {
      const yRoof = roofY + (parH ? 0.02 : 0);
      const a1r = [seedA, seedB, KIND.ROOF / 16, cls / 16];
      const all = [...outer, ...holes.flat()];
      const tris = triangulate(outer, holes);
      if (tris.length) {
        const base = M.n;
        for (const p of all) M.vert(p[0], yRoof, p[1], 0, 1, 0, p[0], p[1], a1r, A2);
        for (const t of tris) {
          // orient each triangle explicitly so its geometric normal points up (+y), whatever earcut returned
          const a = all[t[0]], b = all[t[1]], c = all[t[2]];
          const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
          if (up > 0) M.tri(base + t[0], base + t[1], base + t[2]);
          else M.tri(base + t[0], base + t[2], base + t[1]);
        }
      }
      if (parH) {
        // parapet: top cap between outer ring and an inset ring, and the inner face dropping to the roof
        const t = 0.26;
        const inner = insetRing(outer, t);
        const a2p = [seedA, seedB, KIND.PARAPET_TOP / 16, cls / 16];
        const a3p = [seedA, seedB, KIND.PARAPET_IN / 16, cls / 16];
        const topY = roofY + parH;
        const n = outer.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const p = outer[i], q = outer[j], ip = inner[i], iq = inner[j];
          const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
          if (L < 0.05) continue;
          const c0 = M.vert(p[0], topY, p[1], 0, 1, 0, p[0], p[1], a2p, A2);
          const c1 = M.vert(q[0], topY, q[1], 0, 1, 0, q[0], q[1], a2p, A2);
          const c2 = M.vert(iq[0], topY, iq[1], 0, 1, 0, iq[0], iq[1], a2p, A2);
          const c3 = M.vert(ip[0], topY, ip[1], 0, 1, 0, ip[0], ip[1], a2p, A2);
          M.quad(c0, c1, c2, c3);
          // inner face, normal pointing inward (toward the roof)
          const inx = dz / L, inz = -dx / L;
          const f0 = M.vert(ip[0], yRoof, ip[1], inx, 0, inz, 0, 0, a3p, A2);
          const f1 = M.vert(iq[0], yRoof, iq[1], inx, 0, inz, L, 0, a3p, A2);
          const f2 = M.vert(iq[0], topY, iq[1], inx, 0, inz, L, parH, a3p, A2);
          const f3 = M.vert(ip[0], topY, ip[1], inx, 0, inz, 0, parH, a3p, A2);
          M.quad(f0, f3, f2, f1);
        }
      }
      if (detail) addRoofClutter(M, outer, holes, bnds, yRoof, parH, seedA, seedB, cls, id, storeys, A2);
      if (detail && heritage && (bnds.x1 - bnds.x0) * (bnds.z1 - bnds.z0) > 160) {
        const ins = insetRing(outer, 1.6);
        for (let i = 0; i < ins.length; i += Math.max(1, Math.round(ins.length / 4))) inst.chhatri.push(ins[i][0], yRoof, ins[i][1], 1.0 + 0.2 * hash01(id, i, 3), hash01(id, i, 4));
      }
    } else {
      addPitchedRoof(M, outer, bnds, roofY, b.r, seedA, seedB, cls, A2);
    }
  }
  const geo = M.finish();
  geo.stats = stats;
  geo.inst = { jharokha: new Float32Array(inst.jharokha), chhatri: new Float32Array(inst.chhatri) };
  return geo;
}

// ---------------------------------------------------------------------------------------------------
function box(M, cx, y0, cz, sx, sy, sz, yaw, a1, A2) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const hx = sx / 2, hz = sz / 2;
  const P = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
  const y1 = y0 + sy;
  for (let i = 0; i < 4; i++) {
    const p = P[i], q = P[(i + 1) % 4];
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    const nx = -dz / L, nz = dx / L;
    const v0 = M.vert(p[0], y0, p[1], nx, 0, nz, 0, 0, a1, A2);
    const v1 = M.vert(q[0], y0, q[1], nx, 0, nz, L, 0, a1, A2);
    const v2 = M.vert(q[0], y1, q[1], nx, 0, nz, L, sy, a1, A2);
    const v3 = M.vert(p[0], y1, p[1], nx, 0, nz, 0, sy, a1, A2);
    M.quad(v0, v1, v2, v3);
  }
  const t = P.map((p) => M.vert(p[0], y1, p[1], 0, 1, 0, p[0], p[1], a1, A2));
  M.quad(t[0], t[3], t[2], t[1]);
}

function cylinder(M, cx, y0, cz, r, h, seg, a1, A2) {
  const ring = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i < seg; i++) {
    const [c0, s0] = ring[i], [c1, s1] = ring[i + 1];
    const v0 = M.vert(cx + c0 * r, y0, cz + s0 * r, c0, 0, s0, i / seg, 0, a1, A2);
    const v1 = M.vert(cx + c1 * r, y0, cz + s1 * r, c1, 0, s1, (i + 1) / seg, 0, a1, A2);
    const v2 = M.vert(cx + c1 * r, y0 + h, cz + s1 * r, c1, 0, s1, (i + 1) / seg, h, a1, A2);
    const v3 = M.vert(cx + c0 * r, y0 + h, cz + s0 * r, c0, 0, s0, i / seg, h, a1, A2);
    M.quad(v0, v3, v2, v1);
  }
  const ctr = M.vert(cx, y0 + h, cz, 0, 1, 0, cx, cz, a1, A2);
  const base = M.n;
  for (let i = 0; i < seg; i++) M.vert(cx + ring[i][0] * r, y0 + h, cz + ring[i][1] * r, 0, 1, 0, cx, cz, a1, A2);
  for (let i = 0; i < seg; i++) M.tri(ctr, base + (i + 1) % seg, base + i);
}

/** mumty (stair hut), black Sintex water tanks, occasional parapet-top kiosk; placed with rejection sampling. */
function addRoofClutter(M, outer, holes, bnds, roofY, parH, seedA, seedB, cls, id, storeys, A2) {
  const area = (bnds.x1 - bnds.x0) * (bnds.z1 - bnds.z0);
  if (area < 28) return;
  const a1 = [seedA, seedB, KIND.CLUTTER / 16, cls / 16];
  const placeInside = (clear, tries, rnd) => {
    for (let k = 0; k < tries; k++) {
      const x = bnds.x0 + hash01(id, 100 + k, rnd) * (bnds.x1 - bnds.x0);
      const z = bnds.z0 + hash01(id, 200 + k, rnd) * (bnds.z1 - bnds.z0);
      if (!pointInRing(x, z, outer)) continue;
      let ok = true;
      for (const h of holes) if (pointInRing(x, z, h)) ok = false;
      if (!ok) continue;
      // keep off the edges
      const ins = insetRing(outer, clear);
      if (pointInRing(x, z, ins)) return [x, z];
    }
    return null;
  };
  if (area > 45 && hash01(id, 5, 1) < 0.6) {
    const p = placeInside(1.6, 8, 1);
    if (p) box(M, p[0], roofY, p[1], 2.2 + hash01(id, 6, 1) * 1.2, 2.3, 2.4 + hash01(id, 7, 1) * 1.4, hash01(id, 8, 1) * 3.14, [seedA, seedB, KIND.CLUTTER / 16, 0.9], A2);
  }
  const tanks = hash01(id, 9, 2) < 0.7 ? 1 + (hash01(id, 10, 2) < 0.3 ? 1 : 0) : 0;
  for (let t = 0; t < tanks; t++) {
    const p = placeInside(1.0, 8, 3 + t);
    if (p) {
      const r = 0.55 + hash01(id, 11 + t, 2) * 0.25;
      cylinder(M, p[0], roofY, p[1], r, 1.05 + hash01(id, 13 + t, 2) * 0.5, 10, [seedA, seedB, KIND.CLUTTER / 16, 0.95], A2);
    }
  }
}

function addPitchedRoof(M, outer, bnds, roofY, shape, seedA, seedB, cls, A2) {
  const a1 = [seedA, seedB, KIND.PITCHED / 16, cls / 16];
  const cx = (bnds.x0 + bnds.x1) / 2, cz = (bnds.z0 + bnds.z1) / 2;
  const n = outer.length;
  const ext = Math.max(bnds.x1 - bnds.x0, bnds.z1 - bnds.z0);
  if (shape === 'd') {
    // dome: layered rings
    const R = Math.min(bnds.x1 - bnds.x0, bnds.z1 - bnds.z0) * 0.5;
    const rings = 6;
    for (let k = 0; k < rings; k++) {
      const a0 = (k / rings) * (Math.PI / 2), a1a = ((k + 1) / rings) * (Math.PI / 2);
      const r0 = Math.cos(a0), r1 = Math.cos(a1a), h0 = Math.sin(a0) * R * 0.8, h1 = Math.sin(a1a) * R * 0.8;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p = outer[i], q = outer[j];
        const p0 = [cx + (p[0] - cx) * r0, cz + (p[1] - cz) * r0], q0 = [cx + (q[0] - cx) * r0, cz + (q[1] - cz) * r0];
        const p1 = [cx + (p[0] - cx) * r1, cz + (p[1] - cz) * r1], q1 = [cx + (q[0] - cx) * r1, cz + (q[1] - cz) * r1];
        const nx = (p[0] + q[0]) / 2 - cx, nz = (p[1] + q[1]) / 2 - cz, nl = Math.hypot(nx, nz) || 1;
        const ny = 0.6;
        const l = Math.hypot(nx / nl, ny, nz / nl);
        const v0 = M.vert(p0[0], roofY + h0, p0[1], nx / nl / l, ny / l, nz / nl / l, p0[0], p0[1], a1, A2);
        const v1 = M.vert(q0[0], roofY + h0, q0[1], nx / nl / l, ny / l, nz / nl / l, q0[0], q0[1], a1, A2);
        const v2 = M.vert(q1[0], roofY + h1, q1[1], nx / nl / l, ny / l, nz / nl / l, q1[0], q1[1], a1, A2);
        const v3 = M.vert(p1[0], roofY + h1, p1[1], nx / nl / l, ny / l, nz / nl / l, p1[0], p1[1], a1, A2);
        M.quad(v0, v1, v2, v3);
      }
    }
    return;
  }
  // pyramidal / hipped / gabled: pyramid to an apex above the centroid (gabled degenerates visually acceptable)
  const rise = shape === 'p' ? ext * 0.45 : Math.min(ext * 0.28, 4.5);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = outer[i], q = outer[j];
    const ex = q[0] - p[0], ez = q[1] - p[1];
    const ax = cx - p[0], az = cz - p[1];
    // face normal via cross product of (edge, toward-apex)
    const e = [ex, 0, ez], w = [ax, rise, az];
    let nx = e[1] * w[2] - e[2] * w[1], ny = e[2] * w[0] - e[0] * w[2], nz = e[0] * w[1] - e[1] * w[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const v0 = M.vert(p[0], roofY, p[1], nx, ny, nz, p[0], p[1], a1, A2);
    const v1 = M.vert(q[0], roofY, q[1], nx, ny, nz, q[0], q[1], a1, A2);
    const v2 = M.vert(cx, roofY + rise, cz, nx, ny, nz, cx, cz, a1, A2);
    // choose winding so the face normal points up
    const cross = (q[0] - p[0]) * (cz - p[1]) - (q[1] - p[1]) * (cx - p[0]);
    if (cross < 0) M.tri(v0, v1, v2); else M.tri(v0, v2, v1);
  }
}
