import {COMETGREYVAL, PAINT_RED, PAINT_GREEN, PAINT_BLUE} from '../core/constants.js'


export class TestHarness {
    constructor({bus, state, socket, imageBrowser, sceneMgr, ROI, uiState}) {
        this.bus = bus;
        this.state = state;
        this.socket = socket;
        this.imageBrowser = imageBrowser;
        this.sceneMgr = sceneMgr;
        this.ROI = ROI;
        delete uiState.status; // don't clear the status field on log replay
        this.uiState = uiState;

        this.loadControlsHandler();
        this.installCheck = this.installCheck.bind(this);
        this.bus.on('logResult', this.installCheck);
    }

    loadControlsHandler() {
        const controls = this.sceneMgr.controls;
        controls.addEventListener('end', () => {
            if (this.bus.logging())
                this.logCameraState();
        });
    }

    startLog() {
        this.bus.startLog();
        this.logAllState();     // set starting conditions!
        this.statusMessage('Logging in progress...')
    }

    statusMessage(m) {
        this.bus.emit('setVal', {key: 'status', val: m, silent: true})
    }

    // stopRecording is effectively done with saveLog

    logAllState() {    
        this.logCameraState();
        this.logPaintState();
        this.logStateVars(); 
    }

    installCheck() {
        if (!this.bus.logging()) return;  // only when logging
        const result = {}, dynamicArray = this.imageBrowser.dynamicArray;
        result.count = dynamicArray.length;
        result.samples = {};
        // for now, save the first, last, and a random match
        if (result.count >= 1)   // save first
            result.samples[0] = dynamicArray[0].nm;
        if (result.count >= 2)   // save last
            result.samples[result.count-1] = dynamicArray[result.count-1].nm;
        if (result.count > 2) { // capture a random additional interior index
            const randIndex = Math.floor(1 + Math.random()*(result.count-2));
            result.samples[randIndex] = dynamicArray[randIndex].nm;
        }
        this.bus.logOnly('checkResult', result);
    }

    checkResult(result) {
        const dynamicArray = this.imageBrowser.dynamicArray;
        if (result.count != dynamicArray.length) {
            // need to paint this on the screen too!
            console.error(`Inconsistent result: result.count = ${result.count}, but # current matches is ${dynamicArray.length}`);
            throw new Error("TestHarness: Incorrect result count");
        }
        for (const [key, val] of Object.entries(result.samples)) {
            if (val != dynamicArray[key].nm) {
                // need to paint this on the screen too!
                console.error(`Mismatch of image in result set at position ${key}, expecting val ${val}.`);
                throw new Error("TestHarness: Image mistmatch");
            }
        }
        console.log('CHECKRESULT: PASSED A TEST.');
    }

    /* Functions for getting and setting state - helpers for TestHarnass */
    logCameraState() {
        const camera = this.sceneMgr.camera, controls = this.sceneMgr.controls;
        const camState = {
            near: camera.near,
            far: camera.far,            // never changed aspect or fov after init
            position: camera.position.toArray(),
            quaternion: camera.quaternion.toArray(),
            up: camera.up.toArray(),
            target: controls.target.toArray()
        };
        this.bus.logOnly('setCam', camState);
    }

    setCameraState(state) {
        const camera = this.sceneMgr.camera, controls = this.sceneMgr.controls;

        camera.near = state.near;
        camera.far = state.far;

        camera.position.fromArray(state.position);
        camera.quaternion.fromArray(state.quaternion);
        camera.up.fromArray(state.up);
        camera.updateProjectionMatrix();

        controls.target.fromArray(state.target);
        controls.update();
    }

    logPaintState() {
        if (!this.bus.logging()) return;
        const vertArray = [], cometGeometry = this.sceneMgr.cometGeometry;
        for (let i = 0; i < cometGeometry.attributes.color.array.length; i+=3) {
            if (cometGeometry.attributes.color.array[i] == PAINT_RED) {
                vertArray.push(i/3);
            }
        }
        this.bus.logOnly('setPainted', vertArray);
    }

    async setPaintState(vertArray) {
        const colorArray = this.sceneMgr.colorArray, colorAttr = this.sceneMgr.colorAttr;
        colorArray.fill(COMETGREYVAL);  // erase initially
        for (const index of vertArray) {
            const pos = 3*index;
            colorArray[pos] = PAINT_RED;
            colorArray[pos+1] = PAINT_GREEN;
            colorArray[pos+2] = PAINT_BLUE;
        }
        colorAttr.needsUpdate = true;

        await this.bus.emitAsync('endPaint');  // Just as though we painted by hand!
    }

    logStateVars() {
        let stateVars = {};  // dictionary for the new state
        // iterate over keys in initial UI, and store current values
        for (const [key, value] of Object.entries(this.uiState)) {
            stateVars[key] = this.state[key];
        }
        this.bus.logOnly('setStateVars', stateVars);
    }

    setStateVars(stateVars) {  // set the state varsand do their callbacks
        for (const [key, value] of Object.entries(stateVars)) {
            this.bus.emit('setVal', {key: key, val: value, silent: false})
        }
    }

    saveLog () {
        const log = this.bus.endLog();
        // this.bus.off('results.ready', this.installCheck);
        if (log && log.length > 0) {
            const json = JSON.stringify(log);
            const sizeBytes = new TextEncoder().encode(json).length; // UTF-8 size
            console.log(`SaveLog - size: ${sizeBytes} bytes: (~${(sizeBytes/1024).toFixed(1)} KB)`);

            this.socket.emit('clientRequestsLogSave', log, v => {
                if (v) this.statusMessage('Log file saved.');
                else this.statusMessage('Failed to save log file.');
            });
        }
  } 

    async runLog(timed) {
        this.statusMessage('Running the log...')
        const req = (ev, data) => new Promise(res => this.socket.emit(ev, data, res));
        const log = await req('clientRequestsLogLoad');
        await this.executeLogEvents(log, timed);
    }

    // Helper: wait until an absolute performance.now() time
    waitUntil(targetNowMs) {
        const delay = targetNowMs - performance.now();
        if (delay <= 0) return Promise.resolve();
        return new Promise(res => setTimeout(res, delay));
    }

    async executeLogEvents(log, timed = false) {
        if (!Array.isArray(log) || log.length === 0) return;

        // Establish timing baselines only if we're honoring recorded timings
        let t0Log = 0, t0Play = 0;
        if (timed) {
            t0Log = log[0].timestamp ?? 0;   // recorded start (entries guaranteed sorted)
            t0Play = performance.now();     // playback start
        }

        console.log(`Loading a log with ${log.length} entries`);

        for (const entry of log) {
            if (timed && typeof entry.timestamp === 'number') {
                const target = t0Play + (entry.timestamp - t0Log);
                await this.waitUntil(target); // ensures "no faster than recorded"
            }

            console.log(`Replaying log event: ${entry.event} with args:`, entry.args);
            this.statusMessage(`Executing: ${entry.event}.`);
            // Trigger the event, but wait for it to return
            await this.bus.emitAsync(entry.event, ...(entry.args ?? []));
        }
        this.statusMessage('Log executed successfully.');
    }
}