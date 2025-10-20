// core/Preprocessor.js
//    Preprocessor class: handles preprocessing operations such as computing
//    visibility of comet vertices from each image, and communicating with
//    the server during preprocessing mode.

import * as THREE from 'three';
import {NormalDepth} from "../view/CometView.js";

const VISIBLE_GREEN = 249, VISIBLE_BLUE = 249; // color components for visibility processing
const MILLIMETER = .000001;  // in km
const METER = .001; 		 // in km

export class Preprocessor {
	constructor({ bus, state, socket, imageBrowser, sceneMgr }) {
	this.socket = socket;
	this.imageBrowser = imageBrowser;
	this.sceneMgr = sceneMgr;

	this.filterEng = imageBrowser.filterEng;
	this.ROI = this.filterEng.ROI;
	this.getM2FromDistance = imageBrowser.filterEng.getM2FromDistance.bind(imageBrowser.filterEng);
	this.preprocessing = false;		// This is true when preprocessing is actually in progress

	// disable preprocess button if client not in preprocess mode
	if (!state.preprocessMode) bus.emit('setEnabled', {key: 'preprocess', enabled: false}); 

	this.initSocketListeners();
	}

	getCometView() {
		return this.imageBrowser.getCometView();
	}

	getTargetMesh() {
		return this.sceneMgr.targetMesh;
	}

	getColorArray() {
		return this.sceneMgr.colorArray;
	}

	getColorAttr() {
		return this.sceneMgr.colorAttr;
	}

	getOGPhotoArray() {
		return this.imageBrowser.ogPhotoArray;
	}

	getCometGeometry() {
		return this.sceneMgr.cometGeometry;
	}


	countVertices(blueVal) {  // helper function - for debugging
		let nVerts = 0, i = 2, colorArray = this.getColorArray();
		const arraySize = colorArray.length;
		while (i < arraySize-1) {
			if (colorArray[i] == blueVal) nVerts++;
			i += 3;
		}
		return nVerts;
	}

	expandPaint(n) {
		let colorArray = this.getColorArray();
		let cometGeometry = this.getCometGeometry();
    	const r = 0, g = VISIBLE_GREEN, b = 0;
		const faces = cometGeometry.index.array; // Get the face indice array
		// Expand blue vertices to connected vertices - paint them green
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < faces.length; j += 3) {
				const vertIndices = [faces[j], faces[j+1], faces[j+2]];
				for (let k = 0; k < 3; k++) {
					let cIndex1 = vertIndices[k]*3;
					let cIndex2 = vertIndices[(k+1) % 3]*3;
					let cIndex3 = vertIndices[(k+2) % 3]*3;
					if (colorArray[cIndex1+2] != VISIBLE_BLUE && ((colorArray[cIndex2+2] == VISIBLE_BLUE) || colorArray[cIndex3+2] == VISIBLE_BLUE)) {
						colorArray[cIndex1] = r;
						colorArray[cIndex1+1] = g;
						colorArray[cIndex1+2] = b;
					}
				}
			}

			// Repaint green vertices VISIBLE_BLUE
			for (let j = 0; j < colorArray.length; j+=3) {
				if (colorArray[j+1] == VISIBLE_GREEN) {
					colorArray[j] = 0;
					colorArray[j+1] = 0;
					colorArray[j+2] = VISIBLE_BLUE;
				}
			} 
		}
}

	computeVisibleVertices () {
		const startTime = window.performance.now();
		let cometView = this.getCometView(), cometGeometry = this.getCometGeometry();
		let colorArray = this.getColorArray(), targetMesh = this.getTargetMesh();
		let colorAttr = this.getColorAttr();
		const sc = cometView.sc_position.clone();
		const v = new THREE.Vector3();
		const raycaster = new THREE.Raycaster();
		let res = [];
		raycaster.firstHitOnly = true;
		const r=0, g=0, b=VISIBLE_BLUE;   // bright blue for now (really) - and a unique byte for visibility in the blue channel
		const bbox = new THREE.Box3();
		const normDepth = cometView ? new NormalDepth() : null;

		if (cometView) cometView.createViewRect();

		for (let i = 0; i < cometGeometry.attributes.position.array.length; i+=3) {
			let isVisible = false;
			const vertToSC = v.clone().sub(sc);
			v.x = cometGeometry.attributes.position.array[i] + MILLIMETER; // perturb by a millimeter so it doesn't go through the vertex
			v.y = cometGeometry.attributes.position.array[i+1] + MILLIMETER;
			v.z = cometGeometry.attributes.position.array[i+2] + MILLIMETER;
			const theoreticalDistance = v.distanceTo(sc);
			// console.log("Theoretical distance is %f", theoreticalDistance);
			raycaster.set(sc, v.clone().sub(sc));
			// console.log("v is %O, sc is %O, sc, dir = %O", v, sc, v.clone().sub(sc));
			res.length = 0;
			if (cometView && cometView.viewRect) {
				res = raycaster.intersectObject(cometView.viewRect, false, res);
				if (res.length == 0) continue;    // does not intersect viewRect, which is set
			}
			res.length = 0;
			res = raycaster.intersectObject(targetMesh, true, res);
			if (res.length > 0) {
				// console.log("res[0].distance = %f", res[0].distance);
				if (Math.abs(res[0].distance - theoreticalDistance) < METER) // less than a meter
					isVisible = true;
			}
			if (isVisible) {
				bbox.expandByPoint(v);		// include point in our axis-aligned bounding box
				if (normDepth) normDepth.expandByVector(vertToSC, cometView.normal);
				colorArray[i] = r;
				colorArray[i+1] = g;
				colorArray[i+2] = b;
				colorAttr.needsUpdate = true;
			}
		}
		if (cometView) cometView.saveExtentInfo(bbox, normDepth);
		console.log("ComputeVisible time = %f milliseconds", window.performance.now() - startTime);
		console.log(`Visible vertex count = ${this.countVertices(VISIBLE_BLUE)}`);
		this.expandPaint(1);
	}

	beginPreprocessing () {
		this.preProcessTime0 = window.performance.now();
		let ogPhotoArray = this.getOGPhotoArray();
		if (!this.preprocessing && ogPhotoArray) {
			this.socket.emit('PPclientReadyToStart', {count: ogPhotoArray.length});
			this.preprocessing = true;
		}
	}

	initSocketListeners() {
		this.socket.on('PPserverRequestsVisibility', (message) => { // {index:, name:}
			console.log(`Got a PPserverRequestsVisibility: ${message.index}`);
			let ogPhotoArray = this.getOGPhotoArray();
			if (ogPhotoArray[message.index].nm === message.name) {	// got a match!
				this.imageBrowser.clearPaint()		// clear away any visibility paint
				this.imageBrowser.loadCometByIndex(message.index);		// loaded requested index  
				this.computeVisibleVertices();	// apply visibility paint

				let cometView = this.getCometView();
				const bbox = cometView.bbox;
				message.bbox = {min: bbox.min.toArray(), max: bbox.max.toArray()};
				const depth = cometView.normDepth;
				if (this.getM2FromDistance(ogPhotoArray[message.index], depth.depthMin) > 10)
					depth.depthMax = depth.depthMin-1;	// Tell server not to save if m2 > 10
				message.depth = {min: depth.depthMin, max: depth.depthMax};
				this.ROI.updatePaintBuffer(VISIBLE_BLUE);
				message.visBuffer = this.ROI.paintArray;
				this.socket.emit('PPclientProvidesVisibility', message);
				console.log('Sending a PPclientProvidesVisibility %O', message)
				if (message.index === ogPhotoArray.length-1) {
					this.preprocessing = false;
					console.log(`Finished in ${(window.performance.now() - this.preProcessTime0) / 1000} seconds!!!`);
				}
			} else {
				console.error("Bad index/name registration between client and server - debug it!");
			}
		});

		this.socket.on('PPserverNotInPreprocessingMode', () => {
			alert('Server must be running in Preprocessing Mode too.')
		});
	}
} 
