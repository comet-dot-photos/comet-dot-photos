// app/CometPhotosApp.js -
//  This object sets up the Comet.Photos app, instantiating
//  the high level objects used by the application, and providing a map
//  to wire UI events to application logic. 

import { SceneManager } from '../core/SceneManager.js';
import { GuiController } from '../ui/GuiController.js';
import { OverlayCanvas } from '../view/OverlayCanvas.js';
import { PaintEvents } from '../ui/PaintEvents.js';
import { FilterEngine } from '../filters/FilterEngine.js';
import { ImageBrowser } from '../core/ImageBrowser.js';
import { Emitter } from '../utils/Emitter.js';
import { ROI } from '../core/ROI.js';
import { Preprocessor} from '../core/Preprocessor.js';
import { SI_NONE } from '../core/constants.js';

const DEFAULT_UI_STATE = {
	enablePaint: false,
	brushSize: 100, // meters
	percentOverlap: 75,
	metersPerPixel: [0, 10],
	emissionAngle: [0, 90],
	incidenceAngle: [0, 90],
	phaseAngle: [0, 180],
	showImage: SI_NONE,
	encircleRegion: true,
	spacecraftView: false,
	showViewport: false,
	showAxes: false,
	imageIndex: 0,
	skipDuration: 'Month',
	matches: 'Loading...',
	fileName: 'None',
	time: 'None',
	imageInfo: 'None Selected',
  flatShading: true       // debug menu option
};


export class CometPhotosApp {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ dataset:any, defaults?:any, makeGui?:(state, onChange)=>void }} options
   */
  constructor(dataset, socket, defaults = {}) {
    this.bus = new Emitter(); // Event bus for cross-component communication
    this.socket = socket;     // Needed for FilterEngine. Really necessary to keep this in the App too?

    // this.bus.on('drawBrush', (...args) => { console.log('[PROBE] drawBrush raw args:', args); });

    this.state = { ...DEFAULT_UI_STATE };
    this.state['dataset'] = dataset;
    this.state['preprocessMode'] = defaults.preprocessMode;
    this.state['debugMode'] = defaults.debugMode;

    this.gui = new GuiController({bus: this.bus, state: this.state,
      initial: { ...DEFAULT_UI_STATE },
    });

    this.ROI = new ROI();

    this.overlay = new OverlayCanvas ({
        bus: this.bus,
        state: this.state,
        ROI: this.ROI
     });

    this.sceneMgr = new SceneManager(this.bus, this.state, this.overlay, {
      fov: dataset?.FOV ?? 45,
      initialEye: dataset?.initialEye ?? [100,100,100]
    });

    this.paintEvents = new PaintEvents({
      bus: this.bus,
      state: this.state,
      canvas: this.sceneMgr.renderer.domElement,
      camera: this.sceneMgr.camera,
      controls: this.sceneMgr.controls,
      overlayNeedsUpdate: () => this.overlay.overlayNeedsUpdate(),
      setHaltCircle: (b) => this.overlay.setHaltCircle(b)
    });

    this.filterEng = new FilterEngine({
      bus: this.bus,
      state: this.state,
      ROI: this.ROI,
      socket: this.socket
    });

    this.imageBrowser = new ImageBrowser({
        bus: this.bus,
        state: this.state,
        ROI: this.ROI,
        overlay: this.overlay,
        sceneMgr: this.sceneMgr,
        filterEng: this.filterEng
    });

    this.sceneMgr.getCometView = () => this.imageBrowser.getCometView(); // allow sceneMgr to access the current CometView

    this.preprocessor = new Preprocessor({    // used rarely - only when preprocessing
      bus: this.bus,
      state: this.state,
      socket: this.socket,
      imageBrowser: this.imageBrowser,
      sceneMgr: this.sceneMgr
    })

// one map to wire all semantic events
    const HANDLERS = {
        'quickstartHelp':   () => window.open("quickstart.html"),
        'enablePaint':      v => this.sceneMgr.enablePaint(v),
        'percentOverlap':   v => this.filterEng.setPercentOverlap(v),
        'brushSize':       v => this.sceneMgr.adjustBrushSize(v),
        'clearPaint':      () => this.imageBrowser.clearPaint(),
        'metersPerPixel':  (v)=> this.filterEng.entryMpPFilter(v),
        'emissionAngle':   (v)=> this.filterEng.entryEmissionFilter(v),
        'incidenceAngle':  (v)=> this.filterEng.entryIncidenceFilter(v),
        'phaseAngle':      (v)=> this.filterEng.entryPhaseFilter(v),
        'showImage':       v => this.imageBrowser.entryShowImage(v),
        'encircleRegion':  v => this.overlay.encircleRegion(v),
        'spacecraftView':  v => this.sceneMgr.spacecraftView(v),
        'showViewport':    v => this.sceneMgr.entryShowViewport(v),
        'showAxes':        v => this.sceneMgr.entryShowAxes(v),
        'imageIndex':      v => this.imageBrowser.loadCometByIndex(v),
        'nextImage':       () => this.imageBrowser.loadNext(),
        'prevImage':       () => this.imageBrowser.loadPrevious(),
        'skipDuration':    v => this.imageBrowser.setSkipDuration(v),
        'skipForward':     () => this.imageBrowser.skipForward(),
        'skipBackward':    () => this.imageBrowser.skipBackward(),
        'fileName':        v => this.imageBrowser.loadCometByFilename(v),
        'downloadFileNames': () => this.imageBrowser.downloadFileNames(),

        'startPaint':      () => this.sceneMgr.startPaint(),
        'drawBrush':       ({x, y, paintBelow, eraseMode}) => this.sceneMgr.drawBrush({x, y, paintBelow, eraseMode}),
        'endPaint':        () => this.onDonePainting(),
        'resetCOR':        () => this.sceneMgr.resetCOR(),
        'CORatMouse':      (pos) => this.sceneMgr.CORAtMouse(pos),
        'startCORani':     () => this.sceneMgr.startCORAnimation(),
        'filter.results':  v => this.imageBrowser.newFilterResults(v),
        // Debug menu
        'flatShading':     v => this.sceneMgr.entrySetFlatShading(v),
        'memStats':        () => this.sceneMgr.memStats(),
        'startLog':        () => this.bus.startLog(),
        'endLog':          () => this.saveLog(),
        'runLog':          () => this.runLog(),
        'paintVisible':    () => this.preprocessor.computeVisibleVertices(),
        'preprocess':      () => this.preprocessor.beginPreprocessing()
    };

    // wire up the handlers 
    this.#bindHandlers(HANDLERS);

    // Kick off the loop
    this.sceneMgr.renderLoop();

    this.loadLogHandler();  // Handle loading of logs if requested
  }

  // ---- Public API ----

  installMetadata(metadata) {  // share the metadata only with the modules that need it
        this.filterEng.installMetadata(metadata);
        this.imageBrowser.installMetadata(metadata);
        this.state.metadataLoaded = true;
        this.filterEng.updateAllFilters();
  }

  dispose() {   // dispose of event bindingers
    for (const [evt, fn] of (this._bound ?? [])) this.bus.off(evt, fn);
  }

  /*
  saveLog () {
    const log = this.bus.endLog();
    if (log && log.length > 0) {
		    this.socket.emit('clientRequestsLogSave', log);
		    alert(`Your log file has been saved.`);
    }
	}
    */
  saveLog () {
    const log = this.bus.endLog();
    if (log && log.length > 0) {
      const json = JSON.stringify(log);
      const sizeBytes = new TextEncoder().encode(json).length; // UTF-8 size
      console.log(`Log size: ${sizeBytes} bytes (~${(sizeBytes/1024).toFixed(1)} KB)`);

      this.socket.emit('clientRequestsLogSave', log, (resp) => {
        if (resp?.ok) {
          alert(`Saved log (${(sizeBytes/1024).toFixed(1)} KB)`);
        } else {
          alert(`Log save failed: ${resp?.error ?? 'unknown error'}`);
        }
      });
    }
  } 

  runLog () {
    this.socket.emit('clientRequestsLogLoad');
  }

  loadLogHandler() {
    this.socket.on ('serverProvidesLogLoad', (message) => {
        if (message && Array.isArray(message)) {
            console.log(`Loading a log with ${message.length} entries`);
            // Here we could do more validation of the log entries if desired
            for (const entry of message) {
                console.log(`Replaying log event: ${entry.event} with args:`, entry.args);
                this.bus.emit(entry.event, ...entry.args);
            }
        } 
    });
	}

  onDonePainting () { // too many lines - keep the handler defs clean
    this.sceneMgr.endPaint();
    this.ROI.setFromPaint(this.sceneMgr.cometGeometry);
    this.filterEng.applyGeoFilter(true);
  }

  // ---- Internals ----

  #bindHandlers(map) {
    this._bound = [];  // keep a list of event handlers in case choose to 'dispose' later

    for (const [evt, fn] of Object.entries(map)) {
      //console.debug(`#bindHandlers: Binding event: ${evt}`);
      const wrapped = (...args) => fn(...args);
      this.bus.on(evt, wrapped);
      this._bound.push([evt, wrapped]);
    }
  }

}
