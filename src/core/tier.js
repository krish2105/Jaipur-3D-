// Device -> quality tier detection, with manual override (URL ?tier=, localStorage, UI).
import { TIERS, TIER_ORDER } from './budgets.js';

const LS_KEY = 'jaipur3d.tier';

function readGpuString() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { gpu: 'none', webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { gpu: String(gpu), webgl2, maxTex };
  } catch {
    return { gpu: 'unknown', webgl2: false };
  }
}

/**
 * Heuristic detection. Returns { tier, reasons[], info }.
 * Phones -> low, Apple-silicon / discrete GPUs -> high, integrated / older -> medium.
 */
export function detectTier() {
  const nav = navigator;
  const ua = nav.userAgent || '';
  const { gpu, webgl2, maxTex } = readGpuString();
  const gpuL = gpu.toLowerCase();
  const mem = nav.deviceMemory || 0; // Chrome only; capped at 8
  const cores = nav.hardwareConcurrency || 4;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touchPoints = nav.maxTouchPoints || 0;
  const shortSide = Math.min(screen.width, screen.height);
  const isPhoneUA = /iPhone|iPod|Android.*Mobile|Mobile Safari|Windows Phone/i.test(ua);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  const isIPad = /iPad/i.test(ua) || (nav.platform === 'MacIntel' && touchPoints > 1);
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isIPad;
  const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(gpuL);

  const reasons = [];
  let tier = 'medium';

  if (software) {
    tier = 'low';
    reasons.push('software renderer');
  } else if (isPhoneUA || (coarse && shortSide < 700)) {
    tier = 'low';
    reasons.push('phone-class device');
  } else if (isIPad || isAndroidTablet) {
    tier = 'medium';
    reasons.push('tablet');
  } else if (/apple m\d|apple gpu.*m\d/.test(gpuL) || (isMac && /apple/.test(gpuL))) {
    tier = 'high';
    reasons.push('Apple silicon GPU');
  } else if (/rtx|gtx 1[0-9]{3}|gtx 9|radeon rx|radeon pro|arc a\d|geforce|quadro|titan|rx \d{3,4}/.test(gpuL)) {
    tier = 'high';
    reasons.push('discrete desktop GPU');
  } else if (/intel|uhd|iris|hd graphics|mali|adreno|powervr|vega [0-9] |radeon graphics/.test(gpuL)) {
    tier = 'medium';
    reasons.push('integrated GPU');
  } else {
    tier = cores >= 8 && (mem === 0 || mem >= 8) ? 'high' : 'medium';
    reasons.push('unknown GPU, judged by cores/memory');
  }

  if (mem && mem <= 2 && tier !== 'low') {
    tier = 'low';
    reasons.push('deviceMemory <= 2 GB');
  } else if (mem && mem <= 4 && tier === 'high') {
    tier = 'medium';
    reasons.push('deviceMemory <= 4 GB');
  }
  if (!webgl2) reasons.push('WebGL2 unavailable');
  if (maxTex && maxTex < 8192 && tier === 'high') {
    tier = 'medium';
    reasons.push('MAX_TEXTURE_SIZE < 8192');
  }

  return {
    tier,
    reasons,
    info: { gpu, webgl2, cores, mem, coarse, touchPoints, shortSide, dpr: window.devicePixelRatio || 1, software },
  };
}

/** Resolve the active tier: URL param > stored override > detection. */
export function resolveTier() {
  const detected = detectTier();
  let forced = null;
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (q && TIERS[q]) forced = q;
    else {
      const s = localStorage.getItem(LS_KEY);
      if (s && TIERS[s]) forced = s;
    }
  } catch {
    /* storage may be blocked */
  }
  return { detected, tier: forced || detected.tier, forced: !!forced };
}

export function storeTierOverride(tier) {
  try {
    if (tier === 'auto') localStorage.removeItem(LS_KEY);
    else if (TIERS[tier]) localStorage.setItem(LS_KEY, tier);
  } catch {
    /* ignore */
  }
}

export function stepDown(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, i - 1)];
}
