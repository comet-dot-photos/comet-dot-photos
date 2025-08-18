// ui/GuiController.js
//   This object abstracts the control panel, and keeps it separate from the application
//   logic. It communicates with the application logic by triggering events on a bus,
//   that are handled by functions bound to these events in CometPhotosApp.
//   This controller uses buildGuiFromSchema to populate the control panel, keeping
//   the details related to the actual widgets used, and events emitted, hidden from 
//   this object.

import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { buildGuiFromSchema } from './buildGuiFromSchema.js';
import { cometPhotosSchema } from './schema.cometPhotos.js'

export class GuiController {

  constructor({bus, initial}) {
    this.bus = bus;
    this.state = structuredClone(initial);

    this.gui = new GUI();
    const { ctrls, folders, set, setLimits } = buildGuiFromSchema(this.gui, cometPhotosSchema, {
        state: this.state,    // a clone of the DEFAULT_UI
        bus: this.bus,
    } );

    this.cpanel = ctrls;
    this.folders = folders
    this.set = set;
    this.setLimits = setLimits;   
    this.bus.on('setVal', (v) => this.set(v));
    this.bus.on('setLimits', (v) => this.setLimits(v));
    this.bus.on('setLabel', ({key, label}) => { if (this.cpanel[key]?.name) this.cpanel[key].name(label); });
    this.bus.on('setEnabled', ({key, enabled}) => {
        const ctrl = this.cpanel[key];
        if (ctrl) {
            if (enabled && ctrl.enable) ctrl.enable();
            else if (!enabled && ctrl.disable) ctrl.disable();
        }
    });
    this.debugDisplayed = false;
    this.bus.on('toggleDebugMenu', () => {
        this.debugDisplayed ? this.folders['debugOptions']?.hide() : this.folders['debugOptions']?.show();
        this.debugDisplayed = !this.debugDisplayed;
    });
  }

  on(topic, handler){ this.bus.on(topic, handler); }
}
