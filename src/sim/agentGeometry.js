// Low-poly models for street life. Every vertex carries extra tags so ONE material per kind can do everything on the GPU:
//   aTag.x  tint   0 = fixed vertex colour, 1 = takes the instance colour (paint, clothing, turban)
//   aTag.y  lamp   0 none, 1 headlight, 2 taillight (emissive at night / when braking)
//   aTag.z  limb   0 body, +-1 legs (swing), +-2 arms (swing, opposite phase), 3 cow legs (fold when lying), +-4 wings (flap)
//   aTag.w  pivot  height (m) of the joint the limb rotates about
// Models face +Z, stand on y = 0, are centred on x = z = 0 (vehicles: on the rear axle-ish centre).
import * as THREE from 'three';
import { MB, COL } from '../world/landmarks/kit.js';

class TB extends MB {
  constructor() {
    super();
    this.tag = [];
    this.st = { tint: 0, lamp: 0, limb: 0, pivot: 0 };
  }
  v(x, y, z, nx, ny, nz, c, u = 0, w = 0) {
    const id = super.v(x, y, z, nx, ny, nz, c, u, w);
    this.tag.push(this.st.tint, this.st.lamp, this.st.limb, this.st.pivot);
    return id;
  }
  // the kit's primitives return nothing; here they return `this` so calls can be chained
  box(...a) { super.box(...a); return this; }
  cyl(...a) { super.cyl(...a); return this; }
  dome(...a) { super.dome(...a); return this; }
  /** set the tags for the next primitives */
  as(tint = 0, lamp = 0, limb = 0, pivot = 0) { this.st = { tint, lamp, limb, pivot }; return this; }
  build() {
    const g = super.build();
    g.setAttribute('aTag', new THREE.Float32BufferAttribute(this.tag, 4));
    return g;
  }
}

const K = { dark: [0.02, 0.02, 0.022], rubber: [0.03, 0.03, 0.03], glass: [0.05, 0.075, 0.09], white: [1, 1, 1], chrome: [0.45, 0.45, 0.47], skin: [0.42, 0.27, 0.18], skinLight: [0.5, 0.34, 0.24], hair: [0.02, 0.018, 0.016], seat: [0.06, 0.05, 0.05], canvas: [0.03, 0.03, 0.035], lampOn: [1, 0.95, 0.8], tail: [0.8, 0.02, 0.02], denim: [0.08, 0.1, 0.16], trouser: [0.14, 0.13, 0.12] };

function wheel(b, x, y, z, r = 0.32, w = 0.2) {
  b.as(0).cyl(x, y - r, z, r, r, w, 10, K.rubber, true);
}

/** yaw-rotated wheel cylinder along X: use a thin box + cylinder standing on its side is costly; a rubber box wheel reads fine at street scale */
function wheelBox(b, x, r, z, w) { b.as(0).box(x, 0, z, w, 2 * r, 2 * r, K.rubber); }

export function buildBike() {
  const b = new TB();
  wheelBox(b, 0, 0.32, 0.62, 0.11);
  wheelBox(b, 0, 0.32, -0.62, 0.13);
  b.as(1).box(0, 0.45, 0.0, 0.26, 0.28, 0.85, K.white);            // tank + frame (paint)
  b.as(0).box(0, 0.7, -0.28, 0.24, 0.1, 0.62, K.seat);
  b.as(0).box(0, 0.78, 0.5, 0.5, 0.05, 0.06, K.chrome);            // handlebar
  b.as(0).box(0, 0.62, 0.55, 0.06, 0.5, 0.06, K.chrome);           // fork
  b.as(0, 1).box(0, 0.78, 0.6, 0.16, 0.14, 0.06, K.lampOn);        // headlight
  b.as(0, 2).box(0, 0.62, -0.74, 0.14, 0.08, 0.05, K.tail);         // taillight
  // rider
  b.as(1).box(0, 1.02, -0.18, 0.4, 0.5, 0.24, K.white);            // torso (shirt: instance colour)
  b.as(0).box(-0.13, 0.62, -0.06, 0.13, 0.22, 0.42, K.trouser).box(0.13, 0.62, -0.06, 0.13, 0.22, 0.42, K.trouser);
  b.as(0).box(-0.24, 1.0, 0.12, 0.09, 0.09, 0.55, K.skin).box(0.24, 1.0, 0.12, 0.09, 0.09, 0.55, K.skin);
  b.as(0).cyl(0, 1.3, -0.16, 0.13, 0.12, 0.2, 8, K.skin);
  b.as(0).dome(0, 1.42, -0.16, 0.15, 0.13, 8, 2, K.dark);          // helmet / hair
  return b.build();
}

export function buildCar() {
  const b = new TB();
  for (const [x, z] of [[-0.78, 1.3], [0.78, 1.3], [-0.78, -1.3], [0.78, -1.3]]) wheelBox(b, x, 0.3, z, 0.22);
  b.as(1).box(0, 0.32, 0, 1.68, 0.62, 4.1, K.white);              // lower body (paint)
  b.as(1).box(0, 0.95, -0.15, 1.5, 0.22, 2.2, K.white);           // roof line
  b.as(0).box(0, 0.76, -0.15, 1.52, 0.45, 2.0, K.glass);          // glass band
  b.as(1).box(0, 1.22, -0.15, 1.44, 0.06, 2.0, K.white);          // roof
  b.as(0).box(0, 0.35, 2.06, 1.5, 0.22, 0.08, K.dark);            // bumper
  b.as(0).box(0, 0.35, -2.06, 1.5, 0.22, 0.08, K.dark);
  b.as(0, 1).box(-0.55, 0.62, 2.07, 0.34, 0.12, 0.05, K.lampOn).box(0.55, 0.62, 2.07, 0.34, 0.12, 0.05, K.lampOn);
  b.as(0, 2).box(-0.6, 0.66, -2.07, 0.3, 0.12, 0.05, K.tail).box(0.6, 0.66, -2.07, 0.3, 0.12, 0.05, K.tail);
  return b.build();
}

export function buildAuto() {
  // three-wheeled autorickshaw: a rounded canvas canopy over a bench, single front wheel, open sides
  const b = new TB();
  wheelBox(b, 0, 0.26, 0.95, 0.12);
  wheelBox(b, -0.62, 0.26, -0.55, 0.14);
  wheelBox(b, 0.62, 0.26, -0.55, 0.14);
  b.as(1).box(0, 0.42, 0.05, 1.3, 0.5, 2.2, K.white);             // body (yellow/green paint)
  b.as(1).box(0, 0.78, 0.7, 0.9, 0.55, 0.7, K.white);             // nose / dash
  b.as(0).box(0, 0.62, -0.5, 1.1, 0.08, 0.9, K.seat);
  b.as(0).box(-0.6, 1.0, -0.15, 0.06, 0.9, 0.06, K.dark).box(0.6, 1.0, -0.15, 0.06, 0.9, 0.06, K.dark);   // pillars
  b.as(0).box(0, 1.55, -0.2, 1.4, 0.08, 1.9, K.canvas);           // canopy
  b.as(0).dome(0, 1.55, -0.2, 0.9, 0.16, 8, 1, K.canvas);
  b.as(0).box(0, 1.15, 0.72, 0.9, 0.5, 0.05, K.glass);            // windscreen
  b.as(0, 1).box(0, 0.7, 1.12, 0.22, 0.14, 0.05, K.lampOn);
  b.as(0, 2).box(-0.4, 0.55, -1.06, 0.2, 0.1, 0.05, K.tail).box(0.4, 0.55, -1.06, 0.2, 0.1, 0.05, K.tail);
  return b.build();
}

export function buildBus() {
  const b = new TB();
  for (const z of [3.3, -3.0]) for (const x of [-1.12, 1.12]) wheelBox(b, x, 0.5, z, 0.3);
  b.as(1).box(0, 0.35, 0, 2.5, 3.0, 9.4, K.white);
  b.as(0).box(0, 1.9, 0, 2.52, 1.0, 9.0, K.glass);                // window band
  b.as(1).box(0, 3.0, 0, 2.5, 0.25, 9.4, K.white);
  b.as(0).box(0, 0.5, 4.72, 2.3, 0.4, 0.1, K.dark).box(0, 0.5, -4.72, 2.3, 0.4, 0.1, K.dark);
  b.as(0, 1).box(-0.8, 0.9, 4.72, 0.4, 0.2, 0.06, K.lampOn).box(0.8, 0.9, 4.72, 0.4, 0.2, 0.06, K.lampOn);
  b.as(0, 2).box(-0.85, 0.95, -4.72, 0.36, 0.2, 0.06, K.tail).box(0.85, 0.95, -4.72, 0.36, 0.2, 0.06, K.tail);
  return b.build();
}

/** kind: 'man' | 'woman' | 'turban'  (children are the man model scaled down) */
export function buildPerson(kind = 'man') {
  const b = new TB();
  // legs (swing about the hip)
  if (kind !== 'woman') {
    b.as(0, 0, 1, 0.9).box(-0.1, 0.0, 0.0, 0.15, 0.9, 0.17, kind === 'turban' ? [0.7, 0.68, 0.62] : K.trouser);
    b.as(0, 0, -1, 0.9).box(0.1, 0.0, 0.0, 0.15, 0.9, 0.17, kind === 'turban' ? [0.7, 0.68, 0.62] : K.trouser);
  } else {
    b.as(0, 0, 1, 0.9).box(-0.08, 0.0, 0.0, 0.1, 0.3, 0.12, K.skin);
    b.as(0, 0, -1, 0.9).box(0.08, 0.0, 0.0, 0.1, 0.3, 0.12, K.skin);
    b.as(1, 0, 0, 0).cyl(0, 0.05, 0, 0.34, 0.2, 0.88, 8, K.white);          // sari / lehenga skirt (instance colour)
  }
  b.as(1, 0, 0, 0).box(0, 0.9, 0, 0.42, 0.62, 0.24, K.white);              // torso (instance colour)
  if (kind === 'woman') b.as(1).box(0, 1.28, -0.12, 0.34, 0.5, 0.05, K.white);  // dupatta / pallu over the back
  b.as(0, 0, 2, 1.48).box(-0.27, 0.95, 0.0, 0.09, 0.56, 0.1, K.skin);
  b.as(0, 0, -2, 1.48).box(0.27, 0.95, 0.0, 0.09, 0.56, 0.1, K.skin);
  b.as(0).cyl(0, 1.5, 0, 0.055, 0.055, 0.1, 6, K.skin);
  b.as(0).cyl(0, 1.58, 0, 0.115, 0.1, 0.2, 8, K.skinLight);
  if (kind === 'turban') {
    b.as(1).cyl(0, 1.68, 0, 0.17, 0.15, 0.17, 10, K.white);                // pagri wrapped in a bright colour
    b.as(1).dome(0, 1.85, 0, 0.14, 0.09, 8, 2, K.white);
  } else {
    b.as(0).dome(0, 1.7, 0, 0.12, 0.08, 8, 2, K.hair);
  }
  return b.build();
}

export function buildCow() {
  const b = new TB();
  const P = 0.55; // hip / shoulder pivot height for fold when lying
  for (const [x, z, s] of [[-0.24, 0.62, 1], [0.24, 0.62, -1], [-0.24, -0.6, -1], [0.24, -0.6, 1]]) b.as(0, 0, 3, P).box(x, 0, z, 0.13, 0.62, 0.13, [0.75, 0.72, 0.66]);
  b.as(1).box(0, 0.55, -0.05, 0.64, 0.64, 1.55, K.white);                   // barrel (white / brown / black)
  b.as(1).box(0, 0.62, 0.7, 0.6, 0.7, 0.5, K.white);                        // chest / shoulders
  b.as(1).box(0, 1.0, 0.72, 0.3, 0.3, 0.42, K.white);                       // raised neck + hump
  b.as(1).box(0, 0.98, 1.08, 0.26, 0.34, 0.4, K.white);                     // head
  b.as(0).box(0, 0.86, 1.3, 0.2, 0.15, 0.08, [0.13, 0.09, 0.08]);           // muzzle
  b.as(0).box(-0.2, 1.1, 1.02, 0.16, 0.05, 0.1, [0.4, 0.3, 0.26]).box(0.2, 1.1, 1.02, 0.16, 0.05, 0.1, [0.4, 0.3, 0.26]);   // ears
  b.as(0).cyl(-0.12, 1.14, 1.0, 0.04, 0.02, 0.3, 5, [0.85, 0.83, 0.75]).cyl(0.12, 1.14, 1.0, 0.04, 0.02, 0.3, 5, [0.85, 0.83, 0.75]);   // horns
  b.as(0).box(0.0, 0.88, -0.05, 0.5, 0.02, 0.5, [0.32, 0.22, 0.15]);         // coat patch
  b.as(0).box(0.34, 0.6, 0.1, 0.02, 0.32, 0.5, [0.3, 0.2, 0.14]);
  b.as(0).box(0, 0.64, -0.92, 0.05, 0.5, 0.05, [0.2, 0.16, 0.14]);           // tail
  return b.build();
}

export function buildPigeon() {
  const b = new TB();
  b.as(0).dome(0, 0.0, 0, 0.11, 0.08, 6, 2, [0.28, 0.29, 0.32]);
  b.as(0).box(0, 0.06, 0.1, 0.07, 0.07, 0.1, [0.3, 0.32, 0.36]);           // head
  b.as(0).box(0, 0.03, -0.16, 0.08, 0.02, 0.16, [0.18, 0.19, 0.22]);       // tail
  b.as(0, 0, 4, 0.05).box(-0.16, 0.05, -0.02, 0.28, 0.015, 0.14, [0.34, 0.35, 0.39]);
  b.as(0, 0, -4, 0.05).box(0.16, 0.05, -0.02, 0.28, 0.015, 0.14, [0.34, 0.35, 0.39]);
  return b.build();
}

export { COL };
