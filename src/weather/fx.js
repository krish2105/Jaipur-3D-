// Weather effects orchestrator: owns the rain / lightning / dust / reflection systems, feeds them the blended weather state each frame.
import * as THREE from 'three';
import { Rain } from './rain.js';
import { Lightning } from './lightning.js';
import { DustFlow } from './dust.js';
import { ENV } from '../render/env.js';

export class WeatherFx {
  /**
   * @param {{scene:THREE.Scene, settings:object, hf:object}} o
   */
  constructor(o) {
    this.scene = o.scene;
    this.settings = o.settings;
    this.hf = o.hf;
    this.time = 0; // real-time seconds, independent of the simulation clock speed
    this.rain = new Rain(o.settings);
    this.scene.add(this.rain.group);
    this.lightning = new Lightning(o.scene);
    this.dust = new DustFlow(o.settings);
    this.scene.add(this.dust.mesh);
  }

  /** per rendered frame (dt is the clamped real frame time) */
  frame(dt, app) {
    this.time += dt;
    ENV.uFxT.value = this.time;
    const w = app.weather.s;
    const cam = app.camera;
    // wind: same heading convention as the cloud advection (x = sin, z = cos); rain slants at a fraction of the wind speed
    const wx = Math.sin(w.windDir) * w.windSpeed, wz = Math.cos(w.windDir) * w.windSpeed;
    const gy = this.hf.heightAt(cam.position.x, cam.position.z);
    this.rain.update({
      time: this.time, intensity: w.rain, windX: wx * 0.55, windZ: wz * 0.55, camera: cam,
      viewportW: app.renderer.domElement.width, viewportH: app.renderer.domElement.height, groundY: gy,
    });
    // dust flow scales with dust load and how strong the wind-driven storm is (a calm hazy day has haze but no moving sheets)
    this.dust.update({ time: this.time, intensity: Math.min(1, w.dust * (0.15 + 0.85 * w.storm)) * 1.1, windX: wx * 0.9, windZ: wz * 0.9, camera: cam, tint: w.dustTint });
    this.lightning.update(app.weather, cam, app.renderer.domElement.width, app.renderer.domElement.height);
  }
}
