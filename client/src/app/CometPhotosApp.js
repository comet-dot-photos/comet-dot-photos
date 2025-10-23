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
import { Preprocessor } from '../core/Preprocessor.js';
import { TestHarness } from '../utils/TestHarness.js';
import { loadCometModel, loadMetadata } from '../core/datasetLoader.js';
import { mergeK } from '../utils/mergeK.js';
import { SI_NONE, SD_MONTH, LL_REGRESSION } from '../core/constants.js';

const DEFAULT_UI_STATE = {
	datasets: [],
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
	skipDuration: SD_MONTH,
	matches: 'Loading...',
	fileName: 'None',
	time: 'None',
	imageInfo: 'None Selected',
  status: '',
  logLevel: LL_REGRESSION,
  flatShading: true,       // debug menu option
};


export class CometPhotosApp {
  constructor(dsArray, socket, defaults = {}) {
    this.bus = new Emitter(); // Event bus for cross-component communication
    this.dsArray = dsArray;   // array of dataset descriptors
    this.socket = socket;     // To be shared with modules that interact with server

    this.state = { ...DEFAULT_UI_STATE };
    this.state['preprocessMode'] = defaults.preprocessMode;
    this.state['debugMode'] = defaults.debugMode;
    this.state['isLocal'] = defaults.isLocal;
    this.state['runTest'] = defaults.runTest;

    this.gui = new GuiController({bus: this.bus, state: this.state,
      initial: { ...DEFAULT_UI_STATE },
    });

    this.ROI = new ROI();

    this.overlay = new OverlayCanvas ({
        bus: this.bus,
        state: this.state,
        ROI: this.ROI
     });

    this.sceneMgr = new SceneManager(this.bus, this.state, this.overlay, this.dsArray[0]);

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
      socket: this.socket,
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

    this.testHarness = new TestHarness ({
      bus: this.bus,
      state: this.state,
      socket: this.socket,
      imageBrowser: this.imageBrowser,
      sceneMgr: this.sceneMgr,
      ROI: this.ROI,
      uiState: DEFAULT_UI_STATE
    })

    const dsNames = this.dsArray.map(x => x.shortName);
    this.bus.emit('setSelectOpts', {key: 'datasets', opts: dsNames, val: dsNames, silent: true});

    this.loadDatasets(dsNames); // Load the comet model and metadata!

    if (this.dsArray.length == 1)
      this.bus.emit('setEnabled', {key: 'datasets', enabled: false});  // disable if only one choice!

    if (defaults.preprocessMode) this.bus.emit('preprocessMode');

// one map to wire all semantic events
    const HANDLERS = {
        'quickstartHelp':  () => window.open("quickstart.html"),
        'datasets':        v => this.loadDatasets(v),
        'enablePaint':     v => this.sceneMgr.enablePaint(v),
        'percentOverlap':  v => this.filterEng.setPercentOverlap(v),
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
        'CORatMouse':      v => this.sceneMgr.CORAtMouse(v),
        'startCORani':     () => this.sceneMgr.startCORAnimation(),
        'filter.results':  v => this.imageBrowser.newFilterResults(v),
        // Debug menu
        'flatShading':     v => this.sceneMgr.entrySetFlatShading(v),
        'memStats':        () => this.sceneMgr.memStats(),
        'logLevel':        v => this.testHarness.setLogLevel(v),
        'startLog':        () => this.testHarness.startLog(),
        'endLog':          () => this.testHarness.saveLog(),
        'runLogFastest':   () => this.testHarness.runLog(false, false),
        'runLogFast':      () => this.testHarness.runLog(false, true),
        'runLogTimed':     () => this.testHarness.runLog(true, false),
        'paintVisible':    () => this.preprocessor.computeVisibleVertices(),
        'preprocess':      () => this.preprocessor.beginPreprocessing(),

        // For testing
        'setCam':          v => this.testHarness.setCameraState(v),
        'setPainted':      v => this.testHarness.setPaintState(v),
        'setStateVars':    v => this.testHarness.setStateVars(v),
        'setAppState':     v => this.testHarness.setAppState(v),
        'checkResult':     v => this.testHarness.checkResult(v),
        'loadComplete':    () => this.testHarness.onLoadComplete(),
    };

    // wire up the handlers 
    this.#bindHandlers(HANDLERS);

    // Kick off the loop
    this.sceneMgr.renderLoop();
  }

  // ---- Public API ----

  // nameArray is an array of dataset shortNames
  async loadDatasets(nameArray) {
    this.state.datasets = nameArray;
    this.bus.emit('setVal', {key: 'datasets', val: this.state.datasets, silent: true});

    // create a dictionary of selected datasets keyed by shortname
    this.dsDict = Object.fromEntries(
      this.dsArray
        .filter(d => nameArray.includes(d.shortName))
        .map(d => [d.shortName, d]));

    this.imageBrowser.resetForNewDataset();

    // Start model and metadata loads immediately / concurrently
    const modelPromise = loadCometModel(this.sceneMgr, this.ROI, this.dsArray[0]);

    const metaPromises = Object.values(this.dsDict)
      .filter(d => !d.photoData) // skip if already loaded
      .map(async (dataset) => {
        const data = await loadMetadata(dataset);
        data.forEach(e => (e.dataset = dataset)); // cache dataset ref in each photo entry
        dataset.photoData = data;
      });

    // Phase 1: metadata ready ⇒ install once
    await Promise.all(metaPromises);
    this.installMetadata();

    // Phase 2: everything ready ⇒ signal 'ready'
    await modelPromise;
    this.bus.emit('loadComplete');
  }


  installMetadata() {  // finalize metadata and share with only with the modules that need it
      const allHavePhotoData = Object.values(this.dsDict).every(d => d.photoData);
      if (!allHavePhotoData) throw new Error('installMetadata called before all metadata loaded');

      // Merge all photoDatas into one big sorted array
      const metadata = mergeK(Object.values(this.dsDict).map(d => d.photoData), {key: "ti"});
      const dsString = this.state.datasets.join(' + ');
      document.title = `Comet.Photos: ${dsString} (${metadata.length}) images`;

      this.filterEng.installDatasetsAndMetadata(this.dsDict, metadata);
      this.imageBrowser.installMetadata(metadata);
      this.state.metadataLoaded = true;
      this.filterEng.updateAllFilters();
  }

  dispose() {   // dispose of event bindingers
    for (const [evt, fn] of (this._bound ?? [])) this.bus.off(evt, fn);
  }

  async onDonePainting() {
    this.sceneMgr.endPaint();
    this.ROI.setFromPaint(this.sceneMgr.cometGeometry);
    if (this.bus.logging()) this.testHarness.logPaintState(true);
    await this.filterEng.updateAllFilters();     // ← wait for async path
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
