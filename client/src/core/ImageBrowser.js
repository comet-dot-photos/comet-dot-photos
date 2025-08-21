import {CometView} from '../view/CometView.js';
import {SI_NONE, SI_UNMAPPED, SI_PERSPECTIVE, SI_ORTHOGRAPHIC} from './constants.js';

export class ImageBrowser {
    constructor({bus, state, ROI, overlay, sceneMgr, filterEng}) {
        this.bus = bus;
        this.state = state;
        this.ROI = ROI;  // in one case the browser display is different if no ROI is selected
        this.overlay = overlay;
        this.enableOverlayCanvas = overlay.enableOverlayCanvas.bind(overlay);
        this.sceneMgr = sceneMgr;
        this.filterEng = filterEng;
        this.cometView = null;
        this.results = [];
        this.currentIndex = 0;
        this.lastSI = SI_NONE;     // keep track of last Show Image mode to properly undo it when changing modes
            // Time constants
        this.milliseconds = {'Day': 86400000, 'Month': 2628000000, 'Year': 31536000000};
    }

    overlayNeedsUpdate() {
        this.sceneMgr.overlay.overlayNeedsUpdate();
    }

    updateCPanel(key, val) {
        this.state[key] = val;
        this.bus.emit('setVal', {key: key, val: val, silent: true});
    }

    newFilterResults(results) {
        this.dynamicArray = results;

        this.updateCPanel('matches', `${this.dynamicArray.length} / ${this.ogPhotoArray.length} matches`);

        // update the indexSlider max value
        this.bus.emit('setLimits', { key: 'imageIndex', max: Math.max(0, this.dynamicArray.length - 1) });

        if (this.cometView) {
            const newIndex = this.dynamicArray.findIndex(info => info === this.ogPhotoArray[this.cometView.ogIndex]);
            this.currentIndex = newIndex >= 0 ? newIndex : 0;
        } else this.currentIndex = 0;

        if (this.dynamicArray.length > 0) { 
            this.loadComet(this.dynamicArray[this.currentIndex]);
            this.enableImageNavigation(true);
        } else {
            this.unloadComet();	// No image matches, so have to explicitly unload current cometView. Don't do this otherwise because images will flicker.
            this.enableImageNavigation(false);
        }
        this.updateCPanel('imageIndex', this.currentIndex);
    }

    installMetadata(metadata) {
        this.ogPhotoArray = metadata; 
    }

    loadComet(photoDict) {
        let cometView = this.getCometView();
        if (cometView) {
            if (cometView.ogIndex === photoDict.ogIndex) return;		// trying to load what is already loaded
            cometView.removeSelf();		// remove the old one
        }
        cometView = this.cometView = new CometView(photoDict, this.sceneMgr);

        if (this.state['showViewport'])
            cometView.addViewport();
        if (this.state['showImage'] == SI_ORTHOGRAPHIC)
            cometView.addDecal();
        if (this.state['showImage'] == SI_PERSPECTIVE)
            cometView.addProjection();
        if (this.state['showImage'] == SI_UNMAPPED)
            cometView.LoadImageForOverlay(overlayCanvas);
    
        this.overlayNeedsUpdate();
        if (this.state['spacecraftView']) {
            const {camera, controls} = this.sceneMgr;
            cometView.applyToCamera(camera, controls);
            controls.dispatchEvent({ type: 'change' });
        }
        this.updateCPanel('fileName', cometView.fileName);
        this.updateCPanel('time', cometView.time);
        this.updateCPanel('imageInfo', this.getInfoString(photoDict));
    }

    // only called if there are no matches, and the current cometView must be unloaded
    unloadComet() {
        const cometView = this.getCometView();
        if (cometView) {
            if (this.state.showImage == SI_ORTHOGRAPHIC) cometView.removeDecal(scene);
            if (this.state.showImage == SI_PERSPECTIVE) cometView.removeProjection(cometMaterial);
            CometView.lastRequestedImg = "";		// stop pending image requests from loading
            // Note: for SI_UNMAPPED, image will be automatically erased by the no matches overlay
            cometView.removeSelf();
            this.updateCPanel('fileName', "");
            this.updateCPanel('time', "");
            this.updateCPanel('imageInfo', "No matching images");
            this.cometView = null;
            this.overlayNeedsUpdate();   // may trigger No Matches overlay
        }
    } 

    loadCometByIndex(index) {
        if (this.dynamicArray && index >= 0 && index < this.dynamicArray.length) {
            this.loadComet(this.dynamicArray[index]);
            this.currentIndex = index;
            this.state['imageIndex'] = index;
            this.bus.emit('setVal', {key: 'imageIndex', val: index, silent: true});
        }
    }

    loadCometByFilename(fn) {
		for (let i = 0; i < this.ogPhotoArray.length; i++) {
			if (fn == this.ogPhotoArray[i].nm) {
				this.loadCometByIndex(i);
                break;
			}
		}
	}
    
    loadNext () {
		if (this.cometView) {
			if (this.currentIndex != this.dynamicArray.length-1) {
				this.loadComet(this.dynamicArray[++this.currentIndex]);
				this.state['imageIndex'] += 1;
                this.bus.emit('setVal', {key: 'imageIndex', val: this.state['imageIndex'], silent: true});
			}
		}
	}

	loadPrevious () {
		if (this.cometView) {
			if (this.currentIndex != 0) {
				this.loadComet(this.dynamicArray[--this.currentIndex]);
				this.state['imageIndex'] -= 1;
                this.bus.emit('setVal', {key: 'imageIndex', val: this.state['imageIndex'], silent: true});
			}
		}
	}

    setSkipDuration(value) {
        this.state['skipDuration'] = value;
        this.bus.emit('setVal', {key: 'skipDuration', val: value, silent: true});
        // Update the skip button labels
		this.bus.emit('setLabel', {key:'skipForward', label: 'Skip Forward a ' + value});
		this.bus.emit('setLabel', {key:'skipBackward', label: 'Skip Backward a ' + value});
	};

    skipForward () {
        const dynamicArray = this.dynamicArray, currentIndex = this.currentIndex;
		const currentDate = dynamicArray[currentIndex].date;
		const msSkip = currentDate.getTime() + this.milliseconds[this.state['skipDuration']];

        console.error("Calling skipForward");
		if (this.cometView) {
			for (let i = currentIndex; i < dynamicArray.length; i++) {
				if (dynamicArray[i].date.getTime() > msSkip) {
					this.loadCometByIndex(i);
					break;
				}
			}
		}
	}

	skipBackward() {
        const dynamicArray = this.dynamicArray, currentIndex = this.currentIndex;
        const currentDate = dynamicArray[currentIndex].date;
		const msSkip = currentDate.getTime() - this.milliseconds[this.state['skipDuration']];

		if (this.cometView) {
			for (let i = currentIndex; i >= 0; i--) {
				if (dynamicArray[i].date.getTime() < msSkip) {
					this.loadCometByIndex(i);
					break;
				}
			}
		}
	}

    clearPaint () {
        this.sceneMgr.clearPaintAux();      // clear the paint on the model
        this.ROI.init();                    // ROI now empty
        this.filterEng.updateAllFilters();  // re-apply all filters to reflect no ROI 
        this.updateCPanel('imageInfo', this.getInfoString(this.dynamicArray[this.currentIndex])); // will change if paint is cleared
    }

    downloadFileNames()  {
		var files = '';
		for (let i = 0; i < this.dynamicArray.length; i++) {
			files += this.dynamicArray[i].nm + '\n';		
		}
		this.download('comet_filenames.txt', files);
	}

    download (filename, text) {  // Downloads filename with contents of text
        var element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    getResFromPhotoDict(photoDict) {
        if ('rz' in photoDict) return photoDict.rz;
        else return CometView.defaultRes;
    }

    getInfoString(photoDict) {
        const numPainted = this.ROI.numPainted, avgPosition = this.ROI.avgPosition, avgNormal = this.ROI.avgNormal;
        if (!numPainted) return `#${photoDict.ogIndex}  m: ${photoDict.m2}`;
        const avg_sc_vec = photoDict.sc_v.clone().sub(avgPosition).normalize();
        const emissionAngle = Math.round(Math.acos(avg_sc_vec.dot(avgNormal))*180/Math.PI);
        const sun_vec = photoDict.sunHat;
        const incidAngle = Math.round(Math.acos(sun_vec.dot(avgNormal))*180/Math.PI);
        const phaseAngle = Math.round(Math.acos(avg_sc_vec.dot(sun_vec))*180/Math.PI);
        const rez = this.getResFromPhotoDict(photoDict);
        const width = Math.tan(Math.PI*(CometView.FOV/2.0)/180.0) * photoDict.sc_v.distanceTo(avgPosition);
        const m2 = Math.round(width/(.001*(rez/2)) * 100) / 100;
        return `#${photoDict.ogIndex}  m: ${m2}  e: ${emissionAngle}  i: ${incidAngle}  p: ${phaseAngle}`;
    }

    getCometView() {
        return this.cometView;
    }

    entryShowImage(val) {
        this.state['showImage'] = val;
        this.bus.emit('setVal', {key: 'showImage', val: val, silent: true});

        this.showImage(val);
    }

    showImage(val) {
        let cometView = this.getCometView();
        // first undo last setting as necessary
        if (this.lastSI == SI_ORTHOGRAPHIC) {
            if (cometView) cometView.removeDecal();
        } else if (this.lastSI == SI_PERSPECTIVE) {
            if (cometView) cometView.removeProjection();
        } else if (this.lastSI == SI_UNMAPPED) {
            this.enableOverlayCanvas(false);
        }

        // then establish the new setting
        if (val == SI_ORTHOGRAPHIC) {
            if (cometView) cometView.addDecal();
        } else if (val == SI_PERSPECTIVE) {
            if (cometView) cometView.addProjection();
        } else if (val == SI_UNMAPPED) {
            this.enableOverlayCanvas(true);
            if (cometView) cometView.LoadImageForOverlay(overlayCanvas);
        } 

        if (val != SI_NONE) { // disable paint when entering any image display
            if (this.state['enablePaint']) {
                this.bus.emit('setVal', {key: 'enablePaint', val: false, silent: false}); // note this calls adjustShading
            }
        }
        else this.sceneMgr.adjustShading();
        this.overlayNeedsUpdate();
        this.lastSI = val;
    }
    
    enableImageNavigation (val) {
        const keys = ['imageIndex', 'nextImage', 'previousImage', 'skipDuration', 'skipForward', 'skipBackward'];
        keys.forEach(k => {
            this.bus.emit('setEnabled', {key: k, enabled: val});
        });
    }
}
