// GPU-independent resource accounting for the budget gate (scripts/check-budgets.mjs) and the perf overlay.
// Nothing here measures time: texture memory is estimated from dimensions/format, instances are counted from the scene.
import * as THREE from 'three';

const CH = { [THREE.RedFormat]: 1, [THREE.RGFormat]: 2, [THREE.RGBFormat]: 3, [THREE.RGBAFormat]: 4, [THREE.DepthFormat]: 1, [THREE.DepthStencilFormat]: 1, [THREE.AlphaFormat]: 1 };

function bytesPerChannel(type) {
  switch (type) {
    case THREE.FloatType: case THREE.UnsignedIntType: case THREE.IntType: return 4;
    case THREE.HalfFloatType: case THREE.UnsignedShortType: case THREE.ShortType: return 2;
    default: return 1;
  }
}

function dims(img) {
  if (!img) return [0, 0];
  if (Array.isArray(img)) return dims(img[0]);
  const w = img.width ?? img.videoWidth ?? img.naturalWidth ?? 0;
  const h = img.height ?? img.videoHeight ?? img.naturalHeight ?? 0;
  return [w, h];
}

/** estimated bytes of one texture (mips included when they will exist) */
export function textureBytes(t) {
  if (!t || t.isCompressedTexture) return 0;
  const [w, h] = dims(t.image);
  if (!w || !h) return 0;
  let bpp = (CH[t.format] ?? 4) * bytesPerChannel(t.type);
  if (t.format === THREE.DepthFormat || t.format === THREE.DepthStencilFormat) bpp = t.type === THREE.FloatType ? 4 : 4;
  const mip = t.generateMipmaps && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter ? 4 / 3 : 1;
  const faces = t.isCubeTexture ? 6 : 1;
  const layers = t.isData3DTexture ? (t.image.depth || 1) : t.isDataArrayTexture ? (t.image.depth || 1) : 1;
  return w * h * bpp * mip * faces * layers;
}

export function renderTargetBytes(rt) {
  if (!rt) return 0;
  const w = rt.width, h = rt.height, cube = rt.isWebGLCubeRenderTarget ? 6 : 1;
  const texs = rt.textures || [rt.texture];
  let bytes = 0;
  for (const t of texs) {
    const bpp = (CH[t.format] ?? 4) * bytesPerChannel(t.type);
    bytes += w * h * bpp * cube * (t.generateMipmaps ? 4 / 3 : 1);
  }
  if (rt.samples > 0) {
    const t = texs[0];
    bytes += w * h * (CH[t.format] ?? 4) * bytesPerChannel(t.type) * rt.samples; // multisampled colour renderbuffer
  }
  if (rt.depthBuffer) bytes += w * h * 4 * (rt.samples > 0 ? rt.samples + 1 : 1);
  if (rt.depthTexture) bytes += w * h * 4;
  return bytes;
}

const SKIP_KEYS = new Set(['renderer', 'canvas', 'scene', 'camera', 'loop', 'overlay', 'parent', 'children', 'source', 'worker', 'hf', 'manifest', 'plan']);

/**
 * Walk `roots` (app systems, uniform bags ...) and the scene graph; sum the estimated bytes of every distinct texture and render target.
 * Returns { mb, rows:[{label, mb}] } sorted by size.
 */
export function estimateTextureMB(roots, scene) {
  const seen = new Set();
  const rows = [];
  let bytes = 0;
  const addTex = (t, label) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    const b = textureBytes(t);
    if (b) { bytes += b; rows.push({ label: label + ' ' + (t.name || t.constructor.name), mb: b / 1048576 }); }
  };
  const addRT = (rt, label) => {
    if (!rt || seen.has(rt)) return;
    seen.add(rt);
    const b = renderTargetBytes(rt);
    bytes += b;
    rows.push({ label: label + ' RT ' + (rt.texture?.name || `${rt.width}x${rt.height}`), mb: b / 1048576 });
    for (const t of rt.textures || [rt.texture]) seen.add(t);
    if (rt.depthTexture) seen.add(rt.depthTexture);
  };
  const walk = (o, depth, label) => {
    if (!o || depth > 4 || typeof o !== 'object') return;
    if (o.isTexture) return addTex(o, label);
    if (o.isWebGLRenderTarget) return addRT(o, label);
    if (o.isObject3D || o.isMaterial || o.isBufferGeometry) return; // handled by the scene walk
    if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer || o instanceof Set || o instanceof WeakMap) return; // never enumerate raw data
    if (seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (let i = 0; i < Math.min(o.length, 64); i++) walk(o[i], depth + 1, label); return; }
    if (o instanceof Map) { for (const v of o.values()) walk(v, depth + 1, label); return; }
    for (const k of Object.keys(o)) {
      if (SKIP_KEYS.has(k)) continue;
      let v;
      try { v = o[k]; } catch { continue; }
      if (v && typeof v === 'object') walk(v, depth + 1, label + '.' + k);
    }
  };
  for (const [name, r] of Object.entries(roots || {})) walk(r, 0, name);
  // scene graph: material maps + uniform textures, shadow maps
  scene?.traverse((o) => {
    if (o.shadow?.map) addRT(o.shadow.map, 'shadow');
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) addTex(v, 'mat.' + k); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; if (v && v.isTexture) addTex(v, 'uniform'); }
      if (m.userData?.extra) for (const u of Object.values(m.userData.extra)) { const v = u && u.value; if (v && v.isTexture) addTex(v, 'extra'); }
    }
  });
  rows.sort((a, b) => b.mb - a.mb);
  return { mb: bytes / 1048576, rows };
}

/** sum of live instances over every InstancedMesh in the scene, with a per-name breakdown */
export function countInstances(scene) {
  let total = 0;
  const by = {};
  scene.traverse((o) => {
    if (o.isInstancedMesh && o.visible) { total += o.count; by[o.name || 'instanced'] = (by[o.name || 'instanced'] || 0) + o.count; }
  });
  return { total, by };
}
