// Jal Mahal, Man Sagar Lake. Five storeys, four submerged: only the top floor and roof show above the water.
// Corner octagonal chhatris; roof garden (Chameli Bagh) with arched passages. Local frame: y = 0 at the water surface.
import * as THREE from 'three';
import { MB, COL } from './kit.js';

/**
 * @param {THREE.Material} heroMat
 * @param {{W?:number, D?:number}} dims  body size in metres. The OSM outline (way w134990320) is a near-square ~59 x 55 m body with four
 *   corner chhatri bases (r ~ 3.6 m) and an 11 x 4.6 m porch on the west side (+z here); the defaults follow it.
 */
export function buildJalMahal(heroMat, { W = 59, D = 55 } = {}) {
  const g = new THREE.Group();
  g.name = 'JalMahal';
  const b = new MB();
  const H = 6.4; // visible top-floor wall from just under the waterline up
  // submerged storeys continue below the surface (hidden by the lake body); sandstone base shows a waterline stain
  b.box(0, -12, 0, W, 12.4, D, COL.pinkDeep);
  b.box(0, 0.1, 0, W + 0.4, 0.5, D + 0.4, COL.stone); // plinth course
  b.box(0, 0.6, 0, W, H, D, COL.pink);
  const yTop = 0.6 + H;
  // arcades on all four faces
  const nW = Math.round((W - 6) / 4.9), nD = Math.round((D - 6) / 4.9);
  b.arcade(-W / 2 + 3, D / 2 + 0.02, W / 2 - 3, D / 2 + 0.02, 1.0, nW, 2.0, 3.6, COL.dark, true, COL.limewash);
  b.arcade(W / 2 - 3, -D / 2 - 0.02, -W / 2 + 3, -D / 2 - 0.02, 1.0, nW, 2.0, 3.6, COL.dark, true, COL.limewash);
  b.arcade(W / 2 + 0.02, D / 2 - 3, W / 2 + 0.02, -D / 2 + 3, 1.0, nD, 2.0, 3.6, COL.dark, true, COL.limewash);
  b.arcade(-W / 2 - 0.02, -D / 2 + 3, -W / 2 - 0.02, D / 2 - 3, 1.0, nD, 2.0, 3.6, COL.dark, true, COL.limewash);
  // cornice + parapet with merlons
  b.box(0, yTop, 0, W + 0.9, 0.35, D + 0.9, COL.limewash);
  // parapet ring (four thin walls), NOT a solid slab: the roof garden sits inside it
  for (const sz of [-1, 1]) b.box(0, yTop + 0.35, sz * (D / 2 + 0.05), W + 0.5, 0.9, 0.45, COL.pink);
  for (const sx of [-1, 1]) b.box(sx * (W / 2 + 0.05), yTop + 0.35, 0, 0.45, 0.9, D + 0.5, COL.pink);
  for (const [x0, z0, x1, z1] of [[-W / 2, D / 2, W / 2, D / 2], [W / 2, -D / 2, -W / 2, -D / 2], [W / 2, D / 2, W / 2, -D / 2], [-W / 2, -D / 2, -W / 2, D / 2]]) b.merlons(x0, z0, x1, z1, yTop + 1.25, 0.5, 0.42, 0.36, 0.34, COL.limewash);
  // roof terrace: garden bed (Chameli Bagh) framed by arched passages
  b.box(0, yTop + 0.35, 0, W - 6, 0.3, D - 6, COL.green);
  // chahar-bagh style paths crossing the garden
  b.box(0, yTop + 0.66, 0, W - 6, 0.04, 1.6, COL.limewash);
  b.box(0, yTop + 0.66, 0, 1.6, 0.04, D - 6, COL.limewash);
  b.box(0, yTop + 0.62, 0, W - 4.2, 0.55, 0.5, COL.limewash);
  // central pavilion with arched passages
  b.box(0, yTop + 0.35, 0, 14, 4.2, 9, COL.pinkLight);
  b.arcade(-5.5, 4.52, 5.5, 4.52, yTop + 0.55, 4, 1.6, 2.6, COL.dark, true, COL.limewash);
  b.arcade(5.5, -4.52, -5.5, -4.52, yTop + 0.55, 4, 1.6, 2.6, COL.dark, true, COL.limewash);
  b.box(0, yTop + 4.55, 0, 14.6, 0.35, 9.6, COL.limewash);
  b.dome(0, yTop + 4.9, 0, 3.3, 2.7, 16, 5, COL.pinkLight, 0.08);
  b.cyl(0, yTop + 7.5, 0, 0.12, 0.03, 1.6, 6, COL.gold, false);
  // four corner octagonal chhatris, centred on the body corners (the OSM outline shows round bases of r ~ 3.6 m there)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (W / 2 + 0.4), cz = sz * (D / 2 + 1.0);
    b.cyl(cx, -1.5, cz, 3.6, 3.6, yTop + 1.5 + 0.5, 12, COL.pinkDeep);          // round bastion from the water up to the terrace
    b.cyl(cx, yTop + 0.35, cz, 3.2, 3.2, 0.5, 8, COL.limewash);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.cyl(cx + Math.cos(a) * 2.3, yTop + 0.85, cz + Math.sin(a) * 2.3, 0.18, 0.16, 3.6, 6, COL.limewash); }
    b.cyl(cx, yTop + 4.45, cz, 2.7, 2.7, 0.35, 8, COL.pink);
    b.dome(cx, yTop + 4.8, cz, 2.5, 2.4, 14, 5, COL.pinkLight, 0.12);
    b.cyl(cx, yTop + 7.1, cz, 0.09, 0.03, 1.1, 6, COL.gold, false);
  }
  // the projecting 11.4 x 4.6 m porch on the west (+z) face, at its mapped position (0.8 m off-centre)
  b.box(-0.8, 0.6, D / 2 + 2.3, 11.4, H, 4.6, COL.pinkLight);
  b.arcade(-6.0, D / 2 + 4.63, 4.4, D / 2 + 4.63, 1.0, 3, 2.2, 3.8, COL.dark, true, COL.limewash);
  b.box(-0.8, yTop, D / 2 + 2.3, 12.2, 0.35, 5.4, COL.limewash);
  b.dome(-0.8, yTop + 0.35, D / 2 + 2.3, 3.0, 2.4, 12, 4, COL.pinkLight, 0.1);
  const mesh = new THREE.Mesh(b.build(), heroMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  g.userData.visibleHeightM = yTop + 7.5;
  return g;
}
