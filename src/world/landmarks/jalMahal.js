// Jal Mahal, Man Sagar Lake. Five storeys, four submerged: only the top floor and roof show above the water.
// Corner octagonal chhatris; roof garden (Chameli Bagh) with arched passages. Local frame: y = 0 at the water surface.
import * as THREE from 'three';
import { MB, COL } from './kit.js';

export function buildJalMahal(heroMat) {
  const g = new THREE.Group();
  g.name = 'JalMahal';
  const b = new MB();
  const W = 52, D = 32, H = 6.4, y0 = -0.3; // visible top-floor wall from just under the waterline up
  // submerged storeys continue below the surface (hidden by the lake body); sandstone base shows a waterline stain
  b.box(0, -12, 0, W, 12.4, D, COL.pinkDeep);
  b.box(0, 0.1, 0, W + 0.4, 0.5, D + 0.4, COL.stone); // plinth course
  b.box(0, 0.6, 0, W, H, D, COL.pink);
  const yTop = 0.6 + H;
  // arcades on all four faces
  b.arcade(-W / 2 + 3, D / 2 + 0.02, W / 2 - 3, D / 2 + 0.02, 1.0, 11, 2.0, 3.6, COL.dark, true, COL.limewash);
  b.arcade(W / 2 - 3, -D / 2 - 0.02, -W / 2 + 3, -D / 2 - 0.02, 1.0, 11, 2.0, 3.6, COL.dark, true, COL.limewash);
  b.arcade(W / 2 + 0.02, D / 2 - 3, W / 2 + 0.02, -D / 2 + 3, 1.0, 5, 2.0, 3.6, COL.dark, true, COL.limewash);
  b.arcade(-W / 2 - 0.02, -D / 2 + 3, -W / 2 - 0.02, D / 2 - 3, 1.0, 5, 2.0, 3.6, COL.dark, true, COL.limewash);
  // cornice + parapet with merlons
  b.box(0, yTop, 0, W + 0.9, 0.35, D + 0.9, COL.limewash);
  b.box(0, yTop + 0.35, 0, W + 0.2, 0.9, D + 0.2, COL.pink);
  for (const [x0, z0, x1, z1] of [[-W / 2, D / 2, W / 2, D / 2], [W / 2, -D / 2, -W / 2, -D / 2], [W / 2, D / 2, W / 2, -D / 2], [-W / 2, -D / 2, -W / 2, D / 2]]) b.merlons(x0, z0, x1, z1, yTop + 1.25, 0.5, 0.42, 0.36, 0.34, COL.limewash);
  // roof terrace: garden bed (Chameli Bagh) framed by arched passages
  b.box(0, yTop + 0.35, 0, W - 6, 0.3, D - 6, COL.green);
  b.box(0, yTop + 0.62, 0, W - 4.2, 0.55, 0.5, COL.limewash);
  // central pavilion with arched passages
  b.box(0, yTop + 0.35, 0, 14, 4.2, 9, COL.pinkLight);
  b.arcade(-5.5, 4.52, 5.5, 4.52, yTop + 0.55, 4, 1.6, 2.6, COL.dark, true, COL.limewash);
  b.arcade(5.5, -4.52, -5.5, -4.52, yTop + 0.55, 4, 1.6, 2.6, COL.dark, true, COL.limewash);
  b.box(0, yTop + 4.55, 0, 14.6, 0.35, 9.6, COL.limewash);
  b.dome(0, yTop + 4.9, 0, 3.3, 2.7, 16, 5, COL.pinkLight, 0.08);
  b.cyl(0, yTop + 7.5, 0, 0.12, 0.03, 1.6, 6, COL.gold, false);
  // four corner octagonal chhatris
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (W / 2 - 2.6), cz = sz * (D / 2 - 2.6);
    b.cyl(cx, yTop + 0.35, cz, 2.5, 2.5, 0.5, 8, COL.limewash);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.cyl(cx + Math.cos(a) * 2.0, yTop + 0.85, cz + Math.sin(a) * 2.0, 0.17, 0.15, 3.4, 6, COL.limewash); }
    b.cyl(cx, yTop + 4.25, cz, 2.4, 2.4, 0.35, 8, COL.pink);
    b.dome(cx, yTop + 4.6, cz, 2.2, 2.2, 14, 5, COL.pinkLight, 0.12);
    b.cyl(cx, yTop + 6.7, cz, 0.09, 0.03, 1.1, 6, COL.gold, false);
  }
  // two mid-side small domed kiosks on the long sides
  for (const sz of [-1, 1]) for (const sx of [-0.33, 0.33]) {
    const cx = sx * W, cz = sz * (D / 2 - 2.2);
    b.cyl(cx, yTop + 0.35, cz, 1.3, 1.3, 0.4, 8, COL.limewash);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; b.cyl(cx + Math.cos(a) * 0.95, yTop + 0.75, cz + Math.sin(a) * 0.95, 0.12, 0.1, 2.3, 6, COL.limewash); }
    b.dome(cx, yTop + 3.05, cz, 1.25, 1.2, 10, 4, COL.pinkLight, 0.1);
  }
  const mesh = new THREE.Mesh(b.build(), heroMat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  g.userData.visibleHeightM = yTop + 7.5;
  return g;
}
