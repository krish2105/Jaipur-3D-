// Web Worker: owns the street graph and the TrafficSim; the main thread sends fixed steps (or a burst) and gets packed snapshots back.
import { StreetGraph } from './graph.js';
import { TrafficSim } from './traffic.js';
import { HeightSampler, FlatSampler } from '../world/heightSampler.js';

let sim = null;
let opts = null;
let boot = null;

function snapshot(tag) {
  const veh = new Float32Array(8 * sim.capV), ped = new Float32Array(8 * sim.capP), cow = new Float32Array(6 * sim.capC), bird = new Float32Array(6 * sim.capB);
  const nv = sim.snapshotVehicles(veh), np = sim.snapshotPeds(ped), nc = sim.snapshotCows(cow), nb = sim.snapshotBirds(bird);
  self.postMessage({ type: 'snap', tag, veh, nv, ped, np, cow, nc, bird, nb, stats: { time: sim.time, spawned: sim._stats.spawned, forced: sim._stats.forced, nV: sim.nV, nP: sim.nP } }, [veh.buffer, ped.buffer, cow.buffer, bird.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      opts = m;
      const res = await fetch(m.graphUrl);
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('json')) { self.postMessage({ type: 'error', error: `street graph unavailable (${res.status} ${ct})` }); return; }
      const graph = new StreetGraph(await res.json());
      const sampler = m.near ? new HeightSampler(m.near, m.nearN, m.nearHalf, m.far, m.farN, m.farHalf) : new FlatSampler(0);
      sim = new TrafficSim(graph, { seed: m.seed, vehicles: m.vehicles, pedestrians: m.pedestrians, cows: m.cows, birds: m.birds, simRadius: m.simRadius, pedRadius: m.pedRadius, hotspots: m.hotspots, heightAt: (x, z) => sampler.heightAt(x, z) });
      sim.step(1 / 30, { hour: m.hour, cam: m.cam, density: 1 });
      sim.seed(m.seedPasses ?? 120);
      boot = { edges: graph.edgeCount, nodes: graph.nodeCount };
      self.postMessage({ type: 'ready', boot });
      snapshot('init');
      return;
    }
    if (!sim) return;
    if (m.type === 'reseed') {
      sim.reseed({ hour: m.hour, cam: m.cam }, m.passes ?? 60);
      snapshot('reseed');
      return;
    }
    if (m.type === 'step') {
      // m.n substeps of 1/30 s (the main thread clamps the simulation speed for street life to a few x real time)
      for (let i = 0; i < m.n; i++) sim.step(1 / 30, { hour: m.hour, cam: m.cam, density: m.density });
      snapshot(m.tag);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.stack ? err.stack : err) });
  }
};
