// Floodlight sources for the hand-modelled landmarks (pure): where the light-grid sources go around each planned landmark.
// APPROX: real lighting schemes are not documented in any opened source; the landmarks are simply lit warm from the street side, the way the
// heritage buildings of Jaipur are floodlit at night (art direction). Positions derive from the OSM-based landmark plan (planLandmarks items).
//   returns Float32Array stride 7: x, z, r, g, b, radius(m), kind (3 = landmark)
const WARM = [1.0, 0.6, 0.3];
const WHITE = [0.9, 0.82, 0.68];

/** @param {object[]} items planLandmarks(...).items */
export function landmarkSources(items) {
  const out = [];
  const add = (x, z, c, k, R) => out.push(x, z, c[0] * k, c[1] * k, c[2] * k, R, 3);
  for (const it of items || []) {
    switch (it.kind) {
      case 'hawa': {
        // the celebrated facade faces the street along +n; floodlights stand in the street in front of it
        for (const s of [-16, -8, 0, 8, 16]) add(it.x + it.nx * 9 + it.ux * s, it.z + it.nz * 9 + it.uz * s, [1.0, 0.5, 0.3], 3.2, 30);
        add(it.x - it.nx * 4, it.z - it.nz * 4, WARM, 1.2, 40); // the rear block
        break;
      }
      case 'chandra':
      case 'mubarak': {
        const ux = Math.cos(it.yaw), uz = -Math.sin(it.yaw), vx = uz, vz = -ux; // (u along the length, v across)
        const L = (it.len || 30) / 2, D = (it.dep || 20) / 2 + 7;
        for (const [a, b] of [[-0.6, 1], [0, 1], [0.6, 1], [-0.6, -1], [0, -1], [0.6, -1]]) add(it.x + ux * L * a * 1.6 + vx * D * b, it.z + uz * L * a * 1.6 + vz * D * b, WARM, it.kind === 'chandra' ? 3.4 : 2.6, 34);
        break;
      }
      case 'gate': {
        const ux = Math.cos(it.yaw), uz = -Math.sin(it.yaw), vx = uz, vz = -ux;
        const D = (it.dep || 20) / 2 + 5;
        add(it.x + vx * D, it.z + vz * D, WARM, 2.6, 26);
        add(it.x - vx * D, it.z - vz * D, WARM, 2.6, 26);
        add(it.x + ux * 0, it.z + uz * 0, WARM, 1.0, 20);
        break;
      }
      case 'jm': {
        const ring = it.site && it.site.ring;
        if (ring && ring.length) {
          // a handful of low lights spread around the compound wall
          const step = Math.max(1, Math.floor(ring.length / 6));
          for (let i = 0; i < ring.length; i += step) add(ring[i][0], ring[i][1], WHITE, 1.4, 28);
        } else add(it.x, it.z, WHITE, 1.6, 40);
        break;
      }
      case 'jal': {
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(it.x + a * 46, it.z + b * 46, [1.0, 0.7, 0.38], 2.2, 42);
        break;
      }
      default: break;
    }
  }
  return Float32Array.from(out);
}
