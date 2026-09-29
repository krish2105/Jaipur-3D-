// Hawa Mahal (Palace of Winds). Facts: docs/LANDMARK_FACTS.md.
//  * five storeys (Sharad, Ratan, Vichitra, Prakash, Hawa Mandir), pyramidal profile, pink/red sandstone with white lime motifs
//  * 953 small windows (jharokhas) in a honeycomb, built here as exactly 953 instances
//  * the celebrated street facade is the palace's BACK: it screens the City Palace zenana; the entered side is a plain courtyard block
//  * ~26.5 m overall (87 ft); the "50 ft" figure quoted elsewhere is the facade above its raised base
//  * (Phase 15, from the CC photos in docs/REFERENCE_PHOTOS.md) every storey is a row of projecting semi-octagonal oriel bays, 9 / 9 / 9 / 7 / 5 from the
//    bottom (counted by eye, approx), each with three white-framed arched openings, a hood and a ribbed cupola; the 953 windows are the small lattice
//    cells inside those openings; low arcaded wings with striped shop awnings on both sides, a plain tall block with a chhatri on the left, a taller
//    tower with a chhatri crown on the right, and the railing along the plaza.
// Local frame: facade plane at z = 0 facing +z; x along the facade; y up. Group is yawed so +z faces east.
import * as THREE from 'three';
import { MB, COL } from './kit.js';

export const HAWA_WINDOWS = 953;
const FLOOR_H = 4.5;
const PLINTH = 3.2;
// facade width per storey (m): bottom -> top, pyramidal
// approx, read by eye off a CC BY-SA photo (docs/REFERENCE_PHOTOS.md: hawa-east-2022): tiers are about 100 / 100 / 97 / 75 / 41 % of the base width
const WIDTH = [36, 36, 35, 27, 15];
const DEPTH = [12, 11, 3.6, 3.6, 3.6];
export const BAYS = [9, 9, 9, 7, 5]; // oriel bays per storey, bottom -> top (approx: counted by eye off hawa-east-2022)
// distribute the 953 windows in proportion to width (largest remainder), exactly 953
export function windowCounts(total = HAWA_WINDOWS, widths = WIDTH) {
  const sum = widths.reduce((a, b) => a + b, 0);
  const raw = widths.map((w) => (total * w) / sum);
  const cnt = raw.map(Math.floor);
  let rem = total - cnt.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rem > 0; k++, rem--) cnt[order[k % order.length][1]]++;
  return cnt;
}

/** One lattice cell of a jaali window: a small white-framed pointed arch with a dark opening and a sill. Front = +Z. ~45 triangles, instanced 953 times. */
function windowCell() {
  const b = new MB();
  b.archOpening(0, 0, 0.0, 1, 0, 0, 1, 0.205, 0.30, COL.limewash, true);   // white frame
  b.archOpening(0, 0.03, 0.012, 1, 0, 0, 1, 0.125, 0.22, COL.dark, true);  // dark opening
  b.box(0, -0.035, 0.03, 0.25, 0.04, 0.07, COL.limewash);                  // sill
  return b.build();
}

/** footprint of a half-octagonal oriel: back edge on the wall (z0), front facet of width fw at z0 + p, two 45-degree cheeks; k scales the whole plan about the bay axis */
function bayPoly(cx, z0, fw, p, k = 1) {
  const hw = (fw / 2) * k, pp = p * k;
  return [[cx - hw - pp, z0 - 0.25], [cx - hw - pp, z0], [cx - hw, z0 + pp], [cx + hw, z0 + pp], [cx + hw + pp, z0], [cx + hw + pp, z0 - 0.25]];
}

/** the three window facets of a bay: centre of the facet base, direction along it, outward normal, width */
function bayFacets(cx, z0, fw, p) {
  const hw = fw / 2, r2 = Math.SQRT1_2;
  return [
    { x: cx, z: z0 + p, dx: 1, dz: 0, nx: 0, nz: 1, w: fw, yaw: 0 },
    { x: cx - hw - p / 2, z: z0 + p / 2, dx: r2, dz: r2, nx: -r2, nz: r2, w: p * Math.SQRT2, yaw: -Math.PI / 4 },
    { x: cx + hw + p / 2, z: z0 + p / 2, dx: r2, dz: -r2, nx: r2, nz: r2, w: p * Math.SQRT2, yaw: Math.PI / 4 },
  ];
}

/**
 * One oriel bay on a storey: corbelled base, sill band, canted body, lintel band, hood and a ribbed cupola with a finial, three white-framed
 * arched openings (the lattice cells are instanced separately) and a small green shutter door under the front one.
 * `shallow` bays (the two lower storeys) project little and carry a smaller cupola, like the plainer lower tiers in the photos.
 * @returns the facet frames (for the instanced cells)
 */
function orielBay(b, cx, y, z0, pitch, H, shallow) {
  const p = shallow ? Math.min(0.42, pitch * 0.11) : Math.min(0.95, pitch * 0.25);
  const fw = pitch * (shallow ? 0.56 : 0.42);
  const yBody = y + 1.05, yTop = y + H - 0.55;
  b.prism(bayPoly(cx, z0, fw, p, 0.72), y + 0.3, y + 0.9, COL.pinkDeep);          // corbel: steps in toward the bottom
  b.prism(bayPoly(cx, z0, fw, p, 1.1), y + 0.9, yBody, COL.limewash);              // sill band
  b.prism(bayPoly(cx, z0, fw, p, 1), yBody, yTop, COL.pink);                       // body
  b.prism(bayPoly(cx, z0, fw, p, 1.12), yTop, yTop + 0.16, COL.limewash);          // lintel band
  b.prism(bayPoly(cx, z0, fw, p, 1.28), yTop + 0.16, yTop + 0.32, COL.pinkLight);  // hood (chhajja)
  const rx = (fw / 2 + p) * (shallow ? 0.66 : 0.92), ry = rx * 0.62;
  const dzC = z0 + p * 0.4;
  b.dome(cx, yTop + 0.32, dzC, rx, ry, 8, 3, COL.pinkLight, 0.08);
  b.cyl(cx, yTop + 0.32 + ry * 0.98, dzC, 0.05, 0.02, 0.5, 4, COL.gold, false);
  const facets = bayFacets(cx, z0, fw, p);
  const yo = yBody + 0.28, ho = Math.max(1.4, yTop - yBody - 0.6);
  facets.forEach((f, i) => {
    const w = i === 0 ? fw * 0.82 : f.w * 0.7;
    b.archOpening(f.x + f.nx * 0.02, yo, f.z + f.nz * 0.02, f.dx, f.dz, f.nx, f.nz, w + 0.22, ho + 0.12, COL.limewash, true);
    b.archOpening(f.x + f.nx * 0.035, yo + 0.03, f.z + f.nz * 0.035, f.dx, f.dz, f.nx, f.nz, w, ho, COL.dark, true);
  });
  const f0 = facets[0];
  b.archOpening(f0.x, yo + 0.03, f0.z + 0.05, 1, 0, 0, 1, Math.min(0.46, fw * 0.34), 0.78, [0.06, 0.28, 0.20], true); // green shutter door
  return { facets, yo, ho };
}

/** flat quad on a vertical face: origin (x,z) is the centre of the bottom edge, (dx,dz) runs along the face, (nx,nz) is the outward normal */
function quadV(b, x, y, z, dx, dz, nx, nz, w, h, c) {
  const a = b.v(x - dx * w / 2, y, z - dz * w / 2, nx, 0, nz, c), bb = b.v(x + dx * w / 2, y, z + dz * w / 2, nx, 0, nz, c);
  const d = b.v(x + dx * w / 2, y + h, z + dz * w / 2, nx, 0, nz, c), e = b.v(x - dx * w / 2, y + h, z - dz * w / 2, nx, 0, nz, c);
  b.quad(a, bb, d, e);
}

/** grid of small dark square windows on a plain wall (the flanking blocks of the photos) */
function squareGrid(b, x0, x1, yBase, z, cols, rows, w, h, dy) {
  const pitch = (x1 - x0) / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 + pitch * (c + 0.5), y = yBase + r * dy;
    quadV(b, x, y - 0.06, z + 0.012, 1, 0, 0, 1, w + 0.18, h + 0.12, COL.limewash);
    quadV(b, x, y, z + 0.02, 1, 0, 0, 1, w, h, COL.dark);
  }
}

/** small open chhatri: platform, four slim pillars, ribbed dome and a finial (x, base y, z, scale) */
function chhatri(b, x, y, z, k = 1) {
  b.cyl(x, y, z, 1.0 * k, 1.0 * k, 0.2, 8, COL.limewash);
  for (const [px, pz] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) b.cyl(x + px * k, y + 0.2, z + pz * k, 0.08 * k, 0.07 * k, 1.5 * k, 6, COL.limewash);
  b.cyl(x, y + 1.7 * k, z, 1.05 * k, 1.05 * k, 0.16, 8, COL.limewash);
  b.dome(x, y + 1.86 * k, z, 0.98 * k, 0.95 * k, 8, 3, COL.pinkLight, 0.1);
  b.cyl(x, y + 1.86 * k + 0.9 * k, z, 0.05, 0.02, 0.6 * k, 4, COL.gold, false);
}

/** a low arcaded wing (two storeys) with striped shop awnings over the ground-floor arches, x from xa to xb (either order), front at z = zf */
function wing(b, xa, xb, zf, depth, H, awning) {
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), cx = (x0 + x1) / 2, L = x1 - x0;
  b.box(cx, 0, zf - depth / 2, L, H, depth, COL.pink);
  b.box(cx, H - 0.3, zf - depth / 2 + 0.12, L + 0.4, 0.3, depth + 0.24, COL.limewash);          // cornice
  b.merlons(x0, zf - 0.15, x1, zf - 0.15, H, 0.4, 0.32, 0.32, 0.28, COL.limewash);
  b.box(cx, 3.35, zf - depth / 2 + 0.06, L + 0.2, 0.22, depth + 0.12, COL.limewash);              // string course between the storeys
  const nUp = Math.round(L / 2.2), nDn = Math.round(L / 3.1);
  b.arcade(x0, zf + 0.03, x1, zf + 0.03, 3.85, nUp, 1.05, 2.05, COL.dark, true, COL.limewash);     // upper jaali frames
  b.arcade(x0, zf + 0.03, x1, zf + 0.03, 0.25, nDn, 1.85, 2.55, COL.dark, false, COL.limewash);    // shop arches
  if (awning) {
    const stripe = 0.62, n = Math.floor(L / stripe), red = [0.36, 0.05, 0.04], cream = [0.68, 0.62, 0.5];
    for (let i = 0; i < n; i++) {
      const xa2 = x0 + i * stripe, xb2 = xa2 + stripe, c = i % 2 ? cream : red;
      // sloping cloth: high edge on the wall at 3.0 m, low edge 1.3 m out at 2.35 m
      const nrm = [0, 0.45, 0.89];
      const q = [[xa2, 3.0, zf + 0.05], [xb2, 3.0, zf + 0.05], [xb2, 2.35, zf + 1.35], [xa2, 2.35, zf + 1.35]].map((v) => b.v(v[0], v[1], v[2], nrm[0], nrm[1], nrm[2], c));
      b.quad(q[3], q[2], q[1], q[0]);
    }
  }
}

/** black iron railing along the plaza: posts, two rails, pickets */
function railing(b, x0, x1, z, h) {
  const iron = [0.03, 0.03, 0.035];
  const L = x1 - x0, cx = (x0 + x1) / 2;
  b.box(cx, h - 0.06, z, L, 0.06, 0.06, iron);
  b.box(cx, 0.12, z, L, 0.05, 0.05, iron);
  for (let x = x0; x <= x1 + 1e-6; x += 2.4) b.box(x, 0, z, 0.1, h + 0.08, 0.1, iron);
  for (let x = x0 + 0.3; x < x1; x += 0.3) b.box(x, 0.1, z, 0.03, h - 0.14, 0.03, iron);
}

/**
 * Festival outline lights in the model's local frame (x along the facade, y up, +z toward the street): a string of bulbs along the top edge of every storey
 * and a row of diyas along the plinth. Positions follow the same width / storey constants as the geometry, so they always sit on the modelled edges.
 * @returns {{bulbs:number[][], diyas:number[][]}} [x, y, z] points
 */
export function hawaOutline() {
  const bulbs = [], diyas = [];
  let y = PLINTH + 0.35;
  for (let f = 0; f < 5; f++) {
    const W = WIDTH[f], zf = -0.5 * f;
    const top = y + FLOOR_H + 0.55 + 0.45; // just above the parapet, along the merlons
    for (let x = -W / 2 + 0.3; x <= W / 2 - 0.29; x += 0.62) bulbs.push([x, top, zf + 0.2]);
    y += FLOOR_H;
  }
  for (let x = -WIDTH[0] / 2 + 1; x <= WIDTH[0] / 2 - 0.9; x += 1.05) diyas.push([x, 0.08, 1.4]);
  return { bulbs, diyas };
}

/** cell grid for one facet: how many cells fit in the rectangular part of its arched opening */
const CELL = { pw: 0.225, ph: 0.315 };
function facetGrid(openW, ho, extraRows = 0) {
  const r = openW / 2, rise = r * Math.SQRT2; // pointed arch rise
  const cols = Math.max(1, Math.floor((openW - 0.08) / CELL.pw));
  const rows = Math.max(1, Math.floor((ho - rise - 0.06) / CELL.ph)) + extraRows;
  return { cols, rows, cap: cols * rows };
}

export function buildHawaMahal(heroMat, propMat) {
  const g = new THREE.Group();
  g.name = 'HawaMahal';
  const b = new MB();

  // plinth: plain pink wall with three arched niches
  b.box(0, 0, -DEPTH[0] / 2, WIDTH[0] + 2, PLINTH, DEPTH[0], COL.pinkDeep);
  b.arcade(-14, 0.05, 14, 0.05, 0.0, 5, 2.4, 2.7, [0.30, 0.095, 0.075], true, COL.limewash); // shallow niches: the real plinth is a closed decorated wall, not an open arcade
  b.box(0, PLINTH, -DEPTH[0] / 2, WIDTH[0] + 2.4, 0.35, DEPTH[0] + 0.4, COL.limewash);
  // paved apron and the black iron railing of the plaza (approx: 3 m in front of the plinth)
  b.box(0, 0, 1.7, 46, 0.14, 3.4, COL.sand);
  railing(b, -21, 21, 3.1, 1.0);

  let y = PLINTH + 0.35;
  const counts = windowCounts();
  const cells = []; // [x, y, z, yaw]
  for (let f = 0; f < 5; f++) {
    const W = WIDTH[f], D = DEPTH[f];
    const zf = -0.5 * f; // recess a little each storey
    b.box(0, y, zf - D / 2, W, FLOOR_H, D, COL.pink);
    // cream cornice at the top of the storey and a plinth band at the bottom
    b.box(0, y + FLOOR_H - 0.28, zf - D / 2 + 0.16, W + 0.5, 0.28, D + 0.32, COL.limewash);
    b.box(0, y, zf - D / 2 + 0.1, W + 0.3, 0.3, D + 0.2, COL.limewash);
    // roof parapet + merlons (kangura)
    b.box(0, y + FLOOR_H, zf - 0.25, W, 0.55, 0.3, COL.pinkDeep);
    b.merlons(-W / 2, zf - 0.1, W / 2, zf - 0.1, y + FLOOR_H + 0.55, 0.42, 0.34, 0.34, 0.3, COL.limewash);
    // the row of oriel bays; the storey's share of the 953 windows is split over its bays and laid out as lattice cells inside their openings
    const n = BAYS[f], pitch = W / n;
    const perBay = Math.floor(counts[f] / n), extra = counts[f] - perBay * n;
    for (let i = 0; i < n; i++) {
      const cx = -W / 2 + pitch * (i + 0.5);
      const bay = orielBay(b, cx, y, zf, pitch, FLOOR_H, f < 2);
      let left = perBay + (i < extra ? 1 : 0);
      let extraRows = 0, grids, capSum;
      do { // a bay that cannot fit its share in the rectangular part of the openings gets an extra row (rare: the narrow top storey)
        grids = bay.facets.map((fc, k) => facetGrid(k === 0 ? fc.w * 0.82 : fc.w * 0.7, bay.ho, extraRows));
        capSum = grids.reduce((a2, q) => a2 + q.cap, 0);
      } while (capSum < left && ++extraRows < 6);
      const share = grids.map((q) => Math.min(q.cap, Math.round((left * q.cap) / capSum)));
      let assigned = share.reduce((a2, q) => a2 + q, 0);
      for (let k = 0; assigned < left && k < 30; k++) { const t = k % 3; if (share[t] < grids[t].cap) { share[t]++; assigned++; } }
      for (let k = 0; assigned > left && k < 30; k++) { const t = k % 3; if (share[t] > 0) { share[t]--; assigned--; } }
      bay.facets.forEach((fc, k) => {
        const q = grids[k], cnt = share[k];
        const usedRows = Math.max(1, Math.ceil(cnt / q.cols));
        const rowPitch = Math.min(0.5, Math.max(CELL.ph, (q.rows * CELL.ph) / usedRows)); // spread the rows over the rectangular part of the opening (lattice, not a balustrade)
        for (let c = 0; c < cnt; c++) {
          const row = Math.floor(c / q.cols), inRow = Math.min(q.cols, cnt - row * q.cols), col = c % q.cols;
          const off = (col - (inRow - 1) / 2) * CELL.pw; // a partly filled row is centred
          const px = fc.x + fc.dx * off + fc.nx * 0.075, pz = fc.z + fc.dz * off + fc.nz * 0.075;
          cells.push([px, bay.yo + 0.16 + row * rowPitch, pz, fc.yaw]);
        }
      });
      void left;
    }
    y += FLOOR_H;
  }
  // crown: central domed chhatri on the top storey with flanking small chhatris
  const topY = y + 0.55;
  b.cyl(0, topY, -1.6, 1.9, 1.9, 0.22, 12, COL.limewash);
  for (const [px, pz] of [[-1.3, -0.4], [1.3, -0.4], [-1.3, -2.8], [1.3, -2.8]]) b.cyl(px, topY + 0.22, pz, 0.14, 0.12, 2.2, 8, COL.limewash);
  b.dome(0, topY + 2.42, -1.6, 1.85, 1.9, 14, 5, COL.pinkLight, 0.1);
  b.cyl(0, topY + 4.2, -1.6, 0.1, 0.02, 1.2, 6, COL.gold, false);
  for (const sx of [-1, 1]) {
    b.cyl(sx * 3.2, topY + 0.22, -1.6, 0.9, 0.9, 0.16, 10, COL.limewash);
    b.dome(sx * 3.2, topY + 1.7, -1.6, 0.85, 0.9, 10, 4, COL.pinkLight, 0.08);
    for (const [px, pz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) b.cyl(sx * 3.2 + px, topY + 0.38, -1.6 + pz, 0.07, 0.06, 1.3, 6, COL.limewash);
  }

  // flanking parts of the complex, as in the photos: low arcaded wings with striped shop awnings; on the left a plain tall block with a chhatri, on the
  // right a taller tower with a balcony crown and a chhatri (both with grids of tiny square windows). Sizes approx.
  wing(b, 19.4, 44, -0.6, 6.5, 6.9, true);
  wing(b, -44, -19.4, -0.6, 6.5, 6.9, true);
  b.box(-25, 0, -11.2, 11, 15, 8.2, COL.pink);                                    // left tall block (front face at z = -7.1)
  b.box(-25, 14.7, -11.2, 11.6, 0.3, 8.8, COL.limewash);
  squareGrid(b, -30.2, -19.8, 8.2, -7.1, 5, 4, 0.5, 0.62, 1.55);
  chhatri(b, -27, 15, -10, 1.0);
  b.box(24, 0, -13.5, 8.6, 19.5, 8.6, COL.pink);                                  // right tower (front face at z = -9.2)
  b.box(24, 19.2, -13.5, 10.2, 0.3, 10.2, COL.limewash);                          // balcony slab
  for (const [bx, bz, sx, sz] of [[24, -8.55, 10, 0.16], [24, -18.45, 10, 0.16], [19.05, -13.5, 0.16, 9.7], [28.95, -13.5, 0.16, 9.7]]) b.box(bx, 19.5, bz, sx, 0.9, sz, COL.pinkDeep);
  squareGrid(b, 19.8, 28.2, 8.4, -9.2, 4, 6, 0.45, 0.6, 1.75);
  chhatri(b, 24, 19.5, -13.5, 1.5);

  // rear (courtyard) side: plain masonry block with rows of ordinary windows, and the ramp-like stair mass
  b.box(0, 0, -DEPTH[0] - 7, WIDTH[0] - 6, 13.5, 14, COL.pinkDeep);
  b.arcade(-13, -DEPTH[0] - 0.05 - 14, 13, -DEPTH[0] - 0.05 - 14, 1.0, 7, 1.7, 2.8, COL.dark, false, COL.limewash);
  b.box(0, 13.5, -DEPTH[0] - 7, WIDTH[0] - 5, 0.4, 14.4, COL.limewash);

  const body = new THREE.Mesh(b.build(), heroMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // 953 instanced lattice cells (one draw call)
  if (cells.length !== HAWA_WINDOWS) throw new Error(`Hawa Mahal windows: expected ${HAWA_WINDOWS}, built ${cells.length}`);
  const inst = new THREE.InstancedMesh(windowCell(), heroMat, HAWA_WINDOWS);
  inst.name = 'HawaMahalWindows';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const tint = new THREE.Color();
  cells.forEach((p, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p[3]);
    m.compose(pv.set(p[0], p[1], p[2]), q, sc);
    inst.setMatrixAt(i, m);
    // sandstone never weathers evenly: +-9 % value and a slight warm/cool drift per window (deterministic)
    const h = Math.abs(Math.sin(i * 12.9898 + p[1] * 78.233)) % 1, k = 0.91 + 0.18 * h;
    tint.setRGB(k * (1 + 0.05 * (h - 0.5)), k, k * (1 - 0.06 * (h - 0.5)));
    inst.setColorAt(i, tint);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor.needsUpdate = true;
  inst.castShadow = false; inst.receiveShadow = true; // 953 small cells: not worth drawing into every shadow cascade too
  g.add(inst);
  g.userData.windowCount = cells.length;
  g.userData.heightM = topY + 4.8;
  return g;
}
