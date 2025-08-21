import {COMETGREYVAL, PAINT_RED, PAINT_GREEN, PAINT_BLUE} from '../core/constants.js'


export class TestHarness {
    constructor({bus, state, socket, sceneMgr, ROI, initialUI}) {
        this.bus = bus;
        this.state = state;
        this.socket = socket;
        this.sceneMgr = sceneMgr;
        this.ROI = ROI;
        this.initialUI = initialUI;

        this.loadLogHandler();
        this.loadControlsHandler();
    }

    loadControlsHandler() {
        const controls = this.sceneMgr.controls;
        controls.addEventListener('end', () => {
            if (this.bus.logging())
                this.logCameraState();
        });
    }

    startRecording() {
        const afterEvent = ['percentOverlap', 'metersPerPixel','emissionAngle', 'incidenceAngle', 'phaseAngle', 'endPaint'];
        const recordThese = DEFAULT_UI + 'endPaint' + 'endControls';
        this.bus.recordAfter({afterEvent, recordThese});
        this.logAppState();     // set starting conditions!
    }

    stopRecording() {
        // set bus back to normal state, and save log
    }

    logPaintState() {
        const painted = this.sceneMgr.getPaintedVertices();
        this.bus.logOnly('setPaintState', painted);
    }

    logCameraState() {
        const cam = this.sceneMgr.getCameraState();
        this.bus.logOnly('setCameraState', cam);
    }

    logStateVars() {
        let stateVars = {};  // dictionary for the new state
        // iterate over keys in initial UI, and store current values
        for (const [key, value] of Object.entries(this.initialUI)) {
            stateVars[key] = this.state[key];
        }
    }

    logAppState() {
        const cam = this.sceneMgr.getCameraState();
        const painted = this.sceneMgr.getPaintedVertices();
        let stateVars = {};  // dictionary for the new state
        // iterate over keys in initial UI, and store current values
        for (const [key, value] of Object.entries(this.initialUI)) {
            stateVars[key] = this.state[key];
        }
        this.bus.logOnly('setAppState', {cam, painted, stateVars})
    }

    setAppState(state) {
        this.sceneMgr.setCameraState(state.cam);
        this.sceneMgr.setPaintedVertices(state.painted, this.sceneMgr.colorArray, this.sceneMgr.colorAttr);
        this.bus.emit('endPaint');  // trigger ROI update and  filtering - do not need startPaint
        for (const [key, value] of Object.entries(state.stateVars)) {
            // fine to execute these in order. Could also alternately just send the events directly
            this.bus.emit('setVal', {key: key, val: value, silent: false});
        }
    }

    saveResult(ogPhotoArray) {
        let result = {};
        result.count = ogPhotoArray.length;
        // for now, save the first, last, and a random match
        result.vals = {}
        if (result.count >= 1) 
            result.samples[0] = ogPhotoArray[0].nm;
        if (result.count > 1)
            result.samples[result.count-1] = ogPhotoArray[result.count-1].nm;
        if (result.count > 2) { // capture a random additional interior index
            const randIndex = 1 + Math.random()*result.count-2;
            result.samples[randIndex] = ogPhotoArray[randIndex.nm];
        }
        this.bus.logOnly('checkResult', result);
    }

    checkResult(result) {
        if (result.count != ogPhotoArray.length) {
            // need to paint this on the screen too!
            console.error(`Inconsistent result: result.count = ${result.count}, but # current matches is ${ogPhotoArray.length}`);
            throw new Error("TestHarness: Incorrect result count");
        }
        for (const [key, val] of Object.entries(result.samples)) {
            if (val != ogPhotoArray[key].nm) {
                // need to paint this on the screen too!
                console.error(`Mismatch of image in result set at position ${key}, expecting val ${val}.`);
                throw new Error("TestHarness: Image mistmatch");
            }
        }
        
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

    logPaintedState() {
        const vertArray = [], cometGeometry = this.sceneMgr.cometGeometry;
        for (let i = 0; i < cometGeometry.attributes.color.array.length; i+=3) {
            if (cometGeometry.attributes.color.array[i] == PAINT_RED) {
                vertArray.push(i/3);
            }
        }
        this.bus.logOnly('setPainted', vertArray);
    }

    setPaintedState(vertArray) {
        const colorArray = this.sceneMgr.colorArray, colorAttr = this.sceneMgr.colorAttr;
        colorArray.fill(COMETGREYVAL);  // erase initially
        for (const index of vertArray) {
            const pos = 3*index;
            colorArray[pos] = PAINT_RED;
            colorArray[pos+1] = PAINT_GREEN;
            colorArray[pos+2] = PAINT_BLUE;
        }
        colorAttr.needsUpdate = true;

        this.bus.emit('endPaint');  // Just as though we painted by hand!
    }

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

    runLog() {
        this.socket.emit('clientRequestsLogLoad');
    }

    loadLogHandler() {
        this.socket.on('serverProvidesLogLoad', async (message) => {
            if (!Array.isArray(message)) return;
            console.log(`Loading a log with ${message.length} entries`);
            for (const entry of message) {
                console.log(`Replaying log event: ${entry.event} with args:`, entry.args);

                // Arm waiter BEFORE triggering the pipeline, but only for events that
                // will result in a 'vis.applied' later.
                let wait = null;
                if (entry.event === 'setPainted') {
                    wait = this.waitForVisApplied({ timeoutMs: 30_000 });
                }

                // Trigger the event
                this.bus.emit(entry.event, ...(entry.args ?? []));

                // Block until visibility has been applied (if applicable)
                if (wait) {
                    try {
                        await wait; // yields to event loop; other socket/bus events keep flowing
                        console.error('vis.applied received');
                    } catch (e) {
                        console.warn('vis.applied timed out for setPainted', e);
                        return;
                    }
                }
            }
        });
    }

    waitForVisApplied({ timeoutMs = 10_000 } = {}) {
        return new Promise((resolve, reject) => {
            const onDone = () => { cleanup(); resolve(); };

            // register one-shot and keep unsubscribe
            const unsubscribe = this.bus.once('vis.applied', onDone);

            const cleanup = () => { clearTimeout(timer); unsubscribe?.(); };

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('vis.applied timeout'));
            }, timeoutMs);
        });
    }

}