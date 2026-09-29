// Camera maths (pure, node-testable): splines, polylines, fly / walk stepping, touch stick mapping.
// Heading convention: yaw is a compass heading in radians, 0 = north (-z), positive clockwise seen from above (east = +pi/2).
//   forward = (sin yaw cos p, sin p, -cos yaw cos p), right = (cos yaw, 0, sin yaw). A three.js camera uses rotation (pitch, -yaw, 0) with order 'YXZ'.

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

export function forward(yaw, pitch, out = [0, 0, 0]) {
  const c = Math.cos(pitch);
  out[0] = Math.sin(yaw) * c; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * c;
  return out;
}
export function headingOf(dx, dz) { return Math.atan2(dx, -dz); }

/** uniform Catmull-Rom through n >= 2 points (arrays of equal length), u in 0..1 over the whole curve */
export function catmullRom(points, u, out = []) {
  const n = points.length;
  if (n === 1) { for (let k = 0; k < points[0].length; k++) out[k] = points[0][k]; return out; }
  const f = clamp(u, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f)), t = f - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  for (let k = 0; k < p1.length; k++) out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return out;
}

/** cumulative lengths of a flat [x, z, x, z ...] polyline */
export function polylineLengths(pts) {
  const n = pts.length / 2, cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]);
  return cum;
}
/** point at distance s along a flat polyline (clamped); writes {x, z, dx, dz} (unit tangent) */
export function polylineAt(pts, cum, s, out = { x: 0, z: 0, dx: 0, dz: 1 }) {
  const n = pts.length / 2;
  s = clamp(s, 0, cum[n - 1]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
  const x0 = pts[lo * 2], z0 = pts[lo * 2 + 1], x1 = pts[hi * 2], z1 = pts[hi * 2 + 1];
  out.x = x0 + (x1 - x0) * t; out.z = z0 + (z1 - z0) * t;
  const l = Math.hypot(x1 - x0, z1 - z0) || 1;
  out.dx = (x1 - x0) / l; out.dz = (z1 - z0) / l;
  return out;
}

/** virtual stick: offset of the touch from where it started, mapped to -1..1 with a dead zone; y is screen-down so forward = -y */
export function stickVector(dx, dy, radius, dead = 0.12, out = { x: 0, y: 0 }) {
  const l = Math.hypot(dx, dy) / radius;
  const m = Math.min(1, l);
  if (m < dead || l === 0) { out.x = 0; out.y = 0; return out; }
  const s = (m - dead) / (1 - dead) / l; // direction unit vector * rescaled magnitude, dead zone removed
  out.x = (dx / radius) * s; out.y = (dy / radius) * s;
  return out;
}

/**
 * Advance a free-fly or walking camera by dt.
 * @param {{pos:number[], vel:number[], yaw:number, pitch:number}} s  mutated in place
 * @param {{fwd:number, right:number, up:number, boost:number, slow:number}} input  axes -1..1; boost / slow 0..1
 * @param {number} dt
 * @param {{mode:'fly'|'walk', speed:number, groundAt:(x:number,z:number)=>number, minHeight?:number, eye?:number}} o
 */
export function stepMove(s, input, dt, o) {
  const f = forward(s.yaw, o.mode === 'walk' ? 0 : s.pitch), rx = Math.cos(s.yaw), rz = Math.sin(s.yaw);
  const speed = o.speed * (1 + 3 * (input.boost || 0)) * (1 - 0.85 * (input.slow || 0));
  const tx = (f[0] * input.fwd + rx * input.right) * speed;
  let ty = (o.mode === 'walk' ? 0 : f[1] * input.fwd + (input.up || 0) * 0.8) * speed;
  const tz = (f[2] * input.fwd + rz * input.right) * speed;
  const k = 1 - Math.exp(-dt * 7);
  s.vel[0] += (tx - s.vel[0]) * k; s.vel[1] += (ty - s.vel[1]) * k; s.vel[2] += (tz - s.vel[2]) * k;
  s.pos[0] += s.vel[0] * dt; s.pos[1] += s.vel[1] * dt; s.pos[2] += s.vel[2] * dt;
  const g = o.groundAt(s.pos[0], s.pos[2]);
  if (o.mode === 'walk') {
    // eye height above the ground, followed smoothly so stairs / kerbs do not jerk the camera
    const want = g + (o.eye ?? 1.7);
    s.pos[1] += (want - s.pos[1]) * (1 - Math.exp(-dt * 12));
    s.vel[1] = 0;
  } else {
    const floor = g + (o.minHeight ?? 2.5);
    if (s.pos[1] < floor) { s.pos[1] = floor; if (s.vel[1] < 0) s.vel[1] = 0; }
  }
  return s;
}

/** apply a look delta in pixels: sensitivity in radians per pixel; pitch limited to +-1.5 rad */
export function look(s, dx, dy, sens = 0.0032) {
  s.yaw = wrapAngle(s.yaw + dx * sens);
  s.pitch = clamp(s.pitch - dy * sens, -1.5, 1.5);
  return s;
}
