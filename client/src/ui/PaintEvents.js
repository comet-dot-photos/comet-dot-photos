// ui/PaintEvents.js - This object triggers application level events from
//  mouse and touch events in the canvas containing the 3D Model. These
//  events are consumed by handlers wired up in CometPhotosApp.

import * as THREE from 'three';
import { BR_MIN, BR_MAX } from '../core/constants.js';

export class PaintEvents {
  constructor({ bus, state, canvas, camera, controls, overlayNeedsUpdate, setHaltCircle}) {
    this.bus = bus;
    this.state = state;
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.overlayNeedsUpdate = overlayNeedsUpdate;
    this.setHaltCircle = setHaltCircle;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.isPainting = false;
    this.pointerDown = false;
    this.CORMode = false;

    // DOM listeners
    canvas.addEventListener('pointermove', this.#onMove);
    canvas.addEventListener('pointerdown', this.#onDown, true);
    canvas.addEventListener('pointerup',   this.#onUp, true);
    // canvas.addEventListener('pointerleave',this.#onUp);
    canvas.addEventListener('wheel', this.#onWheel, { passive: true });
    canvas.addEventListener('dblclick', this.#onDblClick);
    window.addEventListener('keydown', this.#onKeyDown, { capture: true }); // try to avoid focus issues
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault();}); // disable context menu
  }


  #onMove = (e) => {
      let x = (e.clientX / window.innerWidth) * 2 - 1;
      let y = - (e.clientY / window.innerHeight) * 2 + 1;
      if (this.state['enablePaint']) {
          this.bus.emit('drawBrush', {x: x, y: y, paintBelow: this.pointerDown, eraseMode: this.pendingErase}); // start painting
      } else if (this.CORMode) {
          this.bus.emit('CORatMouse', {x: x, y: y});
      }
  };

  #onDown = (e) => {
    this.setHaltCircle(true);     // halting for all down ops
    this.overlayNeedsUpdate();  // so circle is erased
    this.pointerDown = true;
    let x = (e.clientX / window.innerWidth) * 2 - 1;
    let y = - (e.clientY / window.innerHeight) * 2 + 1;

    if (this.state['enablePaint']) {
      this.bus.emit('startPaint'); // start painting
      this.pendingErase = (e.button == 2); // save this info for #onMove
      this.bus.emit('drawBrush', {x: x, y: y, paintBelow: true, eraseMode: this.pendingErase}); // paint
    } else if (e.button == 2 && !e.shiftKey) { 	// COR Mode: non-paint and right mouse and no shiftkey
      this.controls.enabled = false;
      this.CORMode = true;
      this.bus.emit('CORatMouse', {x: x, y: y});
    }		// Panning: non-paint and right mouse and shiftkey: nothing else needed
  };


  #onUp = (e) => {
    this.setHaltCircle(false);
    this.overlayNeedsUpdate();    // so the circle gets drawn
    this.pointerDown = false;
    if (this.state['enablePaint']) {
        if (e.pointerType === 'touch') // disable the brush visualization only on a touch device
            this.bus.emit('hideBrush');
        this.bus.emit('endPaint'); // end painting
    } else if (this.CORMode) {
        let x = (e.clientX / window.innerWidth) * 2 - 1;
        let y = - (e.clientY / window.innerHeight) * 2 + 1;
        this.controls.enabled = true;
        this.CORMode = false;
        this.bus.emit('startCORani'); // time to animate to new COR
    }
  };

  #onWheel = (e) => {
    if (!this.state['enablePaint']) {
      this.overlayNeedsUpdate();      // need to update red circe
      return
    } ; // wheel only adjusts brush size in paint mode
    const delta = Math.sign(e.deltaY) * 7; // adjust in increments of 7m. Slider allows for 1m precision
    const newSize = Math.max(BR_MIN, Math.min(BR_MAX, this.state.brushSize - delta));

    if (newSize !== this.state.brushSize) {
      this.bus.emit('setVal', {key: 'brushSize', val: newSize, silent: false}); // have the slider generate the event
    }
  };

  #onDblClick = (e) => {
    if (e.button === 0) {  // Left button double-click
      this.bus.emit('resetCOR'); // reset center of rotation
    }
  }

  #onKeyDown = (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
      e.preventDefault();  // stop propagating so not handled by browser
      this.bus.emit('toggleDebugMenu');
    }
  }

  dispose() {
    this.canvas.removeEventListener('pointermove', this.#onMove);
    this.canvas.removeEventListener('pointerdown', this.#onDown);
    this.canvas.removeEventListener('pointerup',   this.#onUp);
    this.canvas.removeEventListener('pointerleave',this.#onUp);
    this.canvas.removeEventListener('wheel',       this.#onWheel);
  }
}
