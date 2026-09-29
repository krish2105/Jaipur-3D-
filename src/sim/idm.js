// Intelligent Driver Model (Treiber, Hennecke, Helbing 2000): car-following acceleration.
//   a = aMax * [ 1 - (v / v0)^4 - (s* / gap)^2 ],   s* = s0 + v * T + v * dv / (2 * sqrt(aMax * b))
// gap = bumper-to-bumper distance to the leader (m), dv = v - vLeader (closing speed). A stopped virtual leader (stop line, cow,
// red signal) is simply a leader with vLeader = 0. Deceleration is clamped to a physical emergency limit.

export const IDM_DEFAULT = { aMax: 1.6, b: 2.6, s0: 1.6, T: 1.15, delta: 4, brakeLimit: 9.0 };

/**
 * @param {number} v own speed (m/s)
 * @param {number} v0 desired speed (m/s)
 * @param {number} gap distance to the leader (m), Infinity when free
 * @param {number} vLead leader speed (m/s)
 * @param {object} p parameters { aMax, b, s0, T, delta, brakeLimit }
 */
export function idmAccel(v, v0, gap, vLead, p = IDM_DEFAULT) {
  // any missing parameter falls back to the default (a per-vehicle-type object only overrides what it needs to)
  const aMax = p.aMax ?? IDM_DEFAULT.aMax, b = p.b ?? IDM_DEFAULT.b, s0 = p.s0 ?? IDM_DEFAULT.s0, T = p.T ?? IDM_DEFAULT.T;
  const delta = p.delta ?? IDM_DEFAULT.delta, brakeLimit = p.brakeLimit ?? IDM_DEFAULT.brakeLimit;
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), delta);
  if (!Number.isFinite(gap)) return aMax * free;
  const dv = v - vLead;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(aMax * b)));
  const g = Math.max(gap, 0.05);
  const a = aMax * (free - (sStar / g) * (sStar / g));
  return Math.max(a, -brakeLimit);
}
