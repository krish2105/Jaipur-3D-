// Hawa Mahal (Palace of Winds). Facts: docs/LANDMARK_FACTS.md.
//  * five storeys (Sharad, Ratan, Vichitra, Prakash, Hawa Mandir), pyramidal profile, pink/red sandstone with white lime motifs
//  * 953 small windows (jharokhas) in a honeycomb, built here as exactly 953 instances
//  * the celebrated street facade is the palace's BACK: it screens the City Palace zenana; the entered side is a plain courtyard block
//  * ~26.5 m overall (87 ft); the "50 ft" figure quoted elsewhere is the facade above its raised base
// Local frame: facade plane at z = 0 facing +z; x along the facade; y up. Group is yawed so +z faces east.
import * as THREE from 'three';
import { MB, COL } from './kit.js';

export const HAWA_WINDOWS = 953;
const FLOOR_H = 4.5;
const PLINTH = 3.2;
// facade width per storey (m): bottom -> top, pyramidal
const WIDTH = [36, 34, 24, 16, 9];
const DEPTH = [12, 11, 3.6, 3.6, 3.6];
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

/** Window unit geometry: small semi-octagonal bay with an arched dark opening and a tiny dome. Front = +Z. */
function windowUnit() {
  const b = new MB();
  b.box(0, 0, 0.13, 0.5, 0.74, 0.26, COL.pinkLight);
  b.archOpening(0, 0.09, 0.262, 1, 0, 0, 1, 0.3, 0.56, COL.dark, true);
  b.box(0, 0.74, 0.13, 0.56, 0.05, 0.32, COL.limewash); // eave
  b.dome(0, 0.79, 0.13, 0.2, 0.15, 8, 2, COL.pinkLight);
  b.box(0, -0.04, 0.11, 0.46, 0.05, 0.22, COL.limewash); // sill
  return b.build();
}

export function buildHawaMahal(heroMat, propMat) {
  const g = new THREE.Group();
  g.name = 'HawaMahal';
  const b = new MB();

  // plinth: plain pink wall with three arched niches
  b.box(0, 0, -DEPTH[0] / 2, WIDTH[0] + 2, PLINTH, DEPTH[0], COL.pinkDeep);
  b.arcade(-14, 0.05, 14, 0.05, 0.0, 5, 2.4, 2.7, COL.dark, true, COL.limewash);
  b.box(0, PLINTH, -DEPTH[0] / 2, WIDTH[0] + 2.4, 0.35, DEPTH[0] + 0.4, COL.limewash);

  let y = PLINTH + 0.35;
  const counts = windowCounts();
  const winPos = [];
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
    // corner semi-octagonal turrets with domes
    for (const sx of [-1, 1]) {
      const tx = sx * (W / 2 - 0.8), tz = zf + 0.5;
      b.cyl(tx, y, tz, 1.15, 1.1, FLOOR_H + 0.55, 8, COL.pinkLight);
      b.cyl(tx, y + FLOOR_H + 0.55, tz, 1.3, 1.3, 0.2, 8, COL.limewash);
      b.dome(tx, y + FLOOR_H + 0.75, tz, 1.15, 1.25, 10, 4, COL.pinkLight, 0.08);
      b.cyl(tx, y + FLOOR_H + 2.0, tz, 0.07, 0.02, 0.9, 6, COL.gold, false);
    }
    // honeycomb of window units on this storey: hex-staggered rows, exactly counts[f] units
    const n = counts[f];
    const usable = FLOOR_H - 1.0;
    const rows = Math.max(3, Math.floor(usable / 0.8));
    const cols = Math.ceil(n / rows);
    const span = W - 3.4;
    const pitch = span / cols;
    let placed = 0;
    for (let r = 0; r < rows && placed < n; r++) {
      const stagger = r % 2 ? pitch * 0.5 : 0;
      for (let c = 0; c < cols && placed < n; c++) {
        const x = -span / 2 + pitch * (c + 0.5) + stagger - (r % 2 ? pitch * 0.25 : 0) * 0;
        if (Math.abs(x) > W / 2 - 1.5) { continue; }
        winPos.push([x, y + 0.65 + r * 0.8, zf + 0.0]);
        placed++;
      }
    }
    // if the staggered clipping dropped some, top up along the lowest free row
    let extra = 0;
    while (placed < n) { winPos.push([-span / 2 + pitch * ((extra * 7) % cols + 0.5), y + 0.65 + rows * 0.8 - 0.1 + 0.0, zf]); placed++; extra++; }
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

  // rear (courtyard) side: plain masonry block with rows of ordinary windows, and the ramp-like stair mass
  b.box(0, 0, -DEPTH[0] - 7, WIDTH[0] - 6, 13.5, 14, COL.pinkDeep);
  b.arcade(-13, -DEPTH[0] - 0.05 - 14, 13, -DEPTH[0] - 0.05 - 14, 1.0, 7, 1.7, 2.8, COL.dark, false, COL.limewash);
  b.box(0, 13.5, -DEPTH[0] - 7, WIDTH[0] - 5, 0.4, 14.4, COL.limewash);

  const body = new THREE.Mesh(b.build(), heroMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // 953 instanced window units (one draw call)
  if (winPos.length !== HAWA_WINDOWS) throw new Error(`Hawa Mahal windows: expected ${HAWA_WINDOWS}, built ${winPos.length}`);
  const inst = new THREE.InstancedMesh(windowUnit(), heroMat, HAWA_WINDOWS);
  inst.name = 'HawaMahalWindows';
  const m = new THREE.Matrix4();
  winPos.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(i, m); });
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = true; inst.receiveShadow = true;
  g.add(inst);
  g.userData.windowCount = winPos.length;
  g.userData.heightM = topY + 4.8;
  return g;
}
