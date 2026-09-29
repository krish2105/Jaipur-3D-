import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { StreetGraph } from '../src/sim/graph.js';
import { TrafficSim, TYPES, vehicleDensity, pedDensity } from '../src/sim/traffic.js';

// SYNTHETIC test graph (tests only, never baked): a 5 x 5 grid of 200 m roads with one signalised node, 1 one-way street, a footway
function gridGraph() {
  const N = 5, S = 200, nodes = [], edges = [];
  const id = (i, j) => j * N + i;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) nodes.push([Math.round((i - 2) * S * 10), Math.round((j - 2) * S * 10), i === 2 && j === 2 ? 1 : 0]);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (i + 1 < N) edges.push({ a: id(i, j), b: id(i + 1, j), len: S, c: j === 2 ? 'primary' : 'residential', w: j === 2 ? 12 : 7, ln: 2, v: j === 2 ? 40 : 20, o: j === 0 ? 1 : 0, car: 1, n: j === 2 ? 'Test Bazaar Road' : undefined });
    if (j + 1 < N) edges.push({ a: id(i, j), b: id(i, j + 1), len: S, c: 'residential', w: 7, ln: 2, v: 20, o: 0, car: 1 });
  }
  edges.push({ a: 0, b: 6, len: 283, c: 'footway', w: 2, ln: 1, v: 5, o: 0, car: 0 });
  return { v: 1, unit: 'dm', nodes, edges, signals: [] };
}

const flatH = () => 0;
const CAM = { x: 0, y: 40, z: 0, fx: 0, fy: -0.3, fz: -0.95, fov: 60, aspect: 1.78 };

function makeSim(seedOffset = 0, caps = {}) {
  const g = new StreetGraph(gridGraph());
  const sim = new TrafficSim(g, { seed: 7 + seedOffset, vehicles: 120, pedestrians: 150, cows: 6, birds: 40, heightAt: flatH, simRadius: 700, pedRadius: 500, hotspots: [{ x: 0, z: 0, r: 200, w: 4 }], ...caps });
  return { g, sim };
}

test('graph: polylines, left lateral offset and one-way adjacency', () => {
  const g = new StreetGraph(gridGraph());
  assert.equal(g.nodeCount, 25);
  const e = 0; // node 0 -> node 1 along +x on the one-way top row (z = -400)
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  g.place(e, 0, 50, 0, p);
  assert.ok(Math.abs(p.x - (-400 + 50)) < 1e-3 && Math.abs(p.z - -400) < 1e-3);
  assert.ok(p.dx > 0.99);
  // travelling east, the LEFT side is north = -z (x east, z south)
  g.place(e, 0, 50, 1.5, p);
  assert.ok(Math.abs(p.z - (-400 - 1.5)) < 1e-3, 'left of east-bound is north: ' + p.z);
  // one-way: node 1's outgoing list must not contain edge 0 in the reverse direction
  const n1 = 1;
  const outs = Array.from(g.outList.subarray(g.outStart[n1], g.outStart[n1 + 1]));
  assert.ok(!outs.includes(0 * 2 + 1), 'no travel against a one-way street');
  // pedestrians can walk the footway both ways, vehicles cannot use it
  const fw = g.edgeCount - 1;
  assert.equal(g.car[fw], 0);
  assert.ok(Array.from(g.pedList.subarray(g.pedStart[0], g.pedStart[1])).some((c) => c >> 1 === fw));
  assert.ok(!Array.from(g.outList).some((c) => c >> 1 === fw));
});

test('density curves: night is quiet, rush hours are busy, evening bazaar peak for people', () => {
  assert.ok(vehicleDensity(3) < 0.25 && vehicleDensity(10) > 0.9 && vehicleDensity(18) > 0.9 && vehicleDensity(23.5) < 0.4);
  assert.ok(pedDensity(11.3) > 0.9 && pedDensity(18.6) > 0.9 && pedDensity(3) < 0.2);
  for (let h = 0; h <= 24; h += 0.25) { const v = vehicleDensity(h); assert.ok(v >= 0.12 && v <= 1); }
});

test('simulation: no overlaps, no teleporting, sane speeds, keeps left, and it flows (not a permanent jam)', () => {
  const { g, sim } = makeSim();
  sim.step(1 / 30, { hour: 10, cam: CAM });
  sim.seed(80);
  assert.ok(sim.nV > 60, 'population seeded: ' + sim.nV);
  const dt = 1 / 30;
  let minGap = Infinity, maxSpeed = 0, totalV = 0, samples = 0;
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  const prev = new Map();
  for (let step = 0; step < 30 * 120; step++) {
    sim.step(dt, { hour: 10, cam: CAM });
    // per road + direction: bumper gap between neighbours
    const lists = new Map();
    for (let i = 0; i < sim.capV; i++) {
      if (!sim.vAlive[i]) continue;
      const k = sim.vEdge[i] * 2 + sim.vDir[i];
      if (!lists.has(k)) lists.set(k, []);
      lists.get(k).push(i);
      maxSpeed = Math.max(maxSpeed, sim.vV[i]);
      totalV += sim.vV[i]; samples++;
      // continuity: no jumps larger than what the speed allows (roads change at nodes, so compare world positions)
      g.place(sim.vEdge[i], sim.vDir[i], sim.vS[i], 0, p);
      const q = prev.get(i);
      if (q && q.age === sim.vAge[i] - dt) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 1.2, `vehicle ${i} jumped ${Math.hypot(p.x - q.x, p.z - q.z).toFixed(2)} m`);
      prev.set(i, { x: p.x, z: p.z, age: sim.vAge[i] });
    }
    for (const list of lists.values()) {
      list.sort((a, b) => sim.vS[a] - sim.vS[b]);
      for (let k = 0; k + 1 < list.length; k++) {
        const a = list[k], b = list[k + 1];
        const gap = sim.vS[b] - sim.vS[a] - 0.5 * (TYPES[sim.vType[a]].len + TYPES[sim.vType[b]].len);
        minGap = Math.min(minGap, gap);
      }
    }
  }
  assert.ok(minGap > -0.8, 'vehicles on one road never drive through each other: min bumper gap ' + minGap.toFixed(2));
  assert.ok(maxSpeed < 17, 'speeds stay plausible: ' + maxSpeed.toFixed(1));
  assert.ok(totalV / samples > 2.0, 'traffic flows, mean speed ' + (totalV / samples).toFixed(2) + ' m/s');
});

test('spawning: nothing appears inside the camera view cone (or right next to the lens)', () => {
  const { g, sim } = makeSim(3);
  sim.step(1 / 30, { hour: 9, cam: CAM });
  sim.nV = 0; sim.vAlive.fill(0);
  const before = new Set();
  let violations = 0, spawned = 0;
  const p = { x: 0, z: 0, dx: 0, dz: 0 };
  for (let i = 0; i < 400; i++) {
    const n0 = sim.nV;
    sim._manageVehicles(0);
    for (let j = 0; j < sim.capV; j++) {
      if (sim.vAlive[j] && !before.has(j)) {
        before.add(j); spawned++;
        g.place(sim.vEdge[j], sim.vDir[j], sim.vS[j], 0, p);
        if (sim._inView(p.x, sim.heightAt(p.x, p.z) + 1, p.z)) violations++;
      }
    }
    void n0;
  }
  assert.ok(spawned > 40, 'spawned ' + spawned);
  assert.equal(violations, 0, 'spawned inside the view cone');
});

test('population follows the time of day (night quiet, morning busy) for vehicles and pedestrians', () => {
  const { sim } = makeSim(5);
  sim.step(1 / 30, { hour: 10, cam: CAM });
  sim.seed(100);
  const day = { v: sim.nV, p: sim.nP };
  // dusk -> deep night: population is trimmed only where nobody is looking, so look the other way
  const away = { ...CAM, fz: 0.95, fx: 0, fy: -0.3 };
  for (let i = 0; i < 30 * 40; i++) sim.step(1 / 30, { hour: 3, cam: away });
  assert.ok(sim.nV < day.v * 0.55, `vehicles ${day.v} -> ${sim.nV}`);
  assert.ok(sim.nP < day.p * 0.4, `pedestrians ${day.p} -> ${sim.nP}`);
});

test('crowds gather where the hot weight is (bazaar street), cows stay on small streets, pigeons exist', () => {
  const { g, sim } = makeSim(9);
  sim.step(1 / 30, { hour: 11.3, cam: CAM });
  sim.seed(120);
  let onBazaar = 0, total = 0;
  for (let i = 0; i < sim.capP; i++) if (sim.pAlive[i]) { total++; if (g.bazaar[sim.pEdge[i]] || sim.hot[sim.pEdge[i]] > 2) onBazaar++; }
  assert.ok(total > 50);
  // the primary "Bazaar Road" row is 1 of 5 rows: uniform placement would put ~20 % of people on it
  assert.ok(onBazaar / total > 0.3, `bazaar share ${(onBazaar / total).toFixed(2)}`);
  for (let i = 0; i < sim.capC; i++) if (sim.cAlive[i]) assert.ok(g.rank[sim.cEdge[i]] <= 2 && g.car[sim.cEdge[i]] === 1);
  const b = new Float32Array(6 * sim.capB);
  assert.equal(sim.snapshotBirds(b), 40);
});

test('determinism: the same seed and inputs give bit-identical snapshots', () => {
  const run = () => {
    const { sim } = makeSim(11);
    sim.step(1 / 30, { hour: 12, cam: CAM });
    sim.seed(50);
    for (let i = 0; i < 300; i++) sim.step(1 / 30, { hour: 12, cam: CAM });
    const out = new Float32Array(8 * sim.capV);
    const n = sim.snapshotVehicles(out);
    return [n, Array.from(out.subarray(0, n * 8)).map((v) => Math.round(v * 1000))];
  };
  const a = run(), b = run();
  assert.equal(a[0], b[0]);
  assert.deepEqual(a[1], b[1]);
});

test('real baked Jaipur graph: builds, and a short simulation near Badi Chaupar runs without overlaps', { skip: !existsSync('public/data/osm/graph.json') }, () => {
  const g = new StreetGraph(JSON.parse(readFileSync('public/data/osm/graph.json', 'utf8')));
  assert.ok(g.edgeCount > 20000);
  const sim = new TrafficSim(g, { seed: 1, vehicles: 250, pedestrians: 300, cows: 10, birds: 40, heightAt: flatH, simRadius: 900, pedRadius: 500 });
  const cam = { x: 0, y: 60, z: 100, fx: 0, fy: -0.3, fz: -0.95, fov: 60, aspect: 1.78 };
  sim.step(1 / 30, { hour: 10, cam });
  sim.seed(80);
  assert.ok(sim.nV > 100 && sim.nP > 100, `real graph population ${sim.nV} vehicles, ${sim.nP} people`);
  let minGap = Infinity;
  for (let step = 0; step < 30 * 60; step++) {
    sim.step(1 / 30, { hour: 10, cam });
    if (step % 15) continue;
    const lists = new Map();
    for (let i = 0; i < sim.capV; i++) if (sim.vAlive[i]) { const k = sim.vEdge[i] * 2 + sim.vDir[i]; (lists.get(k) || lists.set(k, []).get(k)).push(i); }
    for (const list of lists.values()) {
      list.sort((a, b) => sim.vS[a] - sim.vS[b]);
      for (let k = 0; k + 1 < list.length; k++) minGap = Math.min(minGap, sim.vS[list[k + 1]] - sim.vS[list[k]] - 0.5 * (TYPES[sim.vType[list[k]]].len + TYPES[sim.vType[list[k + 1]]].len));
    }
  }
  assert.ok(minGap > -1.0, 'min bumper gap on the real graph ' + minGap.toFixed(2));
});
