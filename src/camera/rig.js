// Camera rig: free-fly and walking modes with keyboard, mouse and touch (virtual stick + look drag + up / down hold buttons).
// The cinematic tour drives the camera itself (mode 'tour'); any movement input during the tour cancels it and hands over to free-fly at the current pose.
// Controls:  desktop  W A S D / arrows move, E or Space up, Q or C down, Shift fast, Ctrl slow, drag to look, wheel = speed
//            touch    left third of the screen = move stick, the rest = look, on-screen up / down buttons
import * as THREE from 'three';
import { stepMove, look, stickVector, headingOf, clamp } from './math.js';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyQ', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight']);

export class CameraRig {
  /** @param {{app:object, canvas:HTMLCanvasElement}} o */
  constructor(o) {
    this.app = o.app;
    this.canvas = o.canvas;
    this.mode = 'fly'; // 'fly' | 'walk' | 'tour'
    this.s = { pos: [0, 60, 250], vel: [0, 0, 0], yaw: 0, pitch: -0.1 };
    this.keys = new Set();
    this.holds = { up: false, down: false };
    this.speedMult = 1;
    this.stick = null;           // { id, x0, y0, x, y } while a finger drives the move stick
    this.lookTouch = null;       // { id, x, y }
    this.mouse = null;           // { id, x, y }
    this.stickRadius = 58;
    this.onUserInput = null;     // () => void, called for every movement / look input (cancels the tour)
    this._last = new THREE.Vector3(1e9, 1e9, 1e9);
    this._lastQ = new THREE.Quaternion();
    this.forceActive = false;   // tests: let the rig run even in ?shot mode
    this._dir = new THREE.Vector3();
    this._axes = { fwd: 0, right: 0, up: 0, boost: 0, slow: 0 };
    this._sv = { x: 0, y: 0 };
    this.attached = false;
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    const c = this.canvas;
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.holds.up = this.holds.down = false; });
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) c.addEventListener(t, (e) => this._up(e));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.speedMult = clamp(this.speedMult * Math.exp(-e.deltaY * 0.0012), 0.08, 25); this._user(); }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _user() { if (this.onUserInput) this.onUserInput(); }

  _key(e, down) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!MOVE_KEYS.has(e.code) && e.key !== 'Control') return;
    if (e.ctrlKey || e.metaKey || e.altKey) { if (e.key !== 'Control') return; }
    if (e.key === 'Control') { if (down) this.keys.add('Control'); else this.keys.delete('Control'); return; }
    if (down) { this.keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') this._user(); } else this.keys.delete(e.code);
  }

  _down(e) {
    this.canvas.focus?.();
    if (e.pointerType === 'touch') {
      const left = e.clientX < window.innerWidth * 0.42;
      if (left && !this.stick) this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      else if (!this.lookTouch) this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      else return;
      this.canvas.setPointerCapture?.(e.pointerId);
      this._user();
    } else if (e.button === 0 || e.button === 2) {
      this.mouse = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture?.(e.pointerId);
      this._user();
    }
  }

  _move(e) {
    if (this.stick && e.pointerId === this.stick.id) { this.stick.x = e.clientX; this.stick.y = e.clientY; return; }
    if (this.lookTouch && e.pointerId === this.lookTouch.id) {
      this._lookBy(e.clientX - this.lookTouch.x, e.clientY - this.lookTouch.y, 0.0048);
      this.lookTouch.x = e.clientX; this.lookTouch.y = e.clientY;
      return;
    }
    if (this.mouse && e.pointerId === this.mouse.id) {
      this._lookBy(e.clientX - this.mouse.x, e.clientY - this.mouse.y, 0.0032);
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    }
  }

  _up(e) {
    if (this.stick && e.pointerId === this.stick.id) this.stick = null;
    if (this.lookTouch && e.pointerId === this.lookTouch.id) this.lookTouch = null;
    if (this.mouse && e.pointerId === this.mouse.id) this.mouse = null;
  }

  _lookBy(dx, dy, sens) {
    if (this.mode === 'tour') { this._user(); return; }
    look(this.s, dx, dy, sens);
    this._user();
  }

  /** read the camera's current pose into the rig state (after any external setView / lookAt) */
  syncFromCamera() {
    const cam = this.app.camera;
    cam.updateMatrixWorld(true);
    cam.getWorldDirection(this._dir);
    this.s.pos[0] = cam.position.x; this.s.pos[1] = cam.position.y; this.s.pos[2] = cam.position.z;
    this.s.yaw = headingOf(this._dir.x, this._dir.z);
    this.s.pitch = Math.asin(clamp(this._dir.y, -1, 1));
    this.s.vel[0] = this.s.vel[1] = this.s.vel[2] = 0;
    this._last.copy(cam.position);
    this._lastQ.copy(cam.quaternion);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    if (was === 'tour' || mode !== 'tour') this.syncFromCamera();
  }

  /** hold-to-move buttons of the touch UI */
  setHold(which, on) { this.holds[which] = !!on; if (on) this._user(); }

  /** true while the user is actively steering (keys, stick, drag) */
  get active() { return this.keys.size > 0 || !!this.stick || !!this.lookTouch || !!this.mouse || this.holds.up || this.holds.down; }

  _axesNow() {
    const a = this._axes, k = this.keys;
    a.fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    a.right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    a.up = (k.has('KeyE') || k.has('Space') || this.holds.up ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') || this.holds.down ? 1 : 0);
    a.boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0;
    a.slow = k.has('Control') ? 1 : 0;
    if (this.stick) {
      stickVector(this.stick.x - this.stick.x0, this.stick.y - this.stick.y0, this.stickRadius, 0.12, this._sv);
      a.fwd = clamp(a.fwd - this._sv.y, -1, 1); a.right = clamp(a.right + this._sv.x, -1, 1);
    }
    return a;
  }

  /** per rendered frame (dt clamped) */
  update(dt) {
    if (this.mode === 'tour') return;
    const app = this.app, cam = app.camera;
    if (app.q.has('shot') && !this.forceActive) return; // the screenshot harness owns the camera
    // something else moved or turned the camera (setView, teleport): adopt that pose
    if (cam.position.distanceToSquared(this._last) > 1e-4 || this._lastQ.angleTo(cam.quaternion) > 1e-4) this.syncFromCamera();
    const groundAt = (x, z) => app.hf.heightAt(x, z);
    stepMove(this.s, this._axesNow(), dt, { mode: this.mode === 'walk' ? 'walk' : 'fly', speed: (this.mode === 'walk' ? 5 : 30) * this.speedMult, groundAt, minHeight: 2.5, eye: 1.7 });
    cam.position.set(this.s.pos[0], this.s.pos[1], this.s.pos[2]);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.s.pitch, -this.s.yaw, 0);
    this._last.copy(cam.position);
    this._lastQ.copy(cam.quaternion);
  }
}
