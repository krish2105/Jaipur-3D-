import * as THREE from 'three';
import { TIERS } from './core/budgets.js';
import { resolveTier } from './core/tier.js';
import { Loop } from './core/loop.js';
import { PerfMonitor, PerfOverlay, DynamicResolution } from './core/perf.js';

const canvas = document.getElementById('c');
const bootMsg = document.getElementById('boot-msg');
const { detected, tier: tierName, forced } = resolveTier();
let tier = TIERS[tierName];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: tierName !== 'low', powerPreference: 'high-performance' });
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 30000);
camera.position.set(0, 40, 90);
camera.lookAt(0, 10, 0);
scene.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshNormalMaterial()));

const perf = new PerfMonitor();
const drs = new DynamicResolution({ min: tier.settings.minPixelRatio, max: Math.min(tier.settings.maxPixelRatio, window.devicePixelRatio || 1), targetMs: 1000 / tier.targetFps, enabled: tier.settings.dynamicResolution });
let pixelRatio = drs.scale;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const overlay = new PerfOverlay(perf, () => ({
  tier: tierName, tierForced: forced, pixelRatio: +pixelRatio.toFixed(2),
  width: renderer.domElement.width, height: renderer.domElement.height,
  simTime: '--', weather: '--', mode: '--', gpu: detected.info.gpu, detected: detected.tier, reasons: detected.reasons,
}));
if (new URLSearchParams(location.search).has('perf')) overlay.toggle(true);
window.addEventListener('keydown', (e) => { if (e.key === '`' || e.key === 'p') overlay.toggle(); });

const loop = new Loop({
  update() {},
  render(dt) {
    renderer.render(scene, camera);
    perf.captureInfo(renderer);
    renderer.info.reset();
    overlay.update(performance.now());
  },
});
loop.fpsCap = tier.settings.fpsCap;
loop.onFrameTime = (raw, clamped) => {
  perf.pushFrame(raw);
  const s = drs.push(raw);
  if (s !== null) { pixelRatio = s; resize(); }
};
loop.start();
document.getElementById('boot').classList.add('done');
bootMsg.textContent = 'ready';
window.__jaipur = { renderer, scene, camera, perf, overlay, loop, tier: tierName };
