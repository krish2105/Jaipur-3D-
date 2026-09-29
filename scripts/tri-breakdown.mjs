// Dev diagnostic: which scene objects hold the main-pass triangles (frustum-culled, one pass; renderer.info adds shadow / mirror passes on top), per tier and view.
//   node scripts/tri-breakdown.mjs [low,medium,high]      (build first: npm run build)
// [cs] marks meshes that also cast shadows (drawn again in every cascade). Used in Phase 13 to find that oriel instances and detail-tile buildings were the cost.
import { openSession } from './lib/session.mjs';
const tiers = (process.argv[2] || 'low').split(',');
const VIEWS = [['street-johari', [-40, 300], [-40, 520], 2.5, 62], ['drone-centre', [-200, 900], [-150, -300], 140, 55]];
for (const tier of tiers) {
  const s = await openSession({ w: 1280, h: 720, tier });
  for (const [label, eye, look, eh, fov] of VIEWS) {
    const res = await s.page.evaluate(async ([eye, look, eh, fov]) => {
      const a = window.__jaipur; a.setTime(15.5); a.setWeather('clear', true);
      const g = (x, z) => a.hf.heightAt(x, z);
      a.setView([eye[0], g(eye[0], eye[1]) + eh, eye[1]], [look[0], g(look[0], look[1]) + (eh > 100 ? 0 : 8), look[1]], fov);
      if (a.life) { a.life.teleport(a); await a.life.run(a, 1); }
      await a.city.settle(a.camera, 90000);
      a.renderStill(3);
      const THREE = a.camera.constructor; // not used
      const cam = a.camera; cam.updateMatrixWorld();
      const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
      const planes = []; const m = M.elements;
      const P = (a_, b_, c_, d_) => { const l = Math.hypot(a_, b_, c_); planes.push([a_ / l, b_ / l, c_ / l, d_ / l]); };
      P(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); P(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
      P(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); P(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
      P(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); P(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
      const by = {};
      a.scene.traverse((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine) return;
        let v = o.visible; for (let p = o.parent; p && v; p = p.parent) v = p.visible; if (!v) return;
        const geo = o.geometry; if (!geo) return;
        let n = geo.index ? geo.index.count / 3 : geo.attributes.position ? geo.attributes.position.count / 3 : 0;
        if (o.isInstancedMesh) n *= o.count;
        if (geo.drawRange && geo.drawRange.count !== Infinity && !o.isInstancedMesh) n = Math.min(n, geo.drawRange.count / 3);
        if (o.frustumCulled && !o.isInstancedMesh) {
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          const c = geo.boundingSphere.center.clone().applyMatrix4(o.matrixWorld); const r = geo.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
          if (planes.some((pl) => pl[0] * c.x + pl[1] * c.y + pl[2] * c.z + pl[3] < -r)) return;
        }
        const key = (o.name || (o.isInstancedMesh ? 'inst:' + (o.geometry.name || o.material.name || '?') : o.material.userData?.programKey || o.material.type)) + (o.castShadow ? ' [cs]' : '');
        by[key] = (by[key] || 0) + n;
      });
      return { tris: a.perf.lastInfo.triangles, by };
    }, [eye, look, eh, fov]);
    const top = Object.entries(res.by).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k}: ${(v / 1e3).toFixed(0)}k`).join(' | ');
    const sum = Object.values(res.by).reduce((x, y) => x + y, 0);
    console.log(tier, label, 'info', (res.tris / 1e6).toFixed(2) + 'M', 'main-pass sum', (sum / 1e6).toFixed(2) + 'M\n   ', top);
  }
  await s.close();
}
