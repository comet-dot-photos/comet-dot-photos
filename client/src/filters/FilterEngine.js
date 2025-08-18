// filters/FilterEngine.js
// Pure filter functions over photo records. No DOM, no three.js here.

import * as THREE from 'three';
import {CometView} from '../view/CometView.js';

/**
 * @typedef {Object} Selection
 * @property {[number,number,number]} avgPosition
 * @property {[number,number,number]} avgNormal
 * @property {{min:number,max:number}} bbox
 * @property {number} count
 */

/**
 * @typedef {Object} Filters
 * @property {[number,number]} mpp
 * @property {[number,number]} emission
 * @property {[number,number]} incidence
 * @property {[number,number]} phase
 * @property {number} percentROI
 */

/**
 * @typedef {Object} Photo
 * @property {number} m2
 * @property {number} phase
 * @property {number} emission
 * @property {number} incidence
 * @property {{x:number,y:number,z:number}} sc_v
 * @property {number} rz  // effective resolution (optional)
 * @property {number} FOV // degrees (optional)
 */

// Filter failure bit position codes
const FAIL_MPP = 1;
const FAIL_EMISSION = 2;
const FAIL_PHASE = 4;
const FAIL_BBOX = 8;
const FAIL_INCIDENCE = 16;

export class FilterEngine {
  constructor({ bus, state, ROI, socket } ) {
    this.bus = bus;
    this.state = state;
    this.ROI = ROI;
    //this.timer = timer;
    this.socket = socket;
    
    // install socket visibility handler
    this.installVisibilityCallback();

    // used later for fast m2 calculations
    this.defaultRes = this.state.dataset.defaultRes;   // cache this because it is used a lot in this module
    const M2DIST = (.001*(this.defaultRes/2)) / Math.tan(Math.PI*(this.state.dataset.FOV/2.0)/180.0);
    this.M2MULTIPLIER = 1.0 / M2DIST; // for defaultRes, dist*M2MULTIPLIER == m2.
  }
/*
    applyFilters(photos, selection, filters, defaults) {
    return photos
        .filter(p => mppPass(p, selection, filters, defaults))
        .filter(p => emissionPass(p, selection, filters))
        .filter(p => incidencePass(p, selection, filters))
        .filter(p => phasePass(p, selection, filters));
    }

    // ---- Passes (stubbed; replace bodies with your current logic) ----

    export function mppPass(photo, selection, { mpp:[min,max] }, defaults) {
    if (!selection?.count) return photo.m2 >= min && photo.m2 <= max;
    const distSq = dist2(photo.sc_v, selection.avgPosition);
    const fovDeg = photo.FOV ?? defaults?.FOV ?? 2.2;
    const effRes = photo.rz ?? defaults?.defaultRes ?? 2048;
    const m2AtDist = distanceToMpp(Math.sqrt(distSq), effRes, fovDeg);
    return m2AtDist >= min && m2AtDist <= max;
    }

    export function emissionPass(photo, selection, { emission:[min,max] }) {
    return between(photo.emission, min, max);
    }

    export function incidencePass(photo, selection, { incidence:[min,max] }) {
    return between(photo.incidence, min, max);
    }

    export function phasePass(photo, selection, { phase:[min,max] }) {
    return between(photo.phase, min, max);
    }
    */

    entryEmissionFilter(newVal) {
        this.state.emissionAngle = newVal;
        this.bus.emit('setVal', {key: 'emissionAngle', val: newVal, silent: true});
        this.applyEmissionFilter();
    }

    entryMpPFilter(newVal) {
        this.state.metersPerPixel = newVal;
        this.bus.emit('setVal', {key: 'metersPerPixel', val: newVal, silent: true});
        this.applyMpPFilter();
    }

    entryIncidenceFilter(newVal) {
        this.state.incidenceAngle = newVal;
        this.bus.emit('setVal', {key: 'incidenceAngle', val: newVal, silent: true});
        this.applyIncidenceFilter();
    }

    entryPhaseFilter(newVal) {
        this.state.phaseAngle = newVal;
        this.bus.emit('setVal', {key: 'phaseAngle', val: newVal, silent: true});
        this.applyPhaseFilter();
    }

    applyEmissionFilter(doFilterCleanup = true) {
        const [low, high] = this.state.emissionAngle;
        const ogPhotoArray = this.ogPhotoArray, {avgNormal, avgPosition} = this.ROI;
        const timer0 = this.state['clock'].getElapsedTime();
        if (this.ROI.numPainted > 0) {
            for (let i = 0; i < ogPhotoArray.length; i++) {
                const avg_sc_vec = ogPhotoArray[i].sc_v.clone().sub(avgPosition).normalize();
                const angle = Math.acos(avgNormal.clone().dot(avg_sc_vec)) * 180/Math.PI;
                if (angle > high || angle < low){ 
                    ogPhotoArray[i].filter |= FAIL_EMISSION;
                }
                else {
                    ogPhotoArray[i].filter &= ~FAIL_EMISSION;
                }
            }
        }
        if (doFilterCleanup) this.filterCleanUp();
        const timer1 = this.state['clock'].getElapsedTime();
        console.log(`Emission filter: ${(timer1 - timer0)*1000} milliseconds`);
    }

    applyMpPFilter(doFilterCleanup = true) {
        const [low, high] = this.state.metersPerPixel;
        let ogPhotoArray = this.ogPhotoArray, {avgPosition} = this.ROI;
        if (!this.ROI.numPainted) {  // allow m2 filtering based on estimate stored in ogPhotoArray
            for (let i = 0; i < ogPhotoArray.length; i++) {
                if (ogPhotoArray[i].m2 > high || ogPhotoArray[i].m2 < low) {
                    ogPhotoArray[i].filter |= FAIL_MPP;
                }
                else {
                    ogPhotoArray[i].filter &= ~FAIL_MPP;
                }
            } 
        } else {				// do m2 filtering based on painted region
            const maxDist = (high * (.001*(this.defaultRes/2))) / Math.tan(Math.PI*(CometView.FOV/2.0)/180.0);
            const minDist = (low * (.001*(this.defaultRes/2))) / Math.tan(Math.PI*(CometView.FOV/2.0)/180.0);
            const maxDistSquared = maxDist*maxDist;
            const minDistSquared = minDist*minDist;
            for (let i = 0; i < ogPhotoArray.length; i++) {
                let trueDistSquared = ogPhotoArray[i].sc_v.distanceToSquared(avgPosition);
                if (ogPhotoArray[i].rz) // hence, not default
                    trueDistSquared *= (this.defaultRes/ogPhotoArray[i].rz)**2; // more computationally efficient to adjust trueDistSquared 
                if (trueDistSquared > maxDistSquared || trueDistSquared < minDistSquared)
                    ogPhotoArray[i].filter |= FAIL_MPP;
                else
                    ogPhotoArray[i].filter &= ~FAIL_MPP;
            } 
        }
        if (doFilterCleanup) this.filterCleanUp();
    }

    applyIncidenceFilter(doFilterCleanup = true) {
        const [low, high] = this.state.incidenceAngle;
        let ogPhotoArray = this.ogPhotoArray, {avgNormal} = this.ROI;
        if (this.ROI.numPainted > 0) {
            for (let i = 0; i < ogPhotoArray.length; i++) {
                const angle = Math.acos(ogPhotoArray[i].sunHat.dot(avgNormal)) * 180/Math.PI; 
                if (angle > high || angle < low) {
                    ogPhotoArray[i].filter |= FAIL_INCIDENCE;
                }
                else {
                    ogPhotoArray[i].filter &= ~FAIL_INCIDENCE;
                }
            }
        }
        if (doFilterCleanup) this.filterCleanUp();
    }

    applyPhaseFilter(doFilterCleanup = true) {
        const [low, high] = this.state.phaseAngle;
        let ogPhotoArray = this.ogPhotoArray, {avgPosition} = this.ROI;
        if (this.ROI.numPainted > 0) {
            for (let i = 0; i < ogPhotoArray.length; i++){
                const scHat = ogPhotoArray[i].sc_v.clone().sub(avgPosition).normalize();
                const angle = Math.acos(scHat.dot(ogPhotoArray[i].sunHat)) * 180/Math.PI;
                if (angle > high || angle < low){
                    ogPhotoArray[i].filter |= FAIL_PHASE;
                }
                else {
                    ogPhotoArray[i].filter &= ~FAIL_PHASE
                }
            }
        }
        if (doFilterCleanup) this.filterCleanUp();
    }

    initBBOXBitBuffer(nPhotos) {
        if (typeof this.bboxBitBuffer === "undefined") {
            const numBytes = Math.ceil(nPhotos/8);
            this.bboxBitBuffer = new ArrayBuffer(numBytes);
            this.bboxBitArray = new Uint8Array(this.bboxBitBuffer);
        }
        else {
            this.bboxBitArray.fill(0);
        }
    }

    applyGeoFilter (doFilterCleanup = true) {
        this.state['startTimer'] = this.state['clock'].getElapsedTime();
        let ogPhotoArray = this.ogPhotoArray;
        if (this.ROI.numPainted > 0) {
            this.initBBOXBitBuffer(ogPhotoArray.length);
            if (typeof this.ROI.bbox !== "undefined") {
                for (let i = 0; i < ogPhotoArray.length; i++) {
                    if (this.ROI.bbox.intersectsBox(ogPhotoArray[i].bbox)) {
                            this.ROI.setNthBit(i, this.bboxBitArray);
                    }
                }
                const mustMatch = Math.ceil(this.ROI.numPainted*this.state['percentOverlap']/100);
                this.socket.emit('clientRequestsVis', {mustMatch: mustMatch, imgSel: this.bboxBitArray, visAr: this.ROI.paintArray});
            }
        } else {  // nothing is painted, so all images pass
            for (let i = 0; i < ogPhotoArray.length; i++)
                ogPhotoArray[i].filter &= ~FAIL_BBOX;
            if (doFilterCleanup) this.filterCleanUp();
        }
    }

    updateAllFilters () {
        for (let i = 0; i < this.ogPhotoArray.length; i++)
            this.ogPhotoArray[i].filter = 0;		// all pass by default
        this.applyMpPFilter(false);
        this.applyEmissionFilter(false);
        this.applyIncidenceFilter(false);
        this.applyGeoFilter(false);
        this.applyPhaseFilter(false);
        this.filterCleanUp();   // just one cleanup at the end
    }
    
    filterCleanUp() {
        let dynamicArray = this.ogPhotoArray.filter((item) => item.filter === 0);
        this.bus.emit('filter.results', dynamicArray);
    }
    
    cachePhotoInformation(ogPhotoArray) {
		for (let i = 0; i < ogPhotoArray.length; i++) {
			ogPhotoArray[i].sunHat = new THREE.Vector3(ogPhotoArray[i].su[0], ogPhotoArray[i].su[1], ogPhotoArray[i].su[2]).normalize();
			ogPhotoArray[i].sc_v = new THREE.Vector3(ogPhotoArray[i].sc[0], ogPhotoArray[i].sc[1], ogPhotoArray[i].sc[2]);
			ogPhotoArray[i].filter = 0;
			ogPhotoArray[i].ogIndex = i;
			if (!this.state['preprocessMode']) {  // bbox is calculated during preprocessMode, so is not initially available
				const bboxMin = new THREE.Vector3(ogPhotoArray[i].b1[0], ogPhotoArray[i].b1[1], ogPhotoArray[i].b1[2]);
				const bboxMax = new THREE.Vector3(ogPhotoArray[i].b2[0], ogPhotoArray[i].b2[1], ogPhotoArray[i].b2[2]);
				ogPhotoArray[i].bbox = new THREE.Box3(bboxMin, bboxMax);
			}
			//create date object which is time after 1970 and store it here!!!
			ogPhotoArray[i].date = new Date(ogPhotoArray[i].ti);

			// Extra
			ogPhotoArray[i].m2 = this.getM2FromDistance(ogPhotoArray[i], ogPhotoArray[i].d1);
		}
        return ogPhotoArray;
	}

    getM2FromDistance(photoDict, dist) {
        let m2 = dist * this.M2MULTIPLIER;
        if ('rz' in photoDict) m2 *= this.defaultRes / photoDict.rz;	// adjust for different resolutions
        return Math.round(m2 * 100) / 100;  // rounding to 2 digits after decimal
    }

    installMetadata(metadata) {
        this.ogPhotoArray = this.cachePhotoInformation(metadata);  // add some extra info for filtering, and save it away
    }

    installVisibilityCallback() {
        this.socket.on('serverProvidesVis', (message) => {
            const newBBoxBitArray = new Uint8Array(message);
            for (let i = 0; i < this.ogPhotoArray.length; i++){
                if (this.ROI.getNthBit(i, newBBoxBitArray) === 1) {
                    this.ogPhotoArray[i].filter &= ~FAIL_BBOX;
                }
                else {
                    this.ogPhotoArray[i].filter |= FAIL_BBOX;
                }
            }
            this.filterCleanUp();
            let delta = this.state['clock'].getElapsedTime() - this.state['startTimer'];
            console.log(`Visibility check: ${(delta)*1000} milliseconds`)
        });
    };

    setPercentOverlap(percent) {
        this.state['percentOverlap'] = percent;
        this.bus.emit('setVal', {key: 'percentOverlap', val: percent, silent: true});
        if (this.ROI.numPainted > 0) {
            this.applyGeoFilter();
        }
    }
}

/*

// ---- utils ----

function between(v, a, b){ return v >= a && v <= b; }
function dist2(a, b){
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dx = a.x - b[0], dy = a.y - b[1], dz = a.z - b[2];
  return dx*dx + dy*dy + dz*dz;
}

function distanceToMpp(distance, res, fovDeg) {
  const width = Math.tan(Math.PI * (fovDeg / 2) / 180) * distance;
  return +(width / (.001 * (res / 2))).toFixed(2);
}
  */
