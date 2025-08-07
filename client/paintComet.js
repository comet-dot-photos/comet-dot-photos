import Stats from './node_modules/three/examples/jsm/libs/stats.module.js';
import * as dat from './node_modules/three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from './node_modules/three/build/three.module.js';
import { TrackballControls } from './node_modules/three/examples/jsm/controls/TrackballControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CONTAINED, INTERSECTED, NOT_INTERSECTED } from './node_modules/three-mesh-bvh/src/index.js';
import { OBJLoader2 } from './node_modules/wwobjloader2/dist/OBJLoader2.js';
import ProjectedMaterial from '../node_modules/three-projected-material/build/ProjectedMaterial.module.js';
import {CometView, NormalDepth} from './cometView.js';

const dataset = {
	model:"cg-dlr_spg-shap7-v1.0_200Kfacets.obj",
	metaData: "imageMetadataV2.0.json",
	visTable: "visTableV2.0.bin",
	FOV: 2.20746,
	defaultRes: 2048,
	initialEye: [100, 100, 100],
	longName: "NAC Comet Photos",
	shortName: "NAC",
	dataFolder: "",
	modelFolder: "",
};

let urlPrefix = "";
let stats;
let scene, camera, renderer, controls, colorArray, colorAttr, r, b, g;
let threeCanvas, overlayCanvas;
let targetMesh, cometMaterial, cometGeometry;
let mouse = new THREE.Vector2();
let mouseType = - 1;
let cometView = null;
let ogPhotoArray, dynamicArray;
let avgNormal, avgPosition, roiBoundingBox;
let applyGeoFilter, updateAllFilters, download;
let numPainted = 0;
let bboxBitBuffer, bboxBitArray, paintBuffer, paintArray;
let xAxisLine, yAxisLine, zAxisLine;
let refreshOverlay, overlayNeedsUpdate = true, haltCircle = false, pointerDown = false;
let CORMode = false, CORMesh;
let oldCOR, deltaCOR, intervalCOR = 1, t0COR = -1;
let debugMode = false, preprocessMode = false;
let startTimer, endTimer;	// just for measuring speed

// Store a session ID for the server. Only used when running locally to shutdown
//   the server after all clients disconnect
function generateSessionID() {	
	return '_' + Math.random().toString(36).substring(2, 11);
 };

var socket = io({
	query: {
	  clientID: generateSessionID()
	},
  });

// Specify Colors
const PAINT_RED = 241, PAINT_GREEN = 178, PAINT_BLUE = 171;	  // color of painted region
const BRUSH_COLOR = 0xEC407A; // color of brush sphere
const COR_COLOR = 0x007090; // color of center of rotation sphere
const VISIBLE_BLUE= 249;  // blue component - for preprocessing visibility
const COMETGREYVAL = 255;
const COMETCOLOR = COMETGREYVAL<<16 | COMETGREYVAL<<8 | COMETGREYVAL;

// Filter failure bit position codes
const FAIL_MPP = 1;
const FAIL_EMISSION = 2;
const FAIL_PHASE = 4;
const FAIL_BBOX = 8;
const FAIL_INCIDENCE = 16;

// Time constants
const msDay = 86400000;
const msMonth = 2628000000;
const msYear = 31536000000;


const MINBRUSHSIZE = 5, MAXBRUSHSIZE = 200, INITBRUSHSIZE = 100;
const SI_NONE = "None", SI_UNMAPPED = "Unmapped 2D", SI_PERSPECTIVE = "Perspective", SI_ORTHOGRAPHIC = "Orthographic";

var currentIndex = 0;

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

function initPaintBuffer() {
	if (typeof paintBuffer === "undefined") {
		const numBytes = Math.ceil(cometGeometry.attributes.position.count/64)*8;  // each on a 64 bit boundary for efficiency if we address outside of Javascript
		paintBuffer = new ArrayBuffer(numBytes);
		paintArray = new Uint8Array(paintBuffer);
	}
	else {
		paintArray.fill(0);
	}
}

function updatePaintBuffer() {
	initPaintBuffer();
	let i = 2;
	let vertIndex = 0;
	const arraySize = colorArray.length;
	while (i < arraySize) {
		if (colorArray[i] == VISIBLE_BLUE) { 		// visibility blue :-) - made a unique byte so we only have to check blues
			setNthBit(vertIndex, paintArray);
		}
		i += 3;
		vertIndex++;
	}
}

function setNthBit(i, bitArray) {
	let index = Math.floor(i / 8);
	let pos = i % 8;
	bitArray[index] |= (1 << pos);
}

function getNthBit(n, bitArray) {
	let index = Math.floor(n / 8);
	let pos = n % 8;
	return (bitArray[index] & (1 << pos)) >> pos;
}

//clock - used for benchmarking
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
		colorArray.fill(COMETGREYVAL);
		colorAttr.needsUpdate = true;
		numPainted = 0;
		updateAllFilters(ogPhotoArray);
		params.photoInfo = getInfoString(dynamicArray[params.photoIndex]);
		overlayNeedsUpdate = true;
	},
	paintVisible: function () { computeVisibleVertices(true);},
	preProcess: function () { preProcess();},
	showImage: SI_NONE,
    circleRegion: true,
	blueBox: false,
	axes: false,
	autoCam: false,
	loadFirst: function() {
		loadComet(dynamicArray[0]);
		this.photoIndex = 0;
		currentIndex = 0;
	},
	loadNext: function() {
		if (cometView) {
			if (currentIndex != dynamicArray.length-1) {
				loadComet(dynamicArray[currentIndex + 1]);
				currentIndex += 1;
				this.photoIndex += 1;
			}
		}
	},
	loadPrevious: function() {
		if (cometView) {
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
		initPaintBuffer();
		roiBoundingBox = new THREE.Box3();
		numPainted = 0;
        let loc = new THREE.Vector3(0, 0, 0);
        let norm = new THREE.Vector3(0, 0, 0);
        let thisVec = new THREE.Vector3();
		for (let i = 0; i < cometGeometry.attributes.color.array.length; i+=3) {
			if (cometGeometry.attributes.color.array[i] == PAINT_RED) {
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
		if (cometView) {
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
		if (cometView) {
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
	else return CometView.defaultRes;
}

function getInfoString(photoDict) {
	if (!numPainted) return `#${photoDict.ogIndex}  m: ${photoDict.m2}`;
	const avg_sc_vec = photoDict.sc_v.clone().sub(avgPosition).normalize();
	const emissionAngle = Math.round(Math.acos(avg_sc_vec.dot(avgNormal))*180/Math.PI);
	const sun_vec = photoDict.sunHat;
	const incidAngle = Math.round(Math.acos(sun_vec.dot(avgNormal))*180/Math.PI);
	const phaseAngle = Math.round(Math.acos(avg_sc_vec.dot(sun_vec))*180/Math.PI);
	const rez = getResFromPhotoDict(photoDict);
	const width = Math.tan(Math.PI*(CometView.FOV/2.0)/180.0) * photoDict.sc_v.distanceTo(avgPosition);
	const m2 = Math.round(width/(.001*(rez/2)) * 100) / 100;
	return `#${photoDict.ogIndex}  m: ${m2}  e: ${emissionAngle}  i: ${incidAngle}  p: ${phaseAngle}`;
}

function loadComet(photoDict) {
	if (cometView) {
		if (cometView.ogIndex === photoDict.ogIndex) return;		// trying to load what is already loaded
		cometView.removeSelf(scene);		// remove the old one
	}
	cometView = new CometView(photoDict);

	if (params.blueBox)
		cometView.addOutline(scene);
    if (params.showImage == SI_ORTHOGRAPHIC) cometView.addDecal(scene, targetMesh /*, paintInfo ? paintInfo.avgLoc : null*/);
    if (params.showImage == SI_PERSPECTIVE) cometView.addProjection(targetMesh, cometMaterial);
    if (params.showImage == SI_UNMAPPED)
        cometView.LoadImageForOverlay(overlayCanvas);
 
    overlayNeedsUpdate = true;
    if (params.autoCam) {
		cometView.applyToCamera(camera, controls);
		controls.dispatchEvent({ type: 'change' });
	}
	params.fileName = cometView.fileName;
	params.time = cometView.time;
	params.photoInfo = getInfoString(photoDict);
}

function drawNoMatchesOverlay() {
	const ctx = overlayCanvas.getContext('2d');
	const canvasWidth = overlayCanvas.width, canvasHeight = overlayCanvas.height;
	const guiElement = document.querySelector('.lil-gui');
	const guiWidth = renderer.domElement.getBoundingClientRect().right - guiElement.getBoundingClientRect().left;

	if (params.showImage == SI_UNMAPPED) {
		ctx.fillStyle = 'black';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight); // Black background
	} else {
		ctx.clearRect(0, 0, canvasWidth, canvasHeight); // Clear - let comet show through
	}

	ctx.font = '60px Arial';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#9400D3';
	ctx.fillText('No Matching Images', (canvasWidth - guiWidth) / 2, canvasHeight / 2);
}

// only called if there are no matches, and the current cometView must be unloaded
function unloadComet() {
	if (cometView) {
		if (params.showImage == SI_ORTHOGRAPHIC) cometView.removeDecal(scene);
		if (params.showImage == SI_PERSPECTIVE) cometView.removeProjection(cometMaterial);
		CometView.lastRequestedImg = "";		// stop pending image requests from loading
		// Note: for SI_UNMAPPED, image will be automatically erased by the no matches overlay
		cometView.removeSelf(scene);
		params.fileName = "";
		params.time = "";
		params.photoInfo = "No matching images";
		cometView = null;
		overlayNeedsUpdate = true;   // may trigger No Matches overlay
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
	CometView.urlPrefix = urlPrefix;
	preprocessMode = searchParams.has('preprocess');
	debugMode = searchParams.has('debug') || preprocessMode;
	
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

	CometView.FOV = dataset.FOV;			// Load relevant dataset parameters
	CometView.defaultRes = dataset.defaultRes;

	// scene setup
	scene = new THREE.Scene();
	
	const light = new THREE.DirectionalLight(0xffffff, 0.5);
	light.position.set( 1, 1, 1 );
	const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
	light2.position.set( -1, -1, -1);
	scene.add( light );
	scene.add(light2);
	scene.add(new THREE.AmbientLight( 0xffffff, 0.4 ));

	//ADD AXES
	function createAxes() {
		const AXIS_LENGTH = 4;
		const xMaterial = new THREE.LineBasicMaterial({color: 0xff0000});
		const yMaterial = new THREE.LineBasicMaterial({color: 0x00ff00});
		const zMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});
	
		const origin = new THREE.Vector3(0,0,0);
		const XAxisGeo = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(AXIS_LENGTH,0,0)]);
		const YAxisGeo = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(0,AXIS_LENGTH,0)]);
		const ZAxisGeo = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(0,0,AXIS_LENGTH)]);
	
		xAxisLine = new THREE.Line(XAxisGeo, xMaterial);
		yAxisLine = new THREE.Line(YAxisGeo, yMaterial);
		zAxisLine = new THREE.Line(ZAxisGeo, zMaterial);
	}
	createAxes();

	const modelPath = urlPrefix + dataset.model; 
	const objLoader2 = new OBJLoader2().setUseIndices(true);

	const loadData = (object3d) => {
        cometGeometry = object3d.children[0].geometry;
        cometGeometry.computeVertexNormals();                
        colorArray = new Uint8Array( cometGeometry.attributes.position.count * 3 );
		colorArray.fill(COMETGREYVAL);
		colorAttr = new THREE.BufferAttribute( colorArray, 3, true );
		colorAttr.setUsage( THREE.DynamicDrawUsage );
		cometGeometry.setAttribute( 'color', colorAttr );
        cometMaterial = new ProjectedMaterial ({ 
            cover: false,
			color: COMETCOLOR,
			transparent: false,
			opacity: 1.0,
			vertexColors: true,
			flatShading: params.flatShading
            });
		targetMesh = new THREE.Mesh( cometGeometry, cometMaterial );
		targetMesh.geometry.computeBoundsTree();
		scene.add( targetMesh );
		if (ogPhotoArray) { //if photo array loaded then load first
			params.loadFirst();
		}
    };


	objLoader2.load(modelPath, loadData);


	const brushGeometry = new THREE.SphereGeometry(1, 40, 40);
	const brushMaterial = new THREE.MeshStandardMaterial( {
		color: BRUSH_COLOR,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		opacity: 0.5,
		premultipliedAlpha: true,
		emissive: BRUSH_COLOR,
		emissiveIntensity: 0.5,
	} );
	const brushMesh = new THREE.Mesh(brushGeometry, brushMaterial);
	brushMesh.visible = false;
	scene.add(brushMesh);

	const CORGeometry = new THREE.SphereGeometry(.05, 40, 40);
	const CORMaterial = new THREE.MeshStandardMaterial( {
		color: COR_COLOR,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		opacity: .5,
		premultipliedAlpha: true,
		emissive: COR_COLOR,
		emissiveIntensity: 1.0, //0.5,
	} );
	CORMesh = new THREE.Mesh(CORGeometry, CORMaterial);
	CORMesh.visible = false;
	scene.add(CORMesh);

	//camera setup
	camera = new THREE.PerspectiveCamera(CometView.FOV, window.innerWidth / window.innerHeight, 0.1, 500);
	camera.position.set(...dataset.initialEye);
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild(stats.dom);
	
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
		if (value && (params.showImage == SI_UNMAPPED || params.showImage == SI_ORTHOGRAPHIC))
			showImageController.setValue(SI_NONE);
		adjustShading();
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
	const showImageController = imageFolder.add(params, 'showImage',[SI_NONE, SI_UNMAPPED, SI_PERSPECTIVE, SI_ORTHOGRAPHIC]).name('Show Image').onChange(function(value) {showImage(value)});
	imageFolder.add(params, 'circleRegion').name('Encircle Region').onChange((val) => {overlayNeedsUpdate=true;});
    imageFolder.add(params, 'autoCam').name('Spacecraft View').onChange(function(value){spacecraftView(value);});
	imageFolder.add(params, 'blueBox').name('Show Viewport').onChange(function(value){changeBox()});
	imageFolder.add(params, 'axes').name('Show Axes').onChange(function(value) {showAxes(value);});
	let indexSlider = imageFolder.add(params, 'photoIndex').min(0).step(1).max(1000).name('Image Index').listen().onChange(function(value){loadSlider()});
	let nextCtl = imageFolder.add(params, 'loadNext').name('Next Image');
	let previousCtl = imageFolder.add(params, 'loadPrevious').name('Previous Image');
	let skipCtl = imageFolder.add(params, 'skipLength', ['Day', 'Month', 'Year']).name('Skip Duration').onChange(function(value) {
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
		debugFolder.add(params, 'preProcess').name('Pre-Process');
		debugFolder.add(params, 'paintVisible').name('Paint Visible');
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

	function showPaint(visible) {
		cometMaterial.vertexColors = visible;
		cometMaterial.needsUpdate = true;
	}

	function enableImageNavigation (enable) {
		if (enable) {
			indexSlider.enable();
			nextCtl.enable();
			previousCtl.enable();
			skipCtl.enable();
			skipForwardCtl.enable();
			skipBackwardCtl.enable();
		} else {
			indexSlider.disable();
			nextCtl.disable();
			previousCtl.disable();
			skipCtl.disable();
			skipForwardCtl.disable();
			skipBackwardCtl.disable();
		}
	}

	let adjustShading = function () {
		if (params.paint || params.showImage == SI_NONE) {
			setFlatShading(true);
			showPaint(true);
		} else {
			setFlatShading(false);
			showPaint(false);
		}
	}

	let lastSI = SI_NONE;
	function showImage(val) {
		// first undo last setting as necessary
		if (lastSI == SI_ORTHOGRAPHIC) {
			if (cometView) cometView.removeDecal(scene);
		} else if (lastSI == SI_PERSPECTIVE) {
			if (cometView) cometView.removeProjection(cometMaterial);
		} else if (lastSI == SI_UNMAPPED) {
			enableOverlayCanvas(false);
		}

		// then establish the new setting
		if (val == SI_ORTHOGRAPHIC) {
			if (cometView) cometView.addDecal(scene, targetMesh /*, paintInfo ? paintInfo.avgLoc : null*/);
		} else if (val == SI_PERSPECTIVE) {
			if (cometView) cometView.addProjection(targetMesh, cometMaterial);
		} else if (val == SI_UNMAPPED) {
			enableOverlayCanvas(true);
			if (cometView) cometView.LoadImageForOverlay(overlayCanvas);
		} 

		if (val != SI_NONE) paintController.setValue(false);		// set paint to false if entering a true image display - note this calls adjustShading();
		else adjustShading();
		overlayNeedsUpdate = true;
		lastSI = val;
	}

	function changeBox() {
		if (cometView) {
			if (params.blueBox) {
				cometView.addOutline(scene);
			}
			else {
				cometView.removeOutline(scene);
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
		if (on && cometView) 					
			cometView.applyToCamera(camera, controls);
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
			if (!preprocessMode) {  // bbox is calculated during preprocessMode
				const bboxMin = new THREE.Vector3(ogPhotoArray[i].b1[0], ogPhotoArray[i].b1[1], ogPhotoArray[i].b1[2]);
				const bboxMax = new THREE.Vector3(ogPhotoArray[i].b2[0], ogPhotoArray[i].b2[1], ogPhotoArray[i].b2[2]);
				ogPhotoArray[i].bbox = new THREE.Box3(bboxMin, bboxMax);
			}
			//create date object which is time after 1970 and store it here!!!
			ogPhotoArray[i].date = new Date(ogPhotoArray[i].ti);

			// Extra
			ogPhotoArray[i].m2 = getM2FromDistance(ogPhotoArray[i], ogPhotoArray[i].d1);
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
		console.log(`Emission filter: ${(timer1 - timer0)*1000} milliseconds`);
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
			const maxDist = (params.MpP_duo[1] * (.001*(CometView.defaultRes/2))) / Math.tan(Math.PI*(CometView.FOV/2.0)/180.0);
			const minDist = (params.MpP_duo[0] * (.001*(CometView.defaultRes/2))) / Math.tan(Math.PI*(CometView.FOV/2.0)/180.0);
			const maxDistSquared = maxDist*maxDist;
			const minDistSquared = minDist*minDist;
			for (let i = 0; i < ogPhotoArray.length; i++) {
				let trueDistSquared = ogPhotoArray[i].sc_v.distanceToSquared(avgPosition);
				if (ogPhotoArray[i].rz) // hence, not default
					trueDistSquared *= (CometView.defaultRes/ogPhotoArray[i].rz)**2; // more computationally efficient to adjust trueDistSquared 
				if (trueDistSquared > maxDistSquared || trueDistSquared < minDistSquared)
					ogPhotoArray[i].filter |= FAIL_MPP;
				else
					ogPhotoArray[i].filter &= ~FAIL_MPP;
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
		indexSlider.max(Math.max(0, dynamicArray.length-1));

		if (cometView) {
			const newIndex = dynamicArray.findIndex(info => info === ogPhotoArray[cometView.ogIndex]);
			currentIndex = newIndex >= 0 ? newIndex : 0;
		} else currentIndex = 0;

		if (dynamicArray.length > 0) { 
			loadComet(dynamicArray[currentIndex]);
			enableImageNavigation(true);
		} else {
			unloadComet();	// No image matches, so have to explicitly unload current cometView. Don't do this otherwise because images will flicker.
			enableImageNavigation(false);
		}
		params.photoIndex = currentIndex;
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
            if (colorArray[i] == PAINT_RED) {
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
			cometView.applyToCamera(circleCam);
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

	function clearOverlay() {
		const ctx = overlayCanvas.getContext('2d');
		const canvasWidth = overlayCanvas.width, canvasHeight = overlayCanvas.height;

		if (params.showImage != SI_UNMAPPED) { // Clear the overlay if it does not contain an image
			ctx.clearRect(0, 0, canvasWidth, canvasHeight);
			return;
		}
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
			ctx.lineWidth = 2 //1;
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

		ctx.fillStyle = 'black';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight); // Black background
	
		const aspectRatio = img.width / img.height;
	
		// Scale the image height to fit the canvas height
		const drawHeight = canvasHeight;
		const drawWidth = drawHeight * aspectRatio;
	
		// Calculate the available width (canvas width minus gui width)
		const availableWidth = canvasWidth - guiWidth;
	
		// Calculate the x position to center the image within the available space
		const x = (availableWidth - drawWidth) / 2;
		const y = 0; // Start drawing at the top of the canvas
	
		ctx.drawImage(img, x, y, drawWidth, drawHeight); // Draw the image centered
	}

	refreshOverlay = function () {
		if (!overlayNeedsUpdate) return;
		if (CometView.map && CometView.map.image && cometView && cometView.imageFresh && overlayNeedsUpdate) {
			drawImageOnOverlay(overlayCanvas, CometView.map.image);
			overlayPaintCircle();
		} else if (!cometView && ogPhotoArray) { // everything loaded but no current cometView => no matches
			drawNoMatchesOverlay();
		} else if (cometView) {	 // If No Matches displayed, need to clear it
			clearOverlay();
		}
		overlayNeedsUpdate = false;
	};


	const url = preprocessMode ? "imageMetadata_phase1.json" : urlPrefix + dataset.metaData; // hardwired json file - not ideal
	fetch(url) 	// Fetch the JSON file
	.then(response => response.json()) // Parse the response as JSON
	.then(data => {  // Now "data" contains the parsed JSON object
		ogPhotoArray = data;
		cachePhotoInformation(ogPhotoArray);
		updateAllFilters(ogPhotoArray);
		indexSlider.max(Math.max(0, dynamicArray.length-1));
		if (targetMesh) {
			params.loadFirst();
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
						r = g = b = COMETGREYVAL;  // erase the paint
						if ( mouseType === 0 ) {   // set the paint color
							r = PAINT_RED;
							g = PAINT_GREEN;
							b = PAINT_BLUE;;
						}
						for ( let i = 0, l = indices.length; i < l; i ++ ) {
							const vertexIndex = indexAttr.getX(indices[i]);
							const colorIndex = vertexIndex * 3;
							colorArray[colorIndex] = r;
							colorArray[colorIndex+1] = g;
							colorArray[colorIndex+2] = b;

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

function countVertices(blueVal) {
	let nVerts = 0, i = 2;
	const arraySize = colorArray.length;
	while (i < arraySize-1) {
		if (colorArray[i] == blueVal) nVerts++;
		i += 3;
	}
	return nVerts;
}

const VISIBLE_GREEN = 249;

function expandPaint(n) {
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

let computeVisibleVertices = function (paintVisible = true) {
	const startTime = window.performance.now();
	const sc = cometView ? cometView.sc_position.clone() : camera.position.clone();	// set sc to be sc position if known, otherwise camera position
	const v = new THREE.Vector3();
	const raycaster = new THREE.Raycaster();
	let res = [];
	raycaster.firstHitOnly = true;
	const r=0, g=0, b=VISIBLE_BLUE;   // bright blue for now (really) - and a unique byte for visibility in the blue channel
	const vertexNormal = new THREE.Vector3();
	const bbox = new THREE.Box3();
	const dotLimit = Math.cos(params.filterAngle * Math.PI / 180.);
	const normDepth = cometView ? new NormalDepth() : null;

	if (cometView) cometView.createViewRect();

	for (let i = 0; i < cometGeometry.attributes.position.array.length; i+=3) {
		let isVisible = false;
		// first do normals check
		const vertToSC = v.clone().sub(sc);
		const scToVertNormed = vertToSC.clone().negate().normalize();
		vertexNormal.x = cometGeometry.attributes.normal.array[i];
		vertexNormal.y = cometGeometry.attributes.normal.array[i+1];
		vertexNormal.z = cometGeometry.attributes.normal.array[i+2];
		if (!params.useNormals || vertexNormal.dot(scToVertNormed) >= dotLimit) {   // vertex passes normal filter
			v.x = cometGeometry.attributes.position.array[i] + .000001; // perturb by a milimeter so it doesn't go through the vertex
			v.y = cometGeometry.attributes.position.array[i+1] + .000001;
			v.z = cometGeometry.attributes.position.array[i+2] + .000001;
			const theoreticalDistance = v.distanceTo(sc);
			// console.log("Theoretical distance is %f", theoreticalDistance);
			raycaster.set(sc, v.clone().sub(sc));
			// console.log("v is %O, sc is %O, sc, dir = %O", v, sc, v.clone().sub(sc));
			res.length = 0;
			if (cometView && cometView.viewRect) {
				res = raycaster.intersectObject(cometView.viewRect, false, res );
				if (res.length == 0) continue;    // does not intersect viewRect, which is set
			}
			res.length = 0;
			res = raycaster.intersectObject( targetMesh, true, res );
			if (res.length > 0) {
				// console.log("res[0].distance = %f", res[0].distance);
				if (Math.abs(res[0].distance - theoreticalDistance) < .001) // less than a meter
					isVisible = true;
			}
			if (isVisible) {
				bbox.expandByPoint(v);		// include point in our axis-aligned bounding box
				if (normDepth) normDepth.expandByVector(vertToSC, cometView.normal);
				if (paintVisible) {
					colorArray[i] = r;
					colorArray[i+1] = g;
					colorArray[i+2] = b;
					colorAttr.needsUpdate = true;
				}
			}
		}
	}
	if (cometView) cometView.saveExtentInfo(bbox, normDepth);
	console.log("ComputeVisible time = %f milliseconds", window.performance.now() - startTime);
	if (paintVisible) console.log(`Visible vertex count = ${countVertices(VISIBLE_BLUE)}`);
	if (paintVisible) expandPaint(1);
}

const M2DIST = (.001*(dataset.defaultRes/2)) / Math.tan(Math.PI*(dataset.FOV/2.0)/180.0);
const M2MULTIPLIER = 1.0 / M2DIST; // for defaultRes, dist*M2MULTIPLIER == m2. 

function getM2FromDistance(photoDict, dist) {
	let m2 = dist * M2MULTIPLIER;
	if ('rz' in photoDict) m2 *= CometView.defaultRes / photoDict.rz;	// adjust for different resolutions
	return Math.round(m2 * 100) / 100;  // rounding to 2 digits after decimal
}

let preProcessMode = false, preProcessStart;
let preProcess = function () {
	preProcessStart = window.performance.now();
	if (!preProcessMode && ogPhotoArray) {
		socket.emit('PPclientReadyToStart', {count: ogPhotoArray.length});
		preProcessMode = true;
	}
}

socket.on('PPserverRequestsVisibility', function(message) { // {index:, name:}
	console.log(`Got a PPserverRequestsVisibility: ${message.index}`);
	if (ogPhotoArray[message.index].nm === message.name) {	// got a match!
		params.clear();					// clear away any visibility paint 
		loadComet(ogPhotoArray[message.index]);		// loaded requested index 
		currentIndex = params.photoIndex = message.index;  // to make sure index slider updates
		computeVisibleVertices(true);	// apply visibility paint

		const bbox = cometView.bbox;
		message.bbox = {min: bbox.min.toArray(), max: bbox.max.toArray()};
		const depth = cometView.normDepth;
		if (getM2FromDistance(ogPhotoArray[message.index], depth.depthMin) > 10)
			depth.depthMax = depth.depthMin-1;	// Tell server not to save if m2 > 10
		message.depth = {min: depth.depthMin, max: depth.depthMax};
		updatePaintBuffer();
		message.visBuffer = paintArray;
		socket.emit('PPclientProvidesVisibility', message);
		console.log('Sending a PPclientProvidesVisibility %O', message)
		if (message.index === ogPhotoArray.length-1) {
			preProcessMode = false;
			console.log(`Finished in ${(window.performance.now() - preProcessStart) / 1000} seconds!!!`);
		}
	} else {
		console.error("Bad index/name registration between client and server - debug it!");
	}
}); 

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

    const skipRender = cometView && (params.showImage != SI_NONE)  && !cometView.imageFresh;
	if (!skipRender) {
		renderer.render(scene, camera);
        refreshOverlay();
    } else console.log("Skipping render");
	
	stats.end();
}

init();
render();
