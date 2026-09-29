// Facade layout rules shared by the JS side (instance placement) and the GLSL facade shader.
// Seeds arrive in the shader as uint8/255, so JS quantises them the same way.
import { hash01 } from '../core/rng.js';

export const q8 = (v) => Math.round(v * 255) / 255;

export function storeyHeight(seedB) {
  return 3.15 + (3.7 - 3.15) * seedB;
}

/** shop: bazaar / street-facing commercial frontage gets a tall arcaded ground floor */
export function groundHeight(seedA, shop, seedB) {
  return shop ? 3.8 + (4.6 - 3.8) * seedA : storeyHeight(seedB);
}

export function bayLayout(L, seedA) {
  const target = 2.7 + (3.5 - 2.7) * seedA;
  const n = Math.max(1, Math.floor(L / target + 0.5));
  return { n, w: L / n };
}

export const FLAG = { FACE_ROAD: 1, BAZAAR: 2, HERITAGE: 4 };

/** does this wall get the arcaded shop ground floor? (cls: 0 res,1 com,2 rel,3 pub,4 ind,5 her,6 min,7 oth) */
export function isShopWall(flags, cls, seedA) {
  const face = (flags & FLAG.FACE_ROAD) !== 0;
  const bazaar = (flags & FLAG.BAZAAR) !== 0;
  if (!face) return false;
  if (bazaar) return cls !== 2; // arcades everywhere on bazaar streets except temples
  return cls === 1 || (cls === 7 && seedA > 0.35) || (cls === 0 && seedA > 0.8);
}

/** deterministic per-bay choice of a projecting jharokha on an upper floor */
export function jharokhaAt(buildingId, wallIndex, bay, bazaar, nBays) {
  if (bay === 0 || bay === nBays - 1) return false;
  const p = bazaar ? 0.28 : 0.16;
  return hash01(buildingId, wallIndex * 131 + bay, 977) < p;
}
