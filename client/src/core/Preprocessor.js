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
		let cometView    = this.getCometView();
		let cometGeometry = this.getCometGeometry();
		let colorArray   = this.getColorArray();
		let targetMesh   = this.getTargetMesh();
		let colorAttr    = this.getColorAttr();
		if (!cometView) return;

		const sc = cometView.sc_position.clone();
		const v  = new THREE.Vector3();
		const raycaster = new THREE.Raycaster();
		let   res = [];
		raycaster.firstHitOnly = true;

		const r = 0, g = 0, b = VISIBLE_BLUE;   // unique blue for visibility
		const bbox = new THREE.Box3();
		const normDepth = new NormalDepth();

		cometView.createViewRect();
		const viewRect = cometView.viewRect;

		const pos = cometGeometry.attributes.position.array;

		// Reused vectors to avoid per-vertex allocations
		const vertToSC = new THREE.Vector3();   // v - sc
		const dir      = new THREE.Vector3();   // ray direction

		let anyVisible = false;

		for (let i = 0; i < pos.length; i += 3) {
			let isVisible = false;

			// Perturb vertex slightly so ray doesn't go exactly through shared vertex
			v.set(pos[i] + MILLIMETER, pos[i+1] + MILLIMETER, pos[i+2] + MILLIMETER);

			// vertToSC = v - sc
			vertToSC.subVectors(v, sc);
			const theoreticalDistance = vertToSC.length();

			// dir = normalized(v - sc)
			dir.copy(vertToSC).normalize();
			raycaster.set(sc, dir);

			// view-rect clip
			if (viewRect) {
				res.length = 0;
				raycaster.intersectObject(viewRect, false, res);
				if (res.length === 0) continue;
			}

			// Intersect comet mesh
			res.length = 0;
			raycaster.intersectObject(targetMesh, true, res);

			if (res.length > 0) {
				if (Math.abs(res[0].distance - theoreticalDistance) < METER) {
					isVisible = true;
				}
			}

			if (isVisible) {
				bbox.expandByPoint(v);  // include point in AABB
				if (normDepth) normDepth.expandByVector(vertToSC, cometView.normal);

				colorArray[i]   = r;
				colorArray[i+1] = g;
				colorArray[i+2] = b;
				anyVisible = true;
			}
		}

		if (anyVisible) colorAttr.needsUpdate = true;
		cometView.saveExtentInfo(bbox, normDepth);

		console.log("ComputeVisible time = %f milliseconds", window.performance.now() - startTime);
		console.log(`Visible vertex count = ${this.countVertices(VISIBLE_BLUE)}`);
		this.expandPaint(1);

		// TEMPORARY for debugging...
		this.initializeCameraMeshClassifier();
		this.classifyCameraRelativeToMesh(this.sceneMgr.camera, targetMesh, {});
		console.log(`CometView minDistAlongNormal = ${cometView.minDistAlongNormal} and maxDistAlongNormal = ${cometView.maxDistAlongNormal}`);
		console.log(`Camera near = ${this.sceneMgr.camera.near} and far = ${this.sceneMgr.camera.far}`);
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

	// ======================================================
	//  Camera–Mesh Classification Methods for Preprocessor
	// ======================================================
	//
	// Add these inside your Preprocessor object/class.
	// Expects:
	//   - this.THREE is three.js OR THREE globally available
	//   - mesh is indexed (vertex-indexed triangle mesh)
	//   - BVH optional (minDistance becomes exact if available)
	initializeCameraMeshClassifier() {
		this._cim_box          = new THREE.Box3();
		this._cim_camWorldPos  = new THREE.Vector3();
		this._cim_origin       = new THREE.Vector3();
		this._cim_dir          = new THREE.Vector3();
		this._cim_raycaster    = new THREE.Raycaster();

		// These two we’ll use for BVH local/world transforms
		this._cim_localPoint   = new THREE.Vector3();
		this._cim_localClosest = new THREE.Vector3();
		this._cim_closestPoint = new THREE.Vector3();
		this._cim_tmpNormal    = new THREE.Vector3();

		this._CIM_INSIDE_TEST_DIRS = [
			new THREE.Vector3( 1.0,  0.37,  0.23).normalize(),
			new THREE.Vector3(-0.5,  0.91,  0.10).normalize(),
			new THREE.Vector3( 0.2, -0.80,  0.56).normalize(),
			new THREE.Vector3(-0.3, -0.20,  0.93).normalize(),
			new THREE.Vector3( 0.7,  0.15, -0.69).normalize()
		];
	}

	// ======================================================
	//   Single-ray helper (method form)
	// ======================================================
	_cim_rayParityForDirection(point, mesh, dir, epsilonRay, maxDistance) {

		this._cim_origin.copy(point).addScaledVector(dir, epsilonRay);
		this._cim_dir.copy(dir);

		this._cim_raycaster.ray.origin.copy(this._cim_origin);
		this._cim_raycaster.ray.direction.copy(this._cim_dir);
		this._cim_raycaster.near = 0;
		this._cim_raycaster.far = maxDistance;
		this._cim_raycaster.firstHitOnly = false;

		const hits = this._cim_raycaster.intersectObject(mesh, false);

		let count   = 0;
		let nearest = Infinity;

		for (const h of hits) {
			if (h.distance > epsilonRay && h.face != null) {
				count++;
				if (h.distance < nearest) nearest = h.distance;
			}
		}

		return {
			intersections: count,
			isInsideAlongThisRay: (count % 2) === 1,
			nearestDistanceAlongRay: nearest
		};
	}


	// ======================================================
	//   Min distance helper – BVH in local space, distance in world space
	// ======================================================
	_cim_minDistanceToSurface(pointWorld, mesh) {
		const geom = mesh.geometry;
		if (!geom) return Infinity;

		// Ensure we have a bbox for fallback and bboxDistance
		if (!geom.boundingBox) geom.computeBoundingBox();
		this._cim_box.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);

		// One-time flags for logging (optional)
		this._cim_usedBVH          = this._cim_usedBVH          ?? false;
		this._cim_usedNoBVH        = this._cim_usedNoBVH        ?? false;
		this._cim_usedRayFallback  = this._cim_usedRayFallback  ?? false;
		this._cim_usedBBoxFallback = this._cim_usedBBoxFallback ?? false;

		// ---------- Preferred path: BVH closestPointToPoint (in local space) ----------
		if (geom.boundsTree && typeof geom.boundsTree.closestPointToPoint === "function") {
			if (!this._cim_usedBVH) {
				console.log(
					"%c[CIM] Using BVH closestPointToPoint (meshBVH, local space).",
					"color: lightgreen"
				);
				this._cim_usedBVH = true;
			}

			// Convert camera point from world → local (mesh space)
			this._cim_localPoint.copy(pointWorld);
			mesh.worldToLocal(this._cim_localPoint);

			// Find closest point in local space
			geom.boundsTree.closestPointToPoint(
				this._cim_localPoint,
				this._cim_localClosest,
				this._cim_tmpNormal   // optional; you can keep or drop this
			);

			// Convert closest point back to world space
			const closestWorld = this._cim_localClosest;
			mesh.localToWorld(closestWorld);

			// Distance in world space
			let dist = pointWorld.distanceTo(closestWorld);

			if (!Number.isFinite(dist)) {
				console.warn(
					"%c[CIM] Non-finite BVH distance; falling back to bbox distance.",
					"color: #ff6666"
				);
				dist = this._cim_box.distanceToPoint(pointWorld);
			}

			return dist;
		}

		// ---------- No BVH: warn once ----------
		if (!geom.boundsTree && !this._cim_usedNoBVH) {
			console.warn(
				"%c[CIM] Geometry has no boundsTree; minDistance will be approximate.",
				"color: orange"
			);
			this._cim_usedNoBVH = true;
		}

		// ---------- Approximate path: raycasting ----------
		if (!this._cim_usedRayFallback) {
			console.warn(
				"%c[CIM] Using ray-based fallback for minDistance.",
				"color: #f0ad4e"
			);
			this._cim_usedRayFallback = true;
		}

		let minDist = Infinity;

		for (const baseDir of this._CIM_INSIDE_TEST_DIRS) {
			// forward
			const resF = this._cim_rayParityForDirection(
				pointWorld, mesh, baseDir, 1e-3, Infinity
			);
			if (resF.nearestDistanceAlongRay < minDist) {
				minDist = resF.nearestDistanceAlongRay;
			}

			// backward
			this._cim_tmpNormal.copy(baseDir).negate();
			const resB = this._cim_rayParityForDirection(
				pointWorld, mesh, this._cim_tmpNormal, 1e-3, Infinity
			);
			if (resB.nearestDistanceAlongRay < minDist) {
				minDist = resB.nearestDistanceAlongRay;
			}
		}

		// If rays still miss, use bbox distance (never leave Infinity)
		if (!Number.isFinite(minDist)) {
			if (!this._cim_usedBBoxFallback) {
				console.warn(
					"%c[CIM] Rays missed mesh; using bounding-box distance fallback.",
					"color: #ff6666"
				);
				this._cim_usedBBoxFallback = true;
			}
			minDist = this._cim_box.distanceToPoint(pointWorld);
		}

		return minDist;
	}

	// ======================================================
	//   MAIN API: classify camera vs mesh (method)
	// ======================================================
	classifyCameraRelativeToMesh(camera, mesh, options = {}) {
		const epsilonRay     = options.epsilonRay     ?? 1e-3;
		const epsilonSurface = options.epsilonSurface ?? 1e-3;
		const maxDistance    = options.maxDistance    ?? Infinity;
		const debugLog       = options.debugLog       ?? true;

		const geom = mesh.geometry;
		if (!geom) {
			return {
				inside: false,
				onSurface: false,
				minDistance: Infinity,
				votesInside: 0,
				votesOutside: 0,
				bboxDistance: Infinity
			};
		}

		if (!geom.boundingBox) geom.computeBoundingBox();
		this._cim_box.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);

		camera.getWorldPosition(this._cim_camWorldPos);

		const quickOutside = !this._cim_box.containsPoint(this._cim_camWorldPos);
		const bboxDistance = this._cim_box.distanceToPoint(this._cim_camWorldPos);

		let votesInside  = 0;
		let votesOutside = 0;

		if (!quickOutside) {
			for (const dir of this._CIM_INSIDE_TEST_DIRS) {
				const res = this._cim_rayParityForDirection(
					this._cim_camWorldPos,
					mesh,
					dir,
					epsilonRay,
					maxDistance
				);

				if (res.isInsideAlongThisRay) votesInside++;
				else                          votesOutside++;
			}
		} else {
			votesInside  = 0;
			votesOutside = this._CIM_INSIDE_TEST_DIRS.length;
		}

		const inside = !quickOutside && votesInside > votesOutside;

		// Use BVH (or fallback) for min distance
		const minDistance = this._cim_minDistanceToSurface(this._cim_camWorldPos, mesh);

		// ⬅⬅⬅ IMPORTANT: only consider "onSurface" if we are NOT trivially outside the bbox
		const onSurface =
			!quickOutside &&
			Number.isFinite(minDistance) &&
			(minDistance <= epsilonSurface);

		if (debugLog) {
			console.log(
				`[Camera vs Mesh] ` +
				`inside=${inside}, onSurface=${onSurface}, ` +
				`minDistance=${Number.isFinite(minDistance) ? minDistance.toExponential(6) : 'Infinity'}, ` +
				`bboxDistance=${bboxDistance.toExponential(6)}, ` +
				`votesInside=${votesInside}, votesOutside=${votesOutside}, ` +
				`quickOutside=${quickOutside}`
			);
		}

		return {
			inside,
			onSurface,
			minDistance,
			votesInside,
			votesOutside,
			bboxDistance
		};
	}
}

