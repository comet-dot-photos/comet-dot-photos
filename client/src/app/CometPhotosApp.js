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
  mission: '',
	instruments: [],
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
    this.dsArray = dsArray;   // array of mission dataset descriptors
    this.socket = socket;     // To be shared with modules that interact with server

    this.state = { ...DEFAULT_UI_STATE };
    this.state['preprocessMode'] = defaults.preprocessMode;
    this.state['debugMode'] = defaults.debugMode;
    this.state['isLocal'] = defaults.isLocal;
    this.state['runTest'] = defaults.runTest;
    this.state['origin'] = "";

    this.gui = new GuiController({bus: this.bus, state: this.state,
      initial: { ...DEFAULT_UI_STATE },
    });

    this.ROI = new ROI();

    this.overlay = new OverlayCanvas ({
        bus: this.bus,
        state: this.state,
        ROI: this.ROI
     });

    this.sceneMgr = new SceneManager(this.bus, this.state, this.overlay);

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
      sceneMgr: this.sceneMgr,
      dsArray: this.dsArray
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

    const missionNames = this.dsArray.map(x => x.mission);
    this.bus.emit('setSelectOpts', {key: 'mission', opts: missionNames, val: missionNames[0], silent: true});
    
    this.loadMission(missionNames[0]); // Load the first mission by default (and all of its instruments)

    if (missionNames.length == 1)
      this.bus.emit('setEnabled', {key: 'mission', enabled: false});  // disable if only one choice!

    if (defaults.preprocessMode) this.bus.emit('preprocessMode');

    // one map to wire all semantic events
    const HANDLERS = {
        'quickstartHelp':  () => window.open("quickstart.html"),
        'mission':         v => this.loadMission(v),
        'instruments':     v => this.loadInstruments(v),
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
  async loadMission(missionName) {
    if (missionName == this.state.mission) return; 
    this.state.metadataLoaded = false;     // will need to load new metadata 

    if (this._previouslyLoaded)            // reset ui defaults on new mission load, if not 1st load
      this.restoreNewMissionDefaults();
    this._previouslyLoaded = true;      

    const missionDict = this.dsArray.find(o => o.mission === missionName);
    if (!missionDict) throw new Error(`loadMission: unknown mission: ${missionName}`);

    this.state.mission = missionName;
    this.bus.emit('setVal', {key: 'mission', val: this.state.mission, silent: true});
 
    const inNames = missionDict.instruments.map(x => x.shortName);
    this.bus.emit('setSelectOpts', {key: 'instruments', opts: inNames, val: inNames, silent: true});
    this.bus.emit('setEnabled', {key: 'instruments', enabled: (inNames.length > 1)});  // enabled iff more than one choice!

    const modelPromise = loadCometModel(this.sceneMgr, this.ROI, missionDict);
    const instrumentsPromise = this.loadInstruments(inNames, false);
    await Promise.all([modelPromise, instrumentsPromise]);   // … wait for BOTH to complete

    this.filterEng.updateAllFilters();  // initial filter update - do after model+metadata loaded

    document.title = `Comet.Photos: ${missionDict.mission}`; // add mission to window title

    // Everything ready ⇒ start up install cdn and signal 'ready'
    this.#installCDN();  // do this after everything is loaded
    this.bus.emit('loadComplete');
  }

  // restores new mission defaults for the control panel - only needs to be called when
  //   another mission had previously been loaded.
  restoreNewMissionDefaults() {
    for (const [key, value] of Object.entries(DEFAULT_UI_STATE)) {
      this.state[key] = value;
      this.bus.emit('setVal', {key: key, val: value, silent: true});
    }
    this.imageBrowser.enableOverlayCanvas(false);             // silent does not call this
    this.sceneMgr.enablePaint(DEFAULT_UI_STATE.enablePaint);  // silent does not call this
  }

  // nameArray is an array of instrument shortNames from the currently selected mission
  async loadInstruments(nameArray, entryPoint = true) {
      this.state.instruments = nameArray;
      this.bus.emit('setVal', {key: 'instruments', val: this.state.instruments, silent: true});

    const missionDict = this.dsArray.find(o => o.mission === this.state.mission);

    // create a dictionary of selected datasets keyed by tableIndex
    this.inDict = Object.fromEntries(
      missionDict.instruments
        .filter(d => nameArray.includes(d.shortName))  // only include instruments in nameArray
        .map(d => [d.tableIndex, d]));

    // Explicitly add missionFolder to each instrument dataset
    Object.values(this.inDict).forEach(d => {
      d.missionFolder = missionDict.missionFolder;
    });

    this.imageBrowser.resetForNewDataset();

    const metaPromises = Object.values(this.inDict)
      .filter(d => !d.photoData) // skip if already loaded
      .map(async (dataset) => {
        const data = await loadMetadata(dataset);
        data.forEach(e => (e.dataset = dataset)); // cache dataset ref in each photo entry
        dataset.photoData = data;
      });

    // Metadata ready ⇒ install once
    await Promise.all(metaPromises);
    this.installMetadata();

    // if just an instrument change, not a mission change, update filters here rather than in loadMission
    if (entryPoint) this.filterEng.updateAllFilters();
  }


  installMetadata() {  // finalize metadata and share with only with the modules that need it
      const allHavePhotoData = Object.values(this.inDict).every(d => d.photoData);
      if (!allHavePhotoData) throw new Error('installMetadata called before all metadata loaded');

      // Merge all photoDatas into one big sorted array
      const metadata = mergeK(Object.values(this.inDict).map(d => d.photoData), {key: "ti"});;
      this.filterEng.installDatasetsAndMetadata(this.inDict, metadata);
      this.imageBrowser.installMetadata(metadata);
      this.state.metadataLoaded = true;
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

  async #installCDN() {
    if (window.location.hostname === 'comet.photos') {  // only look for a cdn if they connect to the main site
        const hosts = ["nj1.comet.photos", "nj2.comet.photos", "sea1.comet.photos", "la1.comet.photos"];
        const t0 = performance.now();
        const ctrls = hosts.map(() => new AbortController());
        const imgPath = "cometIcon.png?v=" + Date.now();  // add a cache busting param

        let winner;
        try {
          winner = await Promise.any(
            hosts.map((h, i) =>
              fetch(`https://${h}/${imgPath}`, { signal: ctrls[i].signal, cache: "no-store" })
                .then(r => r.ok ? r.blob() : Promise.reject())
                .then(() => i)
            )
          );
        } catch (err) {
          console.log("No CDN hosts responded", err);
          return;
        }

        ctrls.forEach((c, i) => i !== winner && c.abort());
        console.log(`Winner: ${hosts[winner]} in ${(performance.now()-t0).toFixed(1)}ms`);
        this.state.origin = `https://${hosts[winner]}/`;
    }
  }

}
