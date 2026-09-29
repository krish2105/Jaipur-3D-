// City Palace pieces and city gatehouses, sized from their OSM footprints (docs/LANDMARK_FACTS.md).
//  * Chandra Mahal: seven floors ("a number considered auspicious by Rajput rulers"); the crowning pavilion is the Mukut Mandir.
//  * Mubarak Mahal: two levels, "identical on all four sides", hanging balcony, white andhi marble and beige stone; courtyard building.
//  * Gatehouse: generic crenellated gate block with pointed-arch passages on both long faces (city gates, Tripolia).
// Storey heights, setbacks and arch counts are modelling choices (approx); footprints and orientation come from OSM.
// Local frame: origin at the footprint centre on the ground, x along the long side (len), z along the depth (dep), facade toward +z.
import * as THREE from 'three';
import { MB, COL } from './kit.js';

const CH = { wall: [0.83, 0.74, 0.55], band: [0.62, 0.42, 0.28], blue: [0.16, 0.24, 0.42] };

function finish(b, heroMat, name) {
  const g = new THREE.Group();
  g.name = name;
  const mesh = new THREE.Mesh(b.build(), heroMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

/** four-post open pavilion with a dome and finial */
function pavilion(b, cx, y, cz, w, h, colDome = COL.pinkLight) {
  b.box(cx, y, cz, w, 0.3, w, COL.limewash);
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(cx + px * (w / 2 - 0.35), y + 0.3, cz + pz * (w / 2 - 0.35), 0.2, 0.18, h, 8, COL.limewash);
  b.box(cx, y + 0.3 + h, cz, w + 0.3, 0.28, w + 0.3, COL.pink);
  b.dome(cx, y + 0.58 + h, cz, w * 0.5, w * 0.42, 12, 4, colDome, 0.08);
  b.cyl(cx, y + 0.58 + h + w * 0.42, cz, 0.08, 0.02, 1.1, 6, COL.gold, false);
}

export function buildChandraMahal(heroMat, { len = 47, dep = 23 } = {}) {
  const b = new MB();
  const LV = 7, LH = 4.4;
  let y = 0;
  const widths = [], depths = [];
  for (let i = 0; i < LV; i++) {
    // a broad rectangular block for the lower storeys with a gentler tiered crown (approx: the real palace is not a pyramid)
    const w = len * [1, 1, 0.97, 0.93, 0.82, 0.64, 0.42][i], d = dep * [1, 1, 0.96, 0.92, 0.86, 0.78, 0.68][i];
    const front = dep / 2 - [0, 0, 0.4, 0.8, 1.4, 2.2, 3.0][i]; // the facade steps back a little on the upper levels
    const cz = front - d / 2;
    widths.push(w); depths.push(d);
    b.box(0, y, cz, w, LH, d, i % 2 ? COL.limewash : CH.wall);
    // plinth band and cornice
    b.box(0, y, cz + 0.06, w + 0.3, 0.32, d + 0.16, CH.band);
    b.box(0, y + LH - 0.3, cz + 0.12, w + 0.7, 0.3, d + 0.5, COL.limewash);
    // facade: cusped/pointed arch bays on the front, jharokha balconies on upper levels
    const bays = Math.max(3, Math.round(w / 5.2));
    b.arcade(-w / 2 + 1.2, front + 0.02, w / 2 - 1.2, front + 0.02, y + 0.6, bays, 2.0, 2.7, i > 1 ? CH.blue : COL.dark, true, COL.marble);
    if (i >= 1) for (let k = 0; k < Math.max(2, Math.round(bays / 2)); k++) {
      const jx = -w / 2 + ((k + 0.5) / Math.max(2, Math.round(bays / 2))) * w;
      b.box(jx, y + 1.0, front + 0.6, 2.4, 2.3, 1.2, COL.pinkLight);
      b.dome(jx, y + 3.3, front + 0.6, 1.25, 0.8, 8, 2, COL.pink);
    }
    // parapet with merlons
    b.box(0, y + LH, cz + d / 2 - 0.15, w, 0.7, 0.3, COL.limewash);
    b.merlons(-w / 2, cz + d / 2 - 0.1, w / 2, cz + d / 2 - 0.1, y + LH + 0.7, 0.4, 0.34, 0.34, 0.28, COL.marble);
    // corner chhatris on the terraces
    if (i === 2 || i === 4) for (const sx of [-1, 1]) pavilion(b, sx * (w / 2 - 2.0), y + LH + 0.7, cz + d / 2 - 2.0, 2.6, 2.6);
    y += LH;
  }
  // Mukut Mandir: crowning pavilion + flag mast
  const topW = widths[LV - 1], topCz = dep / 2 - 3.0 - depths[LV - 1] / 2;
  pavilion(b, 0, y, topCz, Math.min(6.5, topW * 0.6), 3.6);
  b.cyl(topW * 0.3, y, topCz, 0.07, 0.05, 6.5, 6, COL.dark, false);
  const g = finish(b, heroMat, 'ChandraMahal');
  g.userData.heightM = y + 3.6 + 0.58 + 6.5 * 0.4;
  g.userData.levels = LV;
  return g;
}

export function buildMubarakMahal(heroMat, { len = 27, dep = 27 } = {}) {
  const b = new MB();
  const H0 = 5.2, H1 = 4.6;
  // ground level
  b.box(0, 0, 0, len, H0, dep, COL.marble);
  b.box(0, 0, 0, len + 0.5, 0.5, dep + 0.5, COL.stone);
  b.box(0, H0 - 0.3, 0, len + 0.9, 0.3, dep + 0.9, COL.limewash);
  // the four faces: [face centre x, z, outward normal x, z, face length]
  const faces = [[0, dep / 2, 0, 1, len], [0, -dep / 2, 0, -1, len], [len / 2, 0, 1, 0, dep], [-len / 2, 0, -1, 0, dep]];
  // arcade() treats its direction u as running left-to-right seen from outside, so the outward normal is (-uz, ux); hence u = (nz, -nx)
  const arc = (fx, fz, nx, nz, half, off, y, n, w, h, fill, frame) => {
    const tx = nz, tz = -nx;
    b.arcade(fx - nx * off - tx * half, fz - nz * off - tz * half, fx - nx * off + tx * half, fz - nz * off + tz * half, y, n, w, h, fill, true, frame);
  };
  for (const [fx, fz, nx, nz, L] of faces) arc(fx, fz, nx, nz, L / 2 - 1.6, 0, 0.6, Math.max(3, Math.round(L / 4.2)), 1.9, 3.4, COL.dark, COL.white);
  // upper level, recessed 1.5 m, with a hanging balcony (slab + railing) on all four sides and blue-filled arched bays
  const y1 = H0;
  b.box(0, y1, 0, len - 3, H1, dep - 3, CH.wall);
  for (const [fx, fz, nx, nz, L] of faces) {
    const along = L - 2.4, front = nx === 0;
    b.box(fx - nx * 0.8, y1, fz - nz * 0.8, front ? along : 1.4, 0.3, front ? 1.4 : along, COL.white);
    b.box(fx - nx * 0.2, y1 + 0.3, fz - nz * 0.2, front ? along : 0.22, 1.0, front ? 0.22 : along, COL.marble);
    arc(fx, fz, nx, nz, L / 2 - 3, 1.55, y1 + 0.5, Math.max(3, Math.round(L / 3.6)), 1.4, 2.8, CH.blue, COL.white);
  }
  b.box(0, y1 + H1, 0, len - 2.4, 0.3, dep - 2.4, COL.limewash);
  b.merlons(-len / 2 + 1.2, dep / 2 - 1.2, len / 2 - 1.2, dep / 2 - 1.2, y1 + H1 + 0.3, 0.45, 0.38, 0.36, 0.3, COL.marble);
  b.merlons(len / 2 - 1.2, -dep / 2 + 1.2, -len / 2 + 1.2, -dep / 2 + 1.2, y1 + H1 + 0.3, 0.45, 0.38, 0.36, 0.3, COL.marble);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pavilion(b, sx * (len / 2 - 2.2), y1 + H1 + 0.3, sz * (dep / 2 - 2.2), 2.4, 2.4);
  const g = finish(b, heroMat, 'MubarakMahal');
  g.userData.heightM = y1 + H1 + 0.3 + 2.7 + 0.58 + 1;
  return g;
}

/** Generic city gatehouse: block + passages on both long faces + end turrets + parapet. `arches` defaults to len / 9 (1..3). */
export function buildGatehouse(heroMat, { len = 22, dep = 9, height = 10.5, arches = null } = {}) {
  const b = new MB();
  const H = height;
  const n = arches ?? Math.max(1, Math.min(3, Math.round(len / 9)));
  b.box(0, 0, 0, len, H, dep, COL.pink);
  b.box(0, 0, 0, len + 0.5, 1.0, dep + 0.5, COL.pinkDeep);
  b.box(0, H - 0.4, 0, len + 0.8, 0.4, dep + 0.8, COL.limewash);
  const aw = Math.min(4.4, (len - 6) / n - 1), ah = Math.min(6.4, H * 0.62);
  const span = n * (aw + 1.4);
  // +z face runs left-to-right (u = +x, normal +z); the -z face runs the other way so its openings face outward too
  b.arcade(-span / 2, dep / 2 + 0.02, span / 2, dep / 2 + 0.02, 0.0, n, aw, ah, COL.dark, true, COL.limewash);
  b.arcade(span / 2, -dep / 2 - 0.02, -span / 2, -dep / 2 - 0.02, 0.0, n, aw, ah, COL.dark, true, COL.limewash);
  b.box(0, H, 0, len - 0.4, 0.9, dep - 0.4, COL.pink);
  b.merlons(-len / 2, dep / 2 - 0.2, len / 2, dep / 2 - 0.2, H + 0.9, 0.55, 0.45, 0.4, 0.36, COL.limewash);
  b.merlons(len / 2, -dep / 2 + 0.2, -len / 2, -dep / 2 + 0.2, H + 0.9, 0.55, 0.45, 0.4, 0.36, COL.limewash);
  for (const sx of [-1, 1]) {
    const tx = sx * (len / 2 - 1.4);
    b.cyl(tx, 0, 0, 1.9, 1.7, H + 2.2, 8, COL.pinkLight);
    b.cyl(tx, H + 2.2, 0, 2.15, 2.15, 0.28, 8, COL.limewash);
    b.dome(tx, H + 2.48, 0, 1.9, 1.7, 10, 4, COL.pinkLight, 0.08);
    b.cyl(tx, H + 4.1, 0, 0.07, 0.02, 0.9, 6, COL.gold, false);
  }
  const g = finish(b, heroMat, 'Gatehouse');
  g.userData.heightM = H + 5;
  return g;
}

/** Yaw + position for a model whose local x is the footprint's long axis and whose facade (+z) should face `toward` ([x, z] direction). */
export function poseFromBox(box, toward) {
  let ux = box.ux, uz = box.uz;
  // local +z maps to (-uz, ux); pick the sign of the axis so that it points toward `toward`
  if (-uz * toward[0] + ux * toward[1] < 0) { ux = -ux; uz = -uz; }
  return { x: box.cx, z: box.cz, yaw: Math.atan2(-uz, ux) };
}

export const _test = { pavilion };
