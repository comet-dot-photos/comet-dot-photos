import Stats from './node_modules/three/examples/jsm/libs/stats.module.js';// should be good
import * as dat from './node_modules/three/examples/jsm/libs/lil-gui.module.min.js'; //should be good
import * as THREE from './node_modules/three/build/three.module.js'; //should be good
import { TrackballControls } from './node_modules/three/examples/jsm/controls/TrackballControls.js'; //should be good
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CONTAINED, INTERSECTED, NOT_INTERSECTED } from './node_modules/three-mesh-bvh/src/index.js';
import { OBJLoader2 } from './node_modules/wwobjloader2/dist/OBJLoader2.js';
import ProjectedMaterial from '../node_modules/three-projected-material/build/ProjectedMaterial.module.js';
import {CometInfo} from './cometInfoV3.5.js';

let urlPrefix = "";
let stats;
let scene, camera, renderer, controls, colorArray, colorAttr, r, b, g;
let threeCanvas, overlayCanvas;
let targetMesh, cometMaterial, cometGeometry;
let mouse = new THREE.Vector2();
let mouseType = - 1;
let cometInfo = null;
let ogPhotoArray, dynamicArray;
let avgNormal, avgPosition, roiBoundingBox;
let applyGeoFilter, updateAllFilters, download;
let numPainted = 0;
let bboxBitBuffer, bboxBitArray, paintBuffer, paintArray;
let xAxisLine, yAxisLine, zAxisLine;
let refreshOverlay, overlayNeedsUpdate = true, haltCircle = false, pointerDown = false;
let CORMode = false, CORMesh;
let oldCOR, deltaCOR, intervalCOR = 1, t0COR = -1;
let debugMode = false;
let startTimer, endTimer;	// just for measuring speed

function generateSessionID() {	// from https://www.codegrepper.com. Only really used when running server locally
	return '_' + Math.random().toString(36).substring(2, 11);
 };

var socket = io({
	query: {
	  clientID: generateSessionID()
	},
  });

const BRUSH_RED = 0xf1;

const FAIL_MPP = 1;
const FAIL_EMISSION = 2;
const FAIL_PHASE = 4;
const FAIL_BBOX = 8;
const FAIL_INCIDENCE = 16;

const msDay = 86400000;
const msMonth = 2628000000;
const msYear = 31536000000;

const origin = new THREE.Vector3(0,0,0);
const zPoint4 = new THREE.Vector3(0,0,4);
const yPoint4 = new THREE.Vector3(0,4,0);
const xPoint4 = new THREE.Vector3(4,0,0);

const COMETGREYVAL = 255;
const COMETCOLOR = COMETGREYVAL<<16 | COMETGREYVAL<<8 | COMETGREYVAL;
const MINBRUSHSIZE = 5, MAXBRUSHSIZE = 200, INITBRUSHSIZE = 100;
const SI_NONE = "None", SI_UNMAPPED = "Unmapped 2D", SI_PERSPECTIVE = "Perspective", SI_ORTHOGRAPHIC = "Orthographic";

var currentIndex = 0;

function findSquare(paint){
	var boundingBox = new THREE.Box3();
	const raycaster = new THREE.Raycaster();
	raycaster.firstHitOnly = true;
	var vertex_plane = new THREE.Vector3();
	let tl_plane = new THREE.Vector3();
	let tr_plane = new THREE.Vector3();
	let br_plane = new THREE.Vector3();
	let bl_plane = new THREE.Vector3();
	const TLRay = new THREE.Ray(cometInfo.sc_position, cometInfo.top_left_dir);
	const TRRay = new THREE.Ray(cometInfo.sc_position, cometInfo.top_right_dir);
	const BRRay = new THREE.Ray(cometInfo.sc_position, cometInfo.bottom_right_dir);
	const BLRay = new THREE.Ray(cometInfo.sc_position, cometInfo.bottom_left_dir);
	TLRay.intersectPlane(cometInfo.image_plane, tl_plane);
	TRRay.intersectPlane(cometInfo.image_plane, tr_plane);
	BRRay.intersectPlane(cometInfo.image_plane, br_plane);
	BLRay.intersectPlane(cometInfo.image_plane, bl_plane);




	//vertex_ray initially points in unused direction it is set before first real use
	//normal is random unit vector
	var vertex_ray = new THREE.Ray(cometInfo.sc_position, cometInfo.normal);
	var minDistAlongNormal = 999999999999999999;
	var maxDistAlongNormal = 0; //talk to dad about if this is too fragile
	for (let i = 0; i < cometGeometry.attributes.position.array.length; i+=3) {
		const errorTolerance = 0.000001
		const pseudoVertex = new THREE.Vector3(cometGeometry.attributes.position.array[i] + errorTolerance,
			cometGeometry.attributes.position.array[i+1] + errorTolerance, 
			cometGeometry.attributes.position.array[i+2] + errorTolerance);
		
		const sc_to_vertex = pseudoVertex.clone().sub(cometInfo.sc_position);
		const vertex_dir = sc_to_vertex.clone().normalize();
		vertex_ray.direction = vertex_dir;

		vertex_ray.intersectPlane(cometInfo.image_plane, vertex_plane);
		
		const v1 = tl_plane.clone().sub(vertex_plane);
		const v2 = tr_plane.clone().sub(vertex_plane);
		const v3 = br_plane.clone().sub(vertex_plane);
		const v4 = bl_plane.clone().sub(vertex_plane);
		
		const interior_sum = v1.angleTo(v2) + v2.angleTo(v3) + v3.angleTo(v4) + v4.angleTo(v1);
		//if in bounding box
		if (interior_sum > 2*Math.PI-errorTolerance) {
			raycaster.set(cometInfo.sc_position, vertex_dir);
			const res = raycaster.intersectObject(targetMesh, true);
			if (res.length > 0) {
				if(res[0].point.clone().sub(pseudoVertex).length() < 0.01) {
					boundingBox.expandByPoint(res[0].point);
					const distAlongNormal = sc_to_vertex.dot(cometInfo.normal);
					if (paint) {
						cometGeometry.attributes.color.array[i] = 0;
						cometGeometry.attributes.color.array[i+1] = 0;
						cometGeometry.attributes.color.array[i+2] = 255;
					}
					if (distAlongNormal > maxDistAlongNormal) {
						maxDistAlongNormal = distAlongNormal;
					}
					if (distAlongNormal < minDistAlongNormal) {
						minDistAlongNormal = distAlongNormal;
					}
				}
			}
		}
	}
	colorAttr.needsUpdate = true;	
	cometInfo.setMaxDistAlongNormal(maxDistAlongNormal);
	cometInfo.setMinDistAlongNormal(minDistAlongNormal);
}

function initBBOXBitBuffer(nPhotos) {
	if (typeof bboxBitBuffer === "undefined") {
		const numBytes = Math.ceil(nPhotos/8);
		bboxBitBuffer = new ArrayBuffer(numBytes);
		bboxBitArray = new Uint8Array(bboxBitBuffer);
	}
	else {
		bboxBitArray.fill(0);
	}
}

function initPaintBuffer(nVerts) {
	if (typeof paintBuffer === "undefined") {
		const numBytes = Math.ceil(nVerts/64)*8; //numBytes set to min number that will hold all bits yet divisible by 8 so can run quick on 64bit processor
		paintBuffer = new ArrayBuffer(numBytes);
		paintArray = new Uint8Array(paintBuffer);
	}
	else {
		paintArray.fill(0);
	}
}

function setNthBit(i, bitArray) {
	// Calculate the index of the element in the bit array
	let index = Math.floor(i / 8);
	// Calculate the position of the bit within the element
	let pos = i % 8;
	// Set the i'th bit to 1 using bitwise OR
	bitArray[index] |= (1 << pos);
}
function getNthBit(n, bitArray) {
	// Calculate the index of the element in the bit array
	let index = Math.floor(n / 8);
	// Calculate the position of the bit within the element
	let pos = n % 8;
	// Get the value of the n'th bit using bitwise AND
	return (bitArray[index] & (1 << pos)) >> pos;
}

//clock
const clock = new THREE.Clock();
clock.start();
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;


const params = {
	quickstartHelp: function() {
		window.open("quickstart.html");
	},
	brushSize: INITBRUSHSIZE,
	paint: false,
	clear: function() {
		colorArray.fill( 255 );
		colorAttr.needsUpdate = true;
		numPainted = 0;
		params.photoInfo = getInfoString(dynamicArray[params.photoIndex]);
		updateAllFilters(ogPhotoArray);
		overlayNeedsUpdate = true;
	},
	paintVisible: function() {
		const startfunc = clock.getElapsedTime();
		let j = 0;
		let k = 0;
		const raycaster = new THREE.Raycaster();
		raycaster.firstHitOnly = true;
			
		for (let i = 0; i < cometGeometry.attributes.position.array.length; i+=3) {
			const errorTolerance = 0.000001
			const pseudoVertex = new THREE.Vector3(cometGeometry.attributes.position.array[i] + errorTolerance,
				cometGeometry.attributes.position.array[i+1] + errorTolerance, 
				cometGeometry.attributes.position.array[i+2] + errorTolerance);

			const vertexDirection = pseudoVertex.clone().sub(camera.position).normalize();
		
			raycaster.set(camera.position, vertexDirection);
			const res = raycaster.intersectObject(targetMesh, true);

			
			if (res.length > 0) {
				if (res[0].point.clone().sub(pseudoVertex).length() < 0.01) {
					j++;
					r = 0, g = 0, b = 255;
					
					cometGeometry.attributes.color.array[i] = 0;
					cometGeometry.attributes.color.array[i+1] = 0;
					cometGeometry.attributes.color.array[i+2] = 255;
				}
				else{
					k++;
				}
			}
			else{
				k++;
			}
			
		}
		colorAttr.needsUpdate = true;
		const endfunc = clock.getElapsedTime();
		const funcTime = endfunc-startfunc;
		//console.log('total time: %O', funcTime);
		//console.log('total vertices painted: %O', j);
		//console.log('total vertices not painted: %O', k);
	},
	paintSquare: function() {
		findSquare(true);
	},
	showImage: SI_NONE,
    circleRegion: true,
	blueBox: false,
	axes: false,
	autoCam: false,
	//showPivot: true,
	loadPicture: function() {
		loadComet(dynamicArray[0]);
		this.photoIndex = 0;
		currentIndex = 0;
	},
	loadNext: function() {
		if (cometInfo) {
			if (currentIndex != dynamicArray.length-1) {
				loadComet(dynamicArray[currentIndex + 1]);
				currentIndex += 1;
				this.photoIndex += 1;
			}
		}
	},
	loadPrevious: function() {
		if (cometInfo) {
			if (currentIndex != 0) {
				loadComet(dynamicArray[currentIndex - 1]);
				currentIndex -= 1;
				this.photoIndex -= 1;
			}
		}
	},
	photoIndex: 0,
	fileName: 'None',
	time: 'None',
	percentROI: 75,
	returnPainted: function() {
		initPaintBuffer(cometGeometry.attributes.position.count);
		roiBoundingBox = new THREE.Box3();
		numPainted = 0;
        let loc = new THREE.Vector3(0, 0, 0);
        let norm = new THREE.Vector3(0, 0, 0);
        let thisVec = new THREE.Vector3();
		for (let i = 0; i < cometGeometry.attributes.color.array.length; i+=3) {
			if (cometGeometry.attributes.color.array[i] == BRUSH_RED) {
	                thisVec.fromArray(cometGeometry.attributes.position.array, i);
					roiBoundingBox.expandByPoint(thisVec);
                    loc.add(thisVec);
					thisVec.fromArray(cometGeometry.attributes.normal.array, i);
                    norm.add(thisVec);
                    setNthBit(i/3, paintArray);
                    numPainted++;
			}
		}
		console.log('numPainted', numPainted)
		if (numPainted > 0) {
            avgPosition = loc.divideScalar(numPainted);
			avgNormal = norm.divideScalar(numPainted).normalize();
		}
		
		params.photoInfo = getInfoString(dynamicArray[params.photoIndex]);
		//console.log('avgNormal:', avgNormal);
		//console.log('roiBoundingBox:', roiBoundingBox)
		updateAllFilters(ogPhotoArray);
	},
	
	MpP_duo: [0, 10],
	emission_duo: [0, 90],
	incidence_duo: [0, 90],
	phase_duo: [0, 180],

	bbox: function() {
		applyGeoFilter(ogPhotoArray);
	},
	status: 'Loading',
	photoInfo: 'None Selected',
	skipLength: 'Month',
	skipf: function(){
		const currentDate = dynamicArray[this.photoIndex].date;
		var msSkip = currentDate.getTime()
		if (this.skipLength === "Day") {
			msSkip += msDay;
		}
		else if (this.skipLength === "Month") {
			msSkip += msMonth;
		}
		else {
			msSkip += msYear;
		}
		if (cometInfo) {
			for (let i = this.photoIndex; i < dynamicArray.length; i++) {
				if (dynamicArray[i].date.getTime() > msSkip) {
					loadComet(dynamicArray[i]);
					currentIndex = i;
					this.photoIndex = i;
					break;
				}
			}
		}
	},
	skipb: function() {
		const currentDate = dynamicArray[this.photoIndex].date;
		var msSkip = currentDate.getTime()
		if (this.skipLength === "Day") {
			msSkip -= msDay;
		}
		else if (this.skipLength === "Month") {
			msSkip -= msMonth;
		}
		else {
			msSkip -= msYear;
		}
		if (cometInfo) {
			for (let i = this.photoIndex; i >= 0; i--) {
				if (dynamicArray[i].date.getTime() < msSkip) {
					loadComet(dynamicArray[i]);
					currentIndex = i;
					this.photoIndex = i;
					break;
				}
			}
		}
	},
	download: function() {
		var files = '';
		for (let i = 0; i < dynamicArray.length; i++) {
			files += dynamicArray[i].nm + '\n';		
		}
		download('comet_filenames.txt', files);
	},
	memStats: function() {
        params.status = `Textures: ${renderer.info.memory.textures}. Geometries = ${renderer.info.memory.geometries}.`;
    },
    flatShading: true
}

function getResFromPhotoDict(photoDict) {
	if ('rz' in photoDict) return photoDict.rz;
	else return CometInfo.defaultRes;
}

function getInfoString(photoDict) {
	if (!numPainted) return `#${photoDict.ogIndex}  m: ${photoDict.m2}`;
	const avg_sc_vec = photoDict.sc_v.clone().sub(avgPosition).normalize();
	const emissionAngle = Math.round(Math.acos(avg_sc_vec.dot(avgNormal))*180/Math.PI);
	const sun_vec = photoDict.sunHat;
	const incidAngle = Math.round(Math.acos(sun_vec.dot(avgNormal))*180/Math.PI);
	const phaseAngle = Math.round(Math.acos(avg_sc_vec.dot(sun_vec))*180/Math.PI);
	const rez = getResFromPhotoDict(photoDict);
	const width = Math.tan(Math.PI*(CometInfo.FOV/2.0)/180.0) * photoDict.sc_v.distanceTo(avgPosition);
	const m2 = Math.round(width/(.001*(rez/2)) * 100) / 100;
	return `#${photoDict.ogIndex}  m: ${m2}  e: ${emissionAngle}  i: ${incidAngle}  p: ${phaseAngle}`;
}

function loadComet(photoDict) {
	if (cometInfo) {
		if (cometInfo.ogIndex === photoDict.ogIndex) return;		// trying to load what is already loaded
		cometInfo.removeSelf(scene);		// remove the old one
	}
	cometInfo = new CometInfo(photoDict);

	if (params.blueBox)
		cometInfo.addOutline(scene);
    if (params.showImage == SI_ORTHOGRAPHIC) cometInfo.addDecal(scene, targetMesh /*, paintInfo ? paintInfo.avgLoc : null*/);
    if (params.showImage == SI_PERSPECTIVE) cometInfo.addProjection(targetMesh, cometMaterial);
    if (params.showImage == SI_UNMAPPED)
        cometInfo.LoadImageForOverlay(overlayCanvas);
 
    overlayNeedsUpdate = true;
    if (params.autoCam) {
		cometInfo.applyToCamera(camera, controls);
		controls.dispatchEvent({ type: 'change' });
	}
	params.fileName = cometInfo.fileName;
	params.time = cometInfo.time;
	params.photoInfo = getInfoString(photoDict);
}

function unloadComet() {
	if (cometInfo) {
		cometInfo.removeSelf(scene);
		params.fileName = "";
		params.time = "";
		params.photoInfo = "No matching images";
	}
}

function processArguments() {
	// Create a new URL object
	const urlString = window.location.href;
	const url = new URL(urlString);
	// console.log("URL: ", url)
	const searchParams = url.searchParams;
	// localURL overrides httpsPort which overrides httpPort
	const httpPort = searchParams.get('httpPort');
	if (httpPort) urlPrefix = `http://localhost:${httpPort}`;
	const httpsPort = searchParams.get('httpsPort');
	if (httpsPort) urlPrefix = `https://localhost:${httpsPort}`;
	const localURL = searchParams.get('localURL');
	if (localURL) urlPrefix = localURL;
	if (urlPrefix != "" && urlPrefix.at(-1) != '/') urlPrefix += '/';  // non-empty urlPrefix must end in a /
	CometInfo.urlPrefix = urlPrefix;

	debugMode = searchParams.has('debug');
}

function init() {
	processArguments();
	const bgColor = 0x263238 / 2;

	// renderer setup
	threeCanvas = document.getElementById('threeCanvas');
	renderer = new THREE.WebGLRenderer( { canvas: threeCanvas, antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild( renderer.domElement );
	renderer.domElement.style.touchAction = 'none';

	// overlay setup
	// Initialize 2D canvas
	overlayCanvas = document.getElementById('overlayCanvas');
	overlayCanvas.width = window.innerWidth;
	overlayCanvas.height = window.innerHeight;

	// scene setup
	scene = new THREE.Scene();
	
	const light = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light.position.set( 1, 1, 1 );
	const light2 = new THREE.DirectionalLight(0xffffff, 0.5 );
	light2.position.set( -1, -1, -1);
	scene.add( light );
	scene.add(light2);
	scene.add( new THREE.AmbientLight( 0xffffff, 0.4 ) );

	//ADD AXES
	function createAxes() {
		const zMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});
		const yMaterial = new THREE.LineBasicMaterial({color: 0x00ff00});
		const xMaterial = new THREE.LineBasicMaterial({color: 0xff0000});

		const zAxis = [origin, zPoint4];
		const yAxis = [origin, yPoint4];
		const xAxis = [origin, xPoint4];

		const ZAxisGeo = new THREE.BufferGeometry().setFromPoints(zAxis);
		const YAxisGeo = new THREE.BufferGeometry().setFromPoints(yAxis);
		const XAxisGeo = new THREE.BufferGeometry().setFromPoints(xAxis);

		zAxisLine = new THREE.Line(ZAxisGeo, zMaterial);
		yAxisLine = new THREE.Line(YAxisGeo, yMaterial);
		xAxisLine = new THREE.Line(XAxisGeo, xMaterial);
	}
	createAxes();

	const modelPath = urlPrefix + 'cg-dlr_spg-shap7-v1.0_200Kfacets.obj'; 
	const objLoader2 = new OBJLoader2().setUseIndices(true);

	const loadData = (object3d) => {
        cometGeometry = object3d.children[0].geometry;
        cometGeometry.computeVertexNormals();                
        colorArray = new Uint8Array( cometGeometry.attributes.position.count * 3 );
		colorArray.fill(255);
		colorAttr = new THREE.BufferAttribute( colorArray, 3, true );
		colorAttr.setUsage( THREE.DynamicDrawUsage );
		cometGeometry.setAttribute( 'color', colorAttr );
        cometMaterial = new ProjectedMaterial ({ 
            cover: false,
            // color: 0x909090,
			color: COMETCOLOR,
			transparent: false,
			opacity: 1.0,
			vertexColors: true,
			flatShading: params.flatShading
            });
		// const cometMaterial = new THREE.MeshStandardMaterial({roughness: 1.0, metalness: 0, vertexColors: true, flatShading: true});
		targetMesh = new THREE.Mesh( cometGeometry, cometMaterial );
		targetMesh.geometry.computeBoundsTree();
		scene.add( targetMesh );
		if (ogPhotoArray) { //if photo array loaded then load first
			params.loadPicture();
		}
    };


	objLoader2.load(modelPath, loadData);


	const brushGeometry = new THREE.SphereGeometry(1, 40, 40);
	const brushMaterial = new THREE.MeshStandardMaterial( {
		color: 0xEC407A,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		opacity: 0.5,
		premultipliedAlpha: true,
		emissive: 0xEC407A,
		emissiveIntensity: 0.5,
	} );
	const brushMesh = new THREE.Mesh(brushGeometry, brushMaterial);
	brushMesh.visible = false;
	scene.add(brushMesh);

	const CORGeometry = new THREE.SphereGeometry(.05, 40, 40);
	const CORMaterial = new THREE.MeshStandardMaterial( {
		color: 0x007090,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		opacity: .5,
		premultipliedAlpha: true,
		emissive: 0x007090,
		emissiveIntensity: 1.0, //0.5,
	} );
	CORMesh = new THREE.Mesh(CORGeometry, CORMaterial);
	CORMesh.visible = false;
	scene.add(CORMesh);

	//camera setup
	camera = new THREE.PerspectiveCamera( CometInfo.FOV, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(100, 100, 100);
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );
	
	// example makeDualSlider(filterFolder, "Meters per Pixel", 0, 10, .1, 1, params.MpP_duo, (vals)=>{applyMpPFilter(ogPhotoArray)});
    function makeDualSlider(folder, name, min, max, step, afterDec, valArray, funct) {
		// get div structure from html page
		const template = document.getElementById('sliderTemplate');
		const clone = template.cloneNode(true);
		clone.removeAttribute('hidden');
		const label = clone.querySelector('#nameNode');
		label.textContent = name;
        const slider = clone.querySelector('#sliderNode')
		const lowerSlider = clone.querySelector('#slider-lower');
		const upperSlider = clone.querySelector('#slider-upper');
		const sliderTrack = clone.querySelector('#slider-track'); 
		const sliderContainer = slider; // get rid of duplication
		const lowInput = clone.querySelector('#min');
		lowInput.value = min;
		const hiInput = clone.querySelector('#max');
		hiInput.value = max;

		// set slider properties
		lowerSlider.min = upperSlider.min = min;
		lowerSlider.max = upperSlider.max = max;
		lowerSlider.step = upperSlider.step = step;
		lowerSlider.value = valArray[0];
		upperSlider.value = valArray[1];

        // Append the slider to the children element
        const childrenElement = folder.domElement.querySelector('.children');   
        childrenElement.appendChild(clone);

		const roundDenom = 10**afterDec;  // number to divide by when rounding
	
		function update(event = null) {
			valArray[0] = lowerSlider.value;
			valArray[1] = upperSlider.value;
			funct(valArray);
		}
	
		let updateLowerHandle;  // will be set to true if the lower slider handle is being updated, false if the upper
		function moveNearestHandle(event, chooseHandle=false) {
			const rect = sliderTrack.getBoundingClientRect();
			const percentage = (event.clientX - rect.left) / rect.width;
			const newVal = min + percentage*(max-min);
			const lowerValue = parseFloat(lowerSlider.value);
			const upperValue = parseFloat(upperSlider.value);
		
			if (chooseHandle)
				updateLowerHandle = Math.abs(newVal - lowerValue) < Math.abs(newVal - upperValue);
	
			if (updateLowerHandle) {
				if (newVal < min)  						// out of range low
					lowerSlider.value = min;
				else if (newVal <= upperValue-step)		// in range
					lowerSlider.value = newVal;
				else 									// out of range high
					lowerSlider.value = upperValue-step;
				lowInput.value = lowerSlider.value;
			} else {
				if (newVal > max)						// out of range high
					upperSlider.value = max;
				else if (newVal >= lowerValue+step)		// in range
					upperSlider.value = newVal;
				else  									// out of range low
					upperSlider.value = lowerValue+step;
				hiInput.value = upperSlider.value;
			}
	
			event.stopImmediatePropagation();
			update();
			}
	
		function startDrag(event) {
			moveNearestHandle(event, true);
			document.addEventListener('pointermove', moveNearestHandle);
			document.addEventListener('pointerup', stopDrag);
		}
		
		function stopDrag(event) {
			moveNearestHandle(event);
			document.removeEventListener('pointermove', moveNearestHandle)
			document.removeEventListener('pointerup', stopDrag);
		}
	
		function updateSlider(event, index) { // function to update the valArray & slider from low or hi input fields
			let num = Number(event.target.value);
			if (!isNaN(num) && num >= min && num <= max && (num == Math.round(num*roundDenom)/roundDenom)) { // make sure that it's a number, in range, and 
				valArray[index] = num;
				[lowerSlider.value, upperSlider.value] = valArray;  // will not trigger slider callback...
				funct(valArray);									// ...so do it manually
			} else event.target.value= valArray[index];  // reset to old value if not valid
		}
		lowInput.addEventListener('input', (event) => { updateSlider(event, 0); });
		hiInput.addEventListener('input', (event) => { updateSlider(event, 1); });
		sliderContainer.addEventListener('pointerdown', startDrag);  
    }

	function adjustBrushMesh(val) {
		brushMesh.scale.setScalar(val/1000.0); // m to km
	}

	//GUI SETUP
	const gui = new dat.GUI();

	let skipForwardCtl, skipBackwardCtl;

	const helpFolder = gui.addFolder('Help Resources');
	helpFolder.add(params, 'quickstartHelp').name('Show Quickstart Help');

	const paintFolder = gui.addFolder('Paint Tools');
	const paintController = paintFolder.add(params, 'paint').name('Enable Paint').listen().onChange(function(value) { 
		controls.enabled = !value;
		if (!value) brushMesh.visible = false;
	 });
	paintFolder.add(params, 'brushSize').min(MINBRUSHSIZE).max(MAXBRUSHSIZE).step(MINBRUSHSIZE).listen().name('Brush Size').onChange(adjustBrushMesh);
	paintFolder.add(params, 'percentROI').name('Percent Overlap').min(1).max(100).step(1).onChange(function(value) {applyGeoFilter(ogPhotoArray)});
	paintFolder.add(params, 'clear').name('Clear Paint');
	
    const filterFolder = gui.addFolder('Image Filters');
    makeDualSlider(filterFolder, "Meters per Pixel", 0, 10, .1, 1, params.MpP_duo, (vals)=>{applyMpPFilter(ogPhotoArray)});
	makeDualSlider(filterFolder, "Emission Angle", 0, 90, 1, 0, params.emission_duo, (vals)=>{applyEmissionFilter(ogPhotoArray)});
	makeDualSlider(filterFolder, "Incidence Angle", 0, 90, 1, 0, params.incidence_duo, (vals)=>{applyIncidenceFilter(ogPhotoArray)});
    makeDualSlider(filterFolder, "Phase Angle", 0, 180, 1, 0, params.phase_duo, (vals)=>{applyPhaseFilter(ogPhotoArray)});

	const imageFolder = gui.addFolder('Image Display and Navigation');
	imageFolder.add(params, 'showImage',[SI_NONE, SI_UNMAPPED, SI_PERSPECTIVE, SI_ORTHOGRAPHIC]).name('Show Image').onChange(function(value) {showImage(value)});
	imageFolder.add(params, 'circleRegion').name('Encircle Region').onChange((val) => {overlayNeedsUpdate=true;});
    imageFolder.add(params, 'autoCam').name('Spacecraft View').onChange(function(value){spacecraftView(value);});
	//imageFolder.add(params, 'showPivot').name('Show Pivot');
	imageFolder.add(params, 'blueBox').name('Show Viewport').onChange(function(value){changeBox()});
	imageFolder.add(params, 'axes').name('Show Axes').onChange(function(value) {showAxes(value);});
	let myIndexSlider = imageFolder.add(params, 'photoIndex').min(0).step(1).max(1000).name('Image Index').listen().onChange(function(value){loadSlider()});
	imageFolder.add(params, 'loadNext').name('Next Image');
	imageFolder.add(params, 'loadPrevious').name('Previous Image');
	imageFolder.add(params, 'skipLength', ['Day', 'Month', 'Year']).name('Skip Duration').onChange(function(value) {
		skipForwardCtl.name('Skip Forward a ' + value);
		skipBackwardCtl.name('Skip Backward a ' + value);
	});
	skipForwardCtl = imageFolder.add(params, 'skipf').name('Skip Forward a ' + params.skipLength);
	skipBackwardCtl = imageFolder.add(params, 'skipb').name('Skip Backward a ' + params.skipLength);

	const printData = gui.addFolder('Image Data');
	printData.add(params, 'status').name('Matches').listen();
	printData.add(params, 'fileName').name('File Name').onChange(function(value){loadFilename(value)}).listen();
	printData.add(params, 'time').name('Time').listen();
	printData.add(params, 'photoInfo').name('Image Info').listen();
	printData.add(params, 'download').name('Download File Names');
	if (debugMode) {
		const debugFolder = gui.addFolder('Debug Tools');
		debugFolder.close();
		debugFolder.add(params, 'paintVisible').name('Paint Visible');
		debugFolder.add(params, 'paintSquare').name('Paint Square');
		debugFolder.add(params, 'memStats').name('Memory Stats');
		debugFolder.add(params, 'flatShading').name('Flat Shading').onChange( 
			function(boolFlat) {
				cometMaterial.flatShading = boolFlat;
				cometMaterial.needsUpdate = true;} );
	}
	gui.open();

	adjustBrushMesh(params.brushSize);

	function shiftCamera(cam) {
		const guiElement = document.querySelector('.lil-gui');
		const guiWidth = renderer.domElement.getBoundingClientRect().right - guiElement.getBoundingClientRect().left; // size of lil-gui panel + any right margin
		const canvasWidth = renderer.domElement.clientWidth; // Total width of the canvas in pixels
		const canvasHeight = renderer.domElement.clientHeight; // Total height of the canvas in pixels
		cam.setViewOffset(
			canvasWidth,             // Full width of the canvas
			canvasHeight,            // Full height of the canvas
			guiWidth/2,              // Offset x - start view after the GUI width/2
			0,                       // Offset y
			canvasWidth,  			 // Width of the viewable area excluding the GUI
			canvasHeight             // Full height of the viewable area
		);
		cam.updateProjectionMatrix();
		if (controls) controls.update();
	}

	shiftCamera(camera);
	
	function loadFilename(fn) {
		for (let i = 0; i < ogPhotoArray.length; i++) {
			if (fn == ogPhotoArray[i].nm) {
				loadComet(dynamicArray[i]);
				currentIndex = i;
				params.photoIndex = i;
			}
		}
	}

	download = function (filename, text) {  // Downloads filename with contents text. Thanks ChatGPT!
        var element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }
	
	function loadSlider() {
		loadComet(dynamicArray[params.photoIndex]);
		currentIndex = params.photoIndex;
	}

    function enableOverlayCanvas(enable) {
		if (enable) {
			threeCanvas.style.pointerEvents = 'none';
		} else {
			threeCanvas.style.pointerEvents = 'auto';
		}
	}

	function setFlatShading(boolFlat) {
		cometMaterial.flatShading = boolFlat;
		cometMaterial.needsUpdate = true
	}

	function showPaint(visible, newMode = null) {
		cometMaterial.vertexColors = visible;
		cometMaterial.needsUpdate = true;
		
		if (newMode != null) paintController.setValue(newMode);
	}

	let lastSI = SI_NONE;
	function showImage(val) {
		if (cometInfo) {
			// first undo last setting as necessary
			if (lastSI == SI_ORTHOGRAPHIC)
				cometInfo.removeDecal(scene);
			else if (lastSI == SI_PERSPECTIVE)
				cometInfo.removeProjection(cometMaterial);
			else if (lastSI== SI_UNMAPPED) {
				enableOverlayCanvas(false);
				cometInfo.removeImageForOverlay();
			}

			// then establish the new setting
			if (val == SI_ORTHOGRAPHIC) {
				//computeDepthInfo();
				cometInfo.addDecal(scene, targetMesh /*, paintInfo ? paintInfo.avgLoc : null*/);
				showPaint(false, false);
				setFlatShading(false);
			} else if (val == SI_PERSPECTIVE) {
				cometInfo.addProjection(targetMesh, cometMaterial);
				showPaint(false, false);
				setFlatShading(false);
			} else if (val == SI_UNMAPPED) {
				enableOverlayCanvas(true);
				cometInfo.LoadImageForOverlay(overlayCanvas);
				showPaint(false, false); // for consistency, painting mode => false
			} else if (val == SI_NONE) {
				showPaint(true);	// show paint, but do not change paint mode
				setFlatShading(true);
			}
		}
		overlayNeedsUpdate = true;
		lastSI = val;
	}

	function changeBox() {
		if (cometInfo) {
			if (params.blueBox) {
				cometInfo.addOutline(scene);
			}
			else {
				cometInfo.removeOutline(scene);
			}
		}
	}
	function showAxes(showThem) {
		if (showThem) {
			scene.add(zAxisLine);
			scene.add(yAxisLine);
			scene.add(xAxisLine);
		} else {
			scene.remove(zAxisLine);
			scene.remove(yAxisLine);
			scene.remove(xAxisLine);
		}
	}
	function spacecraftView(on) {
		if (on && cometInfo) 					
			cometInfo.applyToCamera(camera, controls);
		else {					// Allow rotations about center again
			controls.target = new THREE.Vector3(0, 0, 0);
			controls.update();
		}
		controls.dispatchEvent({ type: 'change' });
        overlayNeedsUpdate = true;
	}
	function cachePhotoInformation(ogPhotoArray) {
		for (let i = 0; i < ogPhotoArray.length; i++) {
			ogPhotoArray[i].sunHat = new THREE.Vector3(ogPhotoArray[i].su[0], ogPhotoArray[i].su[1], ogPhotoArray[i].su[2]).normalize();
			ogPhotoArray[i].sc_v = new THREE.Vector3(ogPhotoArray[i].sc[0], ogPhotoArray[i].sc[1], ogPhotoArray[i].sc[2]);
			ogPhotoArray[i].filter = 0;
			ogPhotoArray[i].ogIndex = i;
			const bboxMin = new THREE.Vector3(ogPhotoArray[i].b1[0], ogPhotoArray[i].b1[1], ogPhotoArray[i].b1[2]);
			const bboxMax = new THREE.Vector3(ogPhotoArray[i].b2[0], ogPhotoArray[i].b2[1], ogPhotoArray[i].b2[2]);
			ogPhotoArray[i].bbox = new THREE.Box3(bboxMin, bboxMax);
			//create date object which is time after 1970 and store it here!!!
			ogPhotoArray[i].date = new Date(ogPhotoArray[i].ti);
		}
	}

	function applyEmissionFilter(ogPhotoArray, doFilterCleanup = true) {
		const timer0 = clock.getElapsedTime();
		if (numPainted > 0) {
			for (let i = 0; i < ogPhotoArray.length; i++) {
				const avg_sc_vec = ogPhotoArray[i].sc_v.clone().sub(avgPosition).normalize();
				const angle = Math.acos(avgNormal.clone().dot(avg_sc_vec)) * 180/Math.PI;
				if (angle > params.emission_duo[1] || angle < params.emission_duo[0]){ 
					ogPhotoArray[i].filter |= FAIL_EMISSION;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_EMISSION;
				}
			}
		}
		if (doFilterCleanup) filterCleanUp();
		const timer1 = clock.getElapsedTime();
		console.log(`Emission filter: ${(timer1 - timer0)*1000} seconds`);
	}

	function applyMpPFilter(ogPhotoArray, doFilterCleanup = true) {
		if (!numPainted) {  // allow m2 filtering based on estimate stored in ogPhotoArray
			for (let i = 0; i < ogPhotoArray.length; i++) {
				if (ogPhotoArray[i].m2 > params.MpP_duo[1] || ogPhotoArray[i].m2 < params.MpP_duo[0]) {
					ogPhotoArray[i].filter |= FAIL_MPP;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_MPP;
				}
			} 
		} else {				// do m2 filtering based on painted region
			const maxDist = (params.MpP_duo[1] * (.001*(cometInfo.imageRes/2))) / Math.tan(Math.PI*(CometInfo.FOV/2.0)/180.0);
			const minDist = (params.MpP_duo[0] * (.001*(cometInfo.imageRes/2))) / Math.tan(Math.PI*(CometInfo.FOV/2.0)/180.0);
			const maxDistSquared = maxDist*maxDist;
			const minDistSquared = minDist*minDist;
			for (let i = 0; i < ogPhotoArray.length; i++) {
				const trueDistSquared = ogPhotoArray[i].sc_v.distanceToSquared(avgPosition);
				if (trueDistSquared > maxDistSquared || trueDistSquared < minDistSquared) {
					ogPhotoArray[i].filter |= FAIL_MPP;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_MPP;
				}
			} 
		}
		if (doFilterCleanup) filterCleanUp();
	}

	function applyIncidenceFilter(ogPhotoArray, doFilterCleanup = true) {
		if (numPainted > 0) {
			for (let i = 0; i < ogPhotoArray.length; i++) {
				const angle = Math.acos(ogPhotoArray[i].sunHat.dot(avgNormal)) * 180/Math.PI; 
				if (angle > params.incidence_duo[1] || angle < params.incidence_duo[0]) {
					ogPhotoArray[i].filter |= FAIL_INCIDENCE;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_INCIDENCE;
				}
			}
		}
		if (doFilterCleanup) filterCleanUp();
	}

	function applyPhaseFilter(ogPhotoArray, doFilterCleanup = true){
		if (numPainted > 0) {
			for (let i = 0; i < ogPhotoArray.length; i++){
				const scHat = ogPhotoArray[i].sc_v.clone().sub(avgPosition).normalize();
				const angle = Math.acos(scHat.dot(ogPhotoArray[i].sunHat)) * 180/Math.PI;
				if (angle > params.phase_duo[1] || angle < params.phase_duo[0]){
					ogPhotoArray[i].filter |= FAIL_PHASE;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_PHASE
				}
			}
		}
		if (doFilterCleanup) filterCleanUp();
	}
	
	applyGeoFilter = function (ogPhotoArray, doFilterCleanup = true) {
		startTimer = clock.getElapsedTime();
		if (numPainted > 0) {
			initBBOXBitBuffer(ogPhotoArray.length);
			if (typeof roiBoundingBox !== "undefined") {
				for (let i = 0; i < ogPhotoArray.length; i++) {
					if (roiBoundingBox.intersectsBox(ogPhotoArray[i].bbox)) {
							setNthBit(i, bboxBitArray);
					}
				}
				const mustMatch = Math.ceil(numPainted*params.percentROI/100);
				socket.emit('clientRequestsVis', {mustMatch: mustMatch, imgSel: bboxBitArray, visAr: paintArray});
			}
		} else {  // nothing is painted, so all images pass
			for (let i = 0; i < ogPhotoArray.length; i++)
				ogPhotoArray[i].filter &= ~FAIL_BBOX;
			if (doFilterCleanup) filterCleanUp();
		}
	}

	socket.on('serverProvidesVis', function(message) {
		const newBBoxBitArray = new Uint8Array(message);
		for (let i = 0; i < ogPhotoArray.length; i++){
			if (getNthBit(i, newBBoxBitArray) === 1) {
				ogPhotoArray[i].filter &= ~FAIL_BBOX;
			}
			else {
				ogPhotoArray[i].filter |= FAIL_BBOX;
			}
		}
		filterCleanUp();
		endTimer = clock.getElapsedTime();
		console.log(`Visibility check: ${(endTimer-startTimer)*1000} milliseconds`)
	});

	// let the server know on client shutdown, so it too can shut down if running locally
	window.addEventListener('beforeunload', () => {  
		socket.emit('clientShutdown'); 
	});
	
	updateAllFilters = function (ogPhotoArray) {
		for (let i = 0; i < ogPhotoArray.length; i++)
			ogPhotoArray[i].filter = 0;		// all pass by default
		applyMpPFilter(ogPhotoArray, false);
		applyEmissionFilter(ogPhotoArray, false);
		applyIncidenceFilter(ogPhotoArray, false);
		applyGeoFilter(ogPhotoArray, false);
		applyPhaseFilter(ogPhotoArray, false);
		filterCleanUp();   // just one cleanup at the end
	}

	function filterCleanUp() {
		dynamicArray = ogPhotoArray.filter((item) => item.filter === 0);
		params.status = `${dynamicArray.length} / ${ogPhotoArray.length} matches`;
		myIndexSlider.max(Math.max(0, dynamicArray.length-1));

		if (cometInfo) {
			const newIndex = dynamicArray.findIndex(info => info === ogPhotoArray[cometInfo.ogIndex]);
			currentIndex = newIndex >= 0 ? newIndex : 0;
			if (dynamicArray.length > 0) { 
				loadComet(dynamicArray[currentIndex]);
				myIndexSlider.enable();
			}
			else {
				unloadComet();			   // no image matches, so have to unload current cometInfo
				myIndexSlider.disable();	// necessary?
			}
			params.photoIndex = currentIndex;
		}
	}

    function visiblePaintedVertices(sc) {
        let visibleVerts = [];
        const raycaster = new THREE.Raycaster();
        let res = [];
        const v = new THREE.Vector3();
        raycaster.firstHitOnly = true;
        const vertexNormal = new THREE.Vector3();
        const dotLimit = Math.cos(params.filterAngle * Math.PI / 180.);
    
        for (let i = 0; i < cometGeometry.attributes.position.array.length; i+=3) {
            if (colorArray[i] == BRUSH_RED) {
                // first do normals check
                const vertToSC = v.clone().sub(sc);
                const scToVertNormed = vertToSC.clone().negate().normalize();
                vertexNormal.x = cometGeometry.attributes.normal.array[i];
                vertexNormal.y = cometGeometry.attributes.normal.array[i+1];
                vertexNormal.z = cometGeometry.attributes.normal.array[i+2];
                if (!params.useNormals || vertexNormal.dot(scToVertNormed) >= dotLimit) {   // vertex passes normal filter
                    let v = new THREE.Vector3();
                    v.x = cometGeometry.attributes.position.array[i] + .000001; // perturb by a milimeter so it doesn't go through the vertex
                    v.y = cometGeometry.attributes.position.array[i+1] + .000001;
                    v.z = cometGeometry.attributes.position.array[i+2] + .000001;
                    const theoreticalDistance = v.distanceTo(sc);
                    raycaster.set(sc, v.clone().sub(sc));
                    res.length = 0;
                    res = raycaster.intersectObject( targetMesh, true, res );
                    if (res.length > 0) {
                        if (Math.abs(res[0].distance - theoreticalDistance) < .001) // less than a meter
                            visibleVerts.push(v.clone());
                    }
                }
            }
        }
        return visibleVerts;
    }
    

    function overlayGetCircle() {
		if (!numPainted) return null;
		let circleCam;
		if (params.showImage != SI_UNMAPPED)
			circleCam = camera;    // Can simply use main camera
		else {  // Unmapped - so set circleCam to spacecraftCam equivalent and shift it
			circleCam = new THREE.PerspectiveCamera();
			cometInfo.applyToCamera(circleCam);
			shiftCamera(circleCam); 
		}
		let centerVec = avgPosition.clone();
		centerVec.project(circleCam);
		const x = (centerVec.x * 0.5 + 0.5) * window.innerWidth;
		const y = (centerVec.y * -0.5 + 0.5) * window.innerHeight;
		let maxSquared = 0;
		const visiblePainted = visiblePaintedVertices(circleCam.position.clone());
		for (let i = 0; i < visiblePainted.length; i++) {
			let thisVec = visiblePainted[i];
			thisVec.project(circleCam);
			thisVec.x = (thisVec.x * 0.5 + 0.5) * window.innerWidth;
			thisVec.y = (thisVec.y * -0.5 + 0.5) * window.innerHeight;
			let deltaX = thisVec.x - x;
			let deltaY = thisVec.y - y;
			let deltaSquared = deltaX*deltaX + deltaY*deltaY;
			if (deltaSquared > maxSquared) maxSquared = deltaSquared;
		}
		return([x, y, Math.sqrt(maxSquared)]);
	}

	function overlayPaintCircle () {		// so can be accessed earlier
		if (overlayNeedsUpdate && params.showImage != SI_NONE && params.circleRegion && !haltCircle) {
			let rval = overlayGetCircle();
			if (!rval) return;	// nothing to paint
			let x=rval[0], y=rval[1], radius=rval[2];
	
			const ctx = overlayCanvas.getContext('2d');
			ctx.beginPath();
			ctx.arc(x, y, radius, 0, Math.PI * 2); // Center at (x, y) with a radius of 50
			ctx.strokeStyle = 'red';
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	};

	function drawImageOnOverlay(overlayCanvas, img) {
		const ctx = overlayCanvas.getContext('2d');
		const canvasWidth = overlayCanvas.width, canvasHeight = overlayCanvas.height;
		const guiElement = document.querySelector('.lil-gui');
		const guiWidth = renderer.domElement.getBoundingClientRect().right - guiElement.getBoundingClientRect().left;
	
		if (params.showImage != SI_UNMAPPED) { // Clear the overlay if it does not contain an image
			ctx.clearRect(0, 0, canvasWidth, canvasHeight);
			return;
		}
	
		const aspectRatio = img.width / img.height;
	
		// Scale the image height to fit the canvas height
		const drawHeight = canvasHeight;
		const drawWidth = drawHeight * aspectRatio;
	
		// Calculate the available width (canvas width minus gui width)
		const availableWidth = canvasWidth - guiWidth;
	
		// Calculate the x position to center the image within the available space
		const x = (availableWidth - drawWidth) / 2;
		const y = 0; // Start drawing at the top of the canvas
	
		ctx.fillStyle = 'black';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight); // Black background
		ctx.drawImage(img, x, y, drawWidth, drawHeight); // Draw the image centered
	}

	refreshOverlay = function () {
		if (CometInfo.map && CometInfo.map.image && cometInfo && cometInfo.imageFresh && overlayNeedsUpdate) {
			drawImageOnOverlay(overlayCanvas, CometInfo.map.image);
			overlayPaintCircle();
			overlayNeedsUpdate = false;
		}
	};


	const url = urlPrefix + "imageMetadataV3.5.json"; // hardwired json file - not ideal
	fetch(url) 	// Fetch the JSON file
	.then(response => response.json()) // Parse the response as JSON
	.then(data => {  // Now "data" contains the parsed JSON object
		ogPhotoArray = data;
		cachePhotoInformation(ogPhotoArray);
		updateAllFilters(ogPhotoArray);
		myIndexSlider.max(dynamicArray.length);
		if (targetMesh) {
			params.loadPicture();
		}
	})
	.catch(error => {
		console.error('Error loading JSON:', error);
	});

	function drawBrush(doPaint) {	// draws the Brush, painting at the brush if doPaint == true
		if (typeof targetMesh === "undefined") return;
		const geometry = targetMesh.geometry;
		const bvh = geometry.boundsTree;
		const colorAttr = geometry.getAttribute('color');
		const indexAttr = geometry.index;

		if (params.paint) {
 			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera( mouse, camera );
			raycaster.firstHitOnly = true;

			const res = raycaster.intersectObject(targetMesh, true);
			if (res.length) {
				brushMesh.position.copy(res[0].point);
				brushMesh.visible = true;

				if (doPaint) {
					const inverseMatrix = new THREE.Matrix4();
					inverseMatrix.copy(targetMesh.matrixWorld).invert();

					const sphere = new THREE.Sphere();
					sphere.center.copy(brushMesh.position).applyMatrix4(inverseMatrix);
					sphere.radius = params.brushSize/1000.0; // m to km;

					const indices = [];
					const tempVec = new THREE.Vector3();
					bvh.shapecast( {
						intersectsBounds: box => {
							const intersects = sphere.intersectsBox( box );
							const { min, max } = box;
							if ( intersects ) {
								for ( let x = 0; x <= 1; x ++ ) {
									for ( let y = 0; y <= 1; y ++ ) {
										for ( let z = 0; z <= 1; z ++ ) {
											tempVec.set(
												x === 0 ? min.x : max.x,
												y === 0 ? min.y : max.y,
												z === 0 ? min.z : max.z
											);
											if ( ! sphere.containsPoint( tempVec ) ) {
												return INTERSECTED;
											}
										}
									}
								}
								return CONTAINED;
							}
							return intersects ? INTERSECTED : NOT_INTERSECTED;
						},
						intersectsTriangle: ( tri, i, contained ) => {
							if ( contained || tri.intersectsSphere( sphere ) ) {
								const i3 = 3 * i;
								indices.push( i3, i3 + 1, i3 + 2 );
							}
							return false;
						}
					} );

					if ( mouseType === 0 || mouseType === 2 ) {
						r = 1, g = 1, b = 1;
						if ( mouseType === 0 ) {
							r = 15;
							g = 78;
							b = 85;
						}
						for ( let i = 0, l = indices.length; i < l; i ++ ) {
							const i2 = indexAttr.getX( indices[ i ] );
							colorAttr.setX( i2, r );
							colorAttr.setY( i2, g );
							colorAttr.setZ( i2, b );
						}
						colorAttr.needsUpdate = true;
					}
				}
			} else {
				brushMesh.visible = false;
			}
		}	
	}

	
	function CORAtMouse(setCOR) {
		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( mouse, camera );
		raycaster.firstHitOnly = true;

		const res = raycaster.intersectObject(targetMesh, true);
		if (res.length) {
			CORMesh.position.copy(res[0].point);
			CORMesh.visible = true;
			if (setCOR) {
				oldCOR = controls.target.clone();
				const newCOR = res[0].point.clone();
				deltaCOR = newCOR.clone().sub(oldCOR);
				t0COR = clock.getElapsedTime();
			}
		} else CORMesh.visible = false;
	}

	window.addEventListener('resize', function () {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );
	
    	overlayCanvas.width = window.innerWidth;
		overlayCanvas.height = window.innerHeight;
		shiftCamera(camera);
	
		if (params.showImage != SI_NONE)
			overlayNeedsUpdate = true;
    }, false );

	renderer.domElement.addEventListener('pointermove', function ( e ) {
		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		if (params.paint) {
			drawBrush(pointerDown);
		} else if (CORMode) {
			CORAtMouse();
		}
	} );

	renderer.domElement.addEventListener('pointerdown', function (e) {
        haltCircle = true;
		overlayNeedsUpdate = true;		// so that circle is erased
		pointerDown = true;
		CORMesh.visible = true;				// default for during Trackball motion
		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		mouseType = e.button;
        if (params.paint) {
			drawBrush(pointerDown);
			CORMesh.visible = false;		// hide mesh while painting
        } else if (mouseType == 2 && !e.shiftKey) { 	// COR Mode: non-paint and right mouse and no shiftkey
			controls.enabled = false;
			CORMode = true;
			CORAtMouse();
		}						 // Panning: non-paint and right mouse and shiftkey: nothing else needed
	}, true );

	renderer.domElement.addEventListener('pointerup', function ( e ) {
		haltCircle = false;
		overlayNeedsUpdate = true;
		pointerDown = false;
		CORMesh.visible = false;
        if (params.paint) {
			mouseType = - 1;
			if (e.pointerType === 'touch') // disable the brush visualization when the pointer action is done only if it's on a touch device.
				brushMesh.visible = false;
			params.returnPainted();
		} else if (CORMode) {
			CORAtMouse(true);
			CORMode = false;
			controls.enabled = true;
		}
	}, true );

	window.addEventListener('wheel', function ( e ) {
		if (params.paint) {
			let delta = e.deltaY; 
			
            if (e.deltaMode === 1 || e.deltaMode ===2) { // line or page scroll mode
                delta *= 10;
            }
			params.brushSize += delta/150 * 10;
			params.brushSize = Math.max(Math.min( params.brushSize, MAXBRUSHSIZE), MINBRUSHSIZE);
			params.brushSize = Math.round(params.brushSize);
			adjustBrushMesh(params.brushSize);
		} else overlayNeedsUpdate = true;   // overlay highlight moves on camera change
	} );

	// dblclick - set rotations about center again
	renderer.domElement.addEventListener('dblclick', (event) => {
		if (event.button === 0) {  // Left button double-click
			controls.target = new THREE.Vector3(0, 0, 0);
			controls.update();
			controls.dispatchEvent({ type: 'change' });
		}
	});

	renderer.domElement.addEventListener( 'contextmenu', function ( e ) {
		e.preventDefault();
	} );


	controls = new TrackballControls(camera, renderer.domElement);
	controls.rotateSpeed = 4;
	controls.zoomSpeed = 4;
	controls.panSpeed = 0.05;
	controls.staticMoving = true;
	controls.maxDistance = 490;

	controls.addEventListener('change', (event) => {
		updateCameraClipping();
		CORMesh.position.copy(controls.target);
	});
}

function animateCOR() {		// animates the COR and sets visibility
	if (t0COR >= 0) {
		haltCircle = true;
		const deltaT = clock.getElapsedTime() - t0COR;
		const percentComplete = Math.min(deltaT / intervalCOR, 1);
		const thisCOR = oldCOR.clone().add(deltaCOR.clone().multiplyScalar(percentComplete));
		controls.target = thisCOR;
		controls.update();
		updateCameraClipping();
		if (percentComplete == 1) {			// done - cleanup!
			t0COR = -1;
			haltCircle = false;
			overlayNeedsUpdate = true;
			CORMesh.visible = false;
		}
	}
}

const COMETRADIUS = 50;	// much bigger than the radius of the comet bounding sphere. Making this too small causes flickering during rotate.

let updateCameraClipping = function updateCameraClipping() {
	// Transform origin (comet center) to the camera's local space
	const origin = new THREE.Vector3(0, 0, 0);
	const cameraLocalPosition = new THREE.Vector3();
	cameraLocalPosition.copy(origin).applyMatrix4(camera.matrixWorldInverse);
	const viewingZDistance = -cameraLocalPosition.z;  // will be negative distance to origin

	// Set clipping planes (too close, even if correct, causes flicker!)
	camera.near = Math.max(viewingZDistance - COMETRADIUS, .1);
	camera.far = Math.max(viewingZDistance + COMETRADIUS, .1);
	camera.updateProjectionMatrix();
}

function render() {
	requestAnimationFrame(render);
	stats.begin();
	controls.update();
	
	animateCOR();

    const skipRender = cometInfo && (params.showImage != SI_NONE)  && !cometInfo.imageFresh;
	if (!skipRender) {
		renderer.render(scene, camera);
        refreshOverlay();
    } else console.log("Skipping render");
	
	stats.end();
}

init();
render();
