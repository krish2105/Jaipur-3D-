// Key light (sun or moon) with cascaded shadow maps + material registration.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { patchLightChunk } from './env.js';

export class Lighting {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} settings tier settings
   */
  constructor(scene, camera, settings) {
    this.scene = scene;
    this.camera = camera;
    this.settings = settings;
    this.csm = null;
    this.materials = new Set();

    if (settings.shadowCascades > 0) {
      this.csm = new CSM({
        camera,
        parent: scene,
        cascades: settings.shadowCascades,
        maxFar: settings.shadowDistance,
        mode: settings.shadowCascades > 1 ? 'practical' : 'uniform',
        shadowMapSize: settings.shadowMapSize,
        shadowBias: -0.00025,
        lightDirection: new THREE.Vector3(-0.4, -1, -0.3).normalize(),
        lightIntensity: 1,
        lightMargin: 240,
        lightNear: 1,
        lightFar: 4000,
      });
      this.csm.fade = settings.shadowCascades > 1;
      for (let i = 0; i < this.csm.lights.length; i++) {
        const l = this.csm.lights[i];
        l.shadow.normalBias = 0.5 + i * 0.9;
        l.castShadow = true;
      }
    } else {
      // no shadows: still need a directional light
      const l = new THREE.DirectionalLight(0xffffff, 1);
      l.position.set(0, 1, 0);
      scene.add(l, l.target);
      this.plain = l;
    }
    patchLightChunk();
  }

  /** register a lit material so it receives cascaded shadows (chains with its own onBeforeCompile) */
  setupMaterial(mat) {
    if (this.materials.has(mat)) return mat;
    this.materials.add(mat);
    if (!this.csm) return mat;
    const own = mat.onBeforeCompile;
    this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    const key = mat.userData.programKey || mat.name || mat.type;
    mat.userData.programKey = key + '|csm';
    mat.onBeforeCompile = function chained(shader, renderer) {
      csmHook.call(mat, shader, renderer);
      own.call(mat, shader, renderer);
    };
    return mat;
  }

  /** apply the frame's key light */
  update(env, dt) {
    const dir = env.keyDir; // direction TO the light
    const col = env.keyColor;
    if (this.csm) {
      this.csm.lightDirection.copy(dir).negate();
      const n = this.csm.lights.length;
      for (let i = 0; i < n; i++) {
        const l = this.csm.lights[i];
        l.color.setRGB(col.r, col.g, col.b);
        // CSM cascades are separate lights; each contributes only inside its cascade (shader-side)
        l.intensity = 1;
        l.visible = col.r + col.g + col.b > 1e-4;
      }
      this.csm.update();
    } else if (this.plain) {
      this.plain.color.copy(col);
      this.plain.intensity = 1;
      this.plain.position.copy(dir).multiplyScalar(500).add(this.camera.position);
      this.plain.target.position.copy(this.camera.position);
      this.plain.target.updateMatrixWorld();
    }
  }

  updateFrustums() {
    this.csm?.updateFrustums();
  }

  dispose() {
    this.csm?.dispose();
  }
}
