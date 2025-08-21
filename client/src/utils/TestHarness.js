export class TestHarness {
    constructor(bus, state, sceneMgr, ROI, initialUI) {
        this.bus = bus;
        this.state = state;
        this.sceneMgr = sceneMgr;
        this.ROI = ROI;
        this.initialUI = initialUI;
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
}