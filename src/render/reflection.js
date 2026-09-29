// Planar reflection of the scene for wet streets (high / medium tiers).
// One mirror plane at the ground under the camera (the city is flat to within a few metres). The mirrored camera renders
//  * only what is near (far plane 650 m) at `reflectionScale` of the frame size, into a half-float target
//  * with a GLOBAL clip plane at the ground (so the sky pass, which ignores clipping, is unaffected)
//  * without re-rendering the shadow maps (the previous frame's are reused)
// Materials sample it through `textureMatrix` (world position -> mirrored-camera uv), see roadMaterial.js.
import * as THREE from 'three';

export class PlanarReflection {
  constructor(renderer, settings) {
    this.enabled = settings.reflections === 'planar';
    this.scale = settings.reflectionScale || 0.4;
    this.far = settings.reflectionFar || 650;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true });
    this.rt.texture.name = 'planar-reflection';
    this.cam = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.active = false;
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this.renderer = renderer;
  }

  setSize(w, h) {
    const rw = Math.max(2, Math.round(w * this.scale)), rh = Math.max(2, Math.round(h * this.scale));
    if (rw !== this.rt.width || rh !== this.rt.height) this.rt.setSize(rw, rh);
  }

  /** shader uniforms (shared objects) */
  get uniforms() {
    return { uReflTex: { value: this.rt.texture }, uReflMat: { value: this.textureMatrix } };
  }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera main camera
   * @param {number} y0 world height of the mirror plane
   * @param {THREE.Object3D[]} hide objects that must not appear in the reflection (rain ...)
   * @returns {boolean} whether the reflection was rendered
   */
  render(scene, camera, y0, hide = []) {
    if (!this.enabled) return false;
    const r = this.renderer;
    const c = this.cam;
    const eye = camera.position;
    if (eye.y <= y0 + 0.2) { this.active = false; return false; }
    // mirrored eye, look-at and up (the classic Reflector construction for the plane y = y0 with normal +Y)
    const view = this._v.set(eye.x, 2 * y0 - eye.y, eye.z);
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._look.set(0, 0, -1).applyMatrix4(this._rot).add(eye);
    const target = this._t.set(look.x, 2 * y0 - look.y, look.z);
    c.position.copy(view);
    c.up.set(0, 1, 0).applyMatrix4(this._rot);
    c.up.y = -c.up.y; // reflect
    c.lookAt(target);
    c.fov = camera.fov; c.aspect = camera.aspect; c.near = camera.near; c.far = this.far;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    // world -> uv
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    // render
    this.clip.set(new THREE.Vector3(0, 1, 0), -y0 + 0.02);
    const prevRT = r.getRenderTarget(), prevClip = r.clippingPlanes, prevAuto = r.shadowMap.autoUpdate, prevXR = r.xr.enabled;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;
    r.clippingPlanes = [this.clip];
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, c);
    r.clippingPlanes = prevClip;
    r.shadowMap.autoUpdate = prevAuto;
    r.xr.enabled = prevXR;
    r.setRenderTarget(prevRT);
    hide.forEach((o, i) => { o.visible = vis[i]; });
    this.active = true;
    return true;
  }

  dispose() {
    this.rt.dispose();
  }
}
