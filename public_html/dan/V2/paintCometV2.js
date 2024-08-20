import Stats from './node_modules/three/examples/jsm/libs/stats.module.js';// should be good
import * as dat from './node_modules/three/examples/jsm/libs/lil-gui.module.min.js'; //should be good
import * as THREE from './node_modules/three/build/three.module.js'; //should be good
import { TrackballControls } from './node_modules/three/examples/jsm/controls/TrackballControls.js'; //should be good
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CONTAINED, INTERSECTED, NOT_INTERSECTED } from './three-mesh-bvh-master/three-mesh-bvh-master/src/index.js';
import { OBJLoader2 } from './node_modules/wwobjloader2/dist/OBJLoader2.js';
import {CometInfo} from './cometInfoV2.js';


//console.log('made it through imports')

let stats;
let scene, camera, renderer, controls, colorArray, colorAttr, r, b, g;
let targetMesh, brushMesh;
let mouse = new THREE.Vector2();
let mouseType = - 1, brushActive = false;
let lastTime;
let cometInfo = null;
let ogPhotoArray, dynamicArray;
let avgNormal, avgPosition, roiBoundingBox;
let applyGeoFilterAccessor, updateAllFiltersAccessor, downloadAccessor;
let numPainted;
let bboxBitBuffer, bboxBitArray, paintBuffer, paintArray;
let xAxisLine, yAxisLine, zAxisLine;
var socket = io();

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
	for (let i = 0; i < targetMesh.geometry.attributes.position.array.length; i+=3) {
		const errorTolerance = 0.000001
		const pseudoVertex = new THREE.Vector3(targetMesh.geometry.attributes.position.array[i] + errorTolerance,
			targetMesh.geometry.attributes.position.array[i+1] + errorTolerance, 
			targetMesh.geometry.attributes.position.array[i+2] + errorTolerance);
		
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
						targetMesh.geometry.attributes.color.array[i] = 0;
						targetMesh.geometry.attributes.color.array[i+1] = 0;
						targetMesh.geometry.attributes.color.array[i+2] = 255;
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
	//console.log('minDistAlongNormal from paintSquare', minDistAlongNormal);
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
	generalHelp: function() {
		window.open("https://comet.photos/quickstart.html");
	},
	controlHelp: function() {
		window.open("https://comet.photos/controlHelp.html")
	},
	overviewHelp: function() {
		window.open("https://comet.photos/overview.html")
	},
	videoHelp: function() {
		window.open("https://comet.photos/videoHelp.html");
	},
	size: 0.1,
	paint: false,
	clear: function() {
		//console.log("Called clear!");
		colorArray.fill( 255 );
		colorAttr.needsUpdate = true;
		numPainted = 0;
		updateAllFiltersAccessor(ogPhotoArray);
	},
	paintVisible: function(){
		//console.log('Called paintVisible!');
		const startfunc = clock.getElapsedTime();
		let j = 0;
		let k = 0;
		const raycaster = new THREE.Raycaster();
		raycaster.firstHitOnly = true;
		//var visibleVertices = [];
		
		for (let i = 0; i < targetMesh.geometry.attributes.position.array.length; i+=3) {
			const errorTolerance = 0.000001
			const pseudoVertex = new THREE.Vector3(targetMesh.geometry.attributes.position.array[i] + errorTolerance,
				targetMesh.geometry.attributes.position.array[i+1] + errorTolerance, 
				targetMesh.geometry.attributes.position.array[i+2] + errorTolerance);

			const vertexDirection = pseudoVertex.clone().sub(camera.position).normalize();
		
			raycaster.set(camera.position, vertexDirection);
			const res = raycaster.intersectObject(targetMesh, true);

			
			if (res.length > 0) {
				if (res[0].point.clone().sub(pseudoVertex).length() < 0.01) {
					j++;
					r = 0, g = 0, b = 255;
					
					targetMesh.geometry.attributes.color.array[i] = 0;
					targetMesh.geometry.attributes.color.array[i+1] = 0;
					targetMesh.geometry.attributes.color.array[i+2] = 255;
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
		//console.log("called paintSquare");
		findSquare(true);
	},
	decal: false,
	blueBox: false,
	axes: false,
	autoCam: false,
	loadPicture: function() {
		loadComet(dynamicArray[0]);
		this.photoIndex = 0;
		currentIndex = 0;
	},
	loadNext: function() {
		if (cometInfo) {
			if (currentIndex != dynamicArray.length-1) {
				//console.log('should be removing self');
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
	percentROI: 100,
	returnPainted: function() {
		initPaintBuffer(targetMesh.geometry.attributes.position.count);
		roiBoundingBox = new THREE.Box3();
		numPainted = 0;
		var sumX = 0, sumY = 0, sumZ = 0, pSumX = 0, pSumY = 0, pSumZ = 0;
		for (let i = 0; i < targetMesh.geometry.attributes.color.array.length; i+=3) {
			if (targetMesh.geometry.attributes.color.array[i] == 0XF1) {
					numPainted++;
					const currentPoint = new THREE.Vector3(targetMesh.geometry.attributes.position.array[i], 
						targetMesh.geometry.attributes.position.array[i+1],
						targetMesh.geometry.attributes.position.array[i+2]);
					roiBoundingBox.expandByPoint(currentPoint);
					setNthBit(i/3, paintArray);
					
					sumX += targetMesh.geometry.attributes.normal.array[i];
					sumY += targetMesh.geometry.attributes.normal.array[i+1];
					sumZ += targetMesh.geometry.attributes.normal.array[i+2];
					pSumX += targetMesh.geometry.attributes.position.array[i];
					pSumY += targetMesh.geometry.attributes.position.array[i+1];
					pSumZ += targetMesh.geometry.attributes.position.array[i+2];
			}
		}
		// console.log('numPainted', numPainted)
		// console.log('selectedVerts', selectedVertices)
		// console.log('selectedNormals', selectedNormals)
		if (numPainted > 0) {
			avgNormal = new THREE.Vector3(sumX, sumY, sumZ).normalize();
			avgPosition = new THREE.Vector3(pSumX, pSumY, pSumZ).normalize();
		}
		
		//console.log('avgNormal:', avgNormal);
		//console.log('roiBoundingBox:', roiBoundingBox)
		updateAllFiltersAccessor(ogPhotoArray);
	},
	MpP: 10,
	emission: 90, 
	incidence: 90,
	phase: 180,
	bbox: function() {
		applyGeoFilterAccessor(ogPhotoArray);
	},
	status: 'Loading',
	photoInfo: 'None Selected',
	skipLength: 'Month',
	skipf: function(){
		const currentDate = dynamicArray[this.photoIndex].date;
		var msSkip = currentDate.getTime()
		//console.log('currentDate in ms:', msSkip);
		if (this.skipLength === "Day") {
			msSkip += msDay;
		}
		else if (this.skipLength === "Month") {
			msSkip += msMonth;
		}
		else {
			msSkip += msYear;
		}
		//console.log('min skipDate in ms:', msSkip);
		const skipToDate = new Date(msSkip);
		if (cometInfo) {
			//console.log('skipping one', this.skipLength);
			for (let i = this.photoIndex; i < dynamicArray.length; i++) {
				if (dynamicArray[i].date.getTime() > msSkip) {
					//console.log('found one!')
					//console.log('at index', i)
					//console.log('its time is:', dynamicArray[i].ti)
					loadComet(dynamicArray[i]);
					currentIndex = i;
					this.photoIndex = i;
					//console.log('skipped!')
					break;
				}
			}
		}
	},
	skipb: function() {
		const currentDate = dynamicArray[this.photoIndex].date;
		var msSkip = currentDate.getTime()
		//console.log('currentDate in ms:', msSkip);
		if (this.skipLength === "Day") {
			msSkip -= msDay;
		}
		else if (this.skipLength === "Month") {
			msSkip -= msMonth;
		}
		else {
			msSkip -= msYear;
		}
		//console.log('min skipDate in ms:', msSkip);
		const skipToDate = new Date(msSkip);
		if (cometInfo) {
			//console.log('skipping one', this.skipLength);
			for (let i = this.photoIndex; i >= 0; i--) {
				if (dynamicArray[i].date.getTime() < msSkip) {
					//console.log('found one!')
					//console.log('at index', i)
					//console.log('its time is:', dynamicArray[i].ti)
					loadComet(dynamicArray[i]);
					currentIndex = i;
					this.photoIndex = i;
					//console.log('skipped!')
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
		// console.log('files:', files);
		// console.log('type(files):', typeof files);
		downloadAccessor('comet_filenames.txt', files);
	},
	memStats: function() {
        params.status = `Textures: ${renderer.info.memory.textures}. Geometries = ${renderer.info.memory.geometries}.`;
    }
}

function getInfoString(photoDict) {
	if (!numPainted) return `#${photoDict.ogIndex}  m: ${photoDict.m2}`;
	const avg_sc_vec = photoDict.sc_v.clone().sub(avgPosition).normalize();
	const emissionAngle = Math.round(Math.acos(avg_sc_vec.dot(avgNormal))*180/Math.PI);
	const sun_vec = photoDict.sunHat;
	const incidAngle = Math.round(Math.acos(sun_vec.dot(avgNormal))*180/Math.PI);
	const phaseAngle = Math.round(Math.acos(avg_sc_vec.dot(sun_vec))*180/Math.PI);
	return `#${photoDict.ogIndex}  m: ${photoDict.m2}  e: ${emissionAngle}  i: ${incidAngle}  p: ${phaseAngle}`;
}

function loadComet(photoDict) {
	if (cometInfo) {
		if (cometInfo.ogIndex === photoDict.ogIndex) return;		// trying to load what is already loaded
		cometInfo.removeSelf(scene);		// remove the old one
	}
	cometInfo = new CometInfo(photoDict);
	//console.log('cometInfo set to new value');
	//findSquare(false);
	cometInfo.setCornerArray();
	if (params.blueBox)
		cometInfo.addOutline(scene);
	if (params.decal)
		cometInfo.applyDecal(scene, targetMesh)
	if (params.autoCam)
		cometInfo.applyToCamera(camera, controls);
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


function init() {
	const bgColor = 0x263238 / 2;

	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild( renderer.domElement );
	renderer.domElement.style.touchAction = 'none';

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

	const modelPath = 'CG_NavCam_200k_facets.obj';
	const objLoader2 = new OBJLoader2().setUseIndices(true);

	const loadData = (object3d) => {
        const cometGeometry = object3d.children[0].geometry;
        cometGeometry.computeVertexNormals();                
        colorArray = new Uint8Array( cometGeometry.attributes.position.count * 3 );
		colorArray.fill(255);
		colorAttr = new THREE.BufferAttribute( colorArray, 3, true );
		colorAttr.setUsage( THREE.DynamicDrawUsage );
		cometGeometry.setAttribute( 'color', colorAttr );
		
		const cometMaterial = new THREE.MeshStandardMaterial({roughness: 1.0, metalness: 0, vertexColors: true, flatShading: true});
		targetMesh = new THREE.Mesh( cometGeometry, cometMaterial );
		targetMesh.geometry.computeBoundsTree();
		scene.add( targetMesh );
		if (ogPhotoArray) { //if photo array loaded then load first
			params.loadPicture();
		}
    };


	objLoader2.load(modelPath, loadData);


	const brushGeometry = new THREE.SphereGeometry( 1, 40, 40 );
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

	brushMesh = new THREE.Mesh( brushGeometry, brushMaterial );
	scene.add( brushMesh );

	//camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 3, 3, 3 );
	camera.updateProjectionMatrix();

	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );
	
	//GUI SETUP
	let skipForwardCtl, skipBackwardCtl;

	const gui = new dat.GUI();
	
	const helpFolder = gui.addFolder('Help Resources');
	helpFolder.add(params, 'generalHelp').name('Show Quickstart Help');
	//helpFolder.add(params, 'controlHelp').name('Explain Each Control');
	helpFolder.add(params, 'overviewHelp').name('Show the Project Overview');
	//helpFolder.add(params, 'videoHelp').name('Show a Video Demo');

	const paintFolder = gui.addFolder('Paint Tools');
	paintFolder.add(params, 'paint').name('Enable Paint').onChange(function(value){ controls.enabled = !value});
	paintFolder.add(params, 'size').min( 0.005 ).max( 0.2 ).step(.005).name('Brush Size');
	paintFolder.add(params, 'percentROI').name('Percent Overlap').min(1).max(100).step(1).onChange(function(value){applyGeoFilter(ogPhotoArray)});
	paintFolder.add(params, 'clear').name('Clear Paint');
	const filterFolder = gui.addFolder('Image Filters');
	filterFolder.add(params, 'MpP').name('Meters per Pixel').min(0.5).step(0.5).max(10).onChange(function(value) {applyMpPFilter(ogPhotoArray)});
	filterFolder.add(params, 'emission').min(5).max(90).step(1).name('Emission Angle').onChange(function(value) {applyEmissionFilter(ogPhotoArray)});
	filterFolder.add(params, 'incidence').name('Incidence Angle').min(5).max(90).step(1).onChange(function(value) {applyIncidenceFilter(ogPhotoArray)});
	filterFolder.add(params, 'phase').name('Phase Angle').min(5).max(180).step(1).onChange(function(value){applyPhaseFilter(ogPhotoArray)});

	const imageFolder = gui.addFolder('Image Display and Navigation');
	imageFolder.add(params, 'decal').name('Map Image').onChange(function(value) {changeDecal()});
	imageFolder.add(params, 'autoCam').name('Spacecraft View').onChange(function(value){spacecraftView(value);})
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
	const debugFolder = gui.addFolder('Debug Tools');
	debugFolder.close();
	debugFolder.add(params, 'paintVisible').name('Paint Visible');
	debugFolder.add(params, 'paintSquare').name('Paint Square');
	debugFolder.add(params, 'memStats').name('Memory Stats');
	gui.open();


	function loadFilename(fn) {
		//console.log('loading fn');
		//console.log(fn);
		for (let i = 0; i < ogPhotoArray.length; i++) {
			if (fn == ogPhotoArray[i].nm) {
				//console.log('found matching file')
				loadComet(dynamicArray[i]);
				currentIndex = i;
				params.photoIndex = i;
			}
		}
	}

	function download(filename, text) {  // Downloads filename with contents text. Thanks ChatGPT!
        var element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }
	downloadAccessor = download;
	
	function loadSlider() {
		loadComet(dynamicArray[params.photoIndex]);
		currentIndex = params.photoIndex;
	}
	function changeDecal() {
		if (cometInfo) {
			if (cometInfo.decalOn) {
				cometInfo.removeDecal(scene);
			}
			else {
				cometInfo.applyDecal(scene, targetMesh);
			}
		}
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
		if (numPainted > 0) {
			// console.log('avgscvec', dynamicArray[0].sc_v.clone().sub(avgPosition).normalize());
			// console.log('avgNormal', avgNormal);
			// console.log('firstPhotoEmission:', 180*avgNormal.clone().dot(dynamicArray[0].sc_v.clone().sub(avgPosition).normalize())/Math.PI);
			for (let i = 0; i < ogPhotoArray.length; i++) {
				const avg_sc_vec = ogPhotoArray[i].sc_v.clone().sub(avgPosition).normalize();
				// console.log('avg_sc_vec:', avg_sc_vec);
				// console.log('avgNormal', avgNormal)
				if (Math.acos(avgNormal.clone().dot(avg_sc_vec)) > params.emission*Math.PI/180){ 
					ogPhotoArray[i].filter |= FAIL_EMISSION;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_EMISSION;
				}
			}
		}
		if (doFilterCleanup) filterCleanUp();
	}
	function applyMpPFilter(ogPhotoArray, doFilterCleanup = true) {
		for (let i = 0; i < ogPhotoArray.length; i++) {
			if (ogPhotoArray[i].m2 > params.MpP) {
				ogPhotoArray[i].filter |= FAIL_MPP;
			}
			else {
				ogPhotoArray[i].filter &= ~FAIL_MPP;
			}
		}
		if (doFilterCleanup) filterCleanUp();
	}
	function applyIncidenceFilter(ogPhotoArray, doFilterCleanup = true) {
		if (numPainted > 0) {
			for (let i = 0; i < ogPhotoArray.length; i++) {
				if (Math.acos(ogPhotoArray[i].sunHat.dot(avgNormal)) > params.incidence*Math.PI/180) {
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
				if (Math.acos(scHat.dot(ogPhotoArray[i].sunHat)) > params.phase*Math.PI/180){
					ogPhotoArray[i].filter |= FAIL_PHASE;
				}
				else {
					ogPhotoArray[i].filter &= ~FAIL_PHASE
				}
			}
		}
		if (doFilterCleanup) filterCleanUp();
	}
	
	function applyGeoFilter(ogPhotoArray, doFilterCleanup = true) {
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
	});
	
	applyGeoFilterAccessor = applyGeoFilter;

	function updateAllFilters(ogPhotoArray) {
		for (let i = 0; i < ogPhotoArray.length; i++)
			ogPhotoArray[i].filter = 0;		// all pass by default
		applyMpPFilter(ogPhotoArray, false);
		applyEmissionFilter(ogPhotoArray, false);
		applyIncidenceFilter(ogPhotoArray, false);
		applyGeoFilter(ogPhotoArray, false);
		applyPhaseFilter(ogPhotoArray, false);
		filterCleanUp();   // just one cleanup at the end
	}
	updateAllFiltersAccessor = updateAllFilters;

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



	// Assuming you have a JSON file named "viewdata.json"
	const url = '../../viewdata.json';
	// Fetch the JSON file
	fetch(url)
	.then(response => response.json()) // Parse the response as JSON
	.then(data => {
		// Now "data" contains the parsed JSON object
		// You can do whatever you want with the JSON data here
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


	window.addEventListener( 'resize', function () {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );
	}, false );

	renderer.domElement.addEventListener( 'pointermove', function ( e ) {
		mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
		if (params.paint) {
			brushActive = true;
		}
	} );

	renderer.domElement.addEventListener( 'pointerdown', function ( e ) {
        if (params.paint) {
            mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
            mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
            mouseType = e.button;

            // disable the controls early if we're over the object because on touch screens
            // we're not constantly tracking where the cursor is.
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera( mouse, camera );
            raycaster.firstHitOnly = true;

            const res = raycaster.intersectObject( targetMesh, true );
            brushActive = true;
        }
	}, true );

	renderer.domElement.addEventListener( 'pointerup', function ( e ) {
		if (params.paint) {
			mouseType = - 1;
			if ( e.pointerType === 'touch' ) {
				// disable the brush visualization when the pointer action is done only
				// if it's on a touch device.
				brushActive = false;
			}
		params.returnPainted();
	}
	}, true );

	window.addEventListener( 'wheel', function ( e ) {
		if (params.paint) {let delta = e.deltaY; 
		
		if ( e.deltaMode === 1 ) {
			delta *= 10;
		}
		if ( e.deltaMode === 2 ) {
			delta *= 10;
		}

		params.size += delta/150 * .01;
		params.size = Math.max( Math.min( params.size, 0.2 ), 0.005 );

		gui.controllersRecursive().forEach( c => c.updateDisplay() );
	}
	} );

	renderer.domElement.addEventListener( 'contextmenu', function ( e ) {
		e.preventDefault();
	} );


	controls = new TrackballControls( camera, renderer.domElement );
	controls.noPan = true;
	controls.rotateSpeed = 4;
	controls.zoomSpeed = 4;
	controls.staticMoving = true;
	lastTime = window.performance.now();
}

function render() {

	requestAnimationFrame( render );

	stats.begin();
    if (typeof targetMesh === "undefined") {return};
	const geometry = targetMesh.geometry;
	const bvh = geometry.boundsTree;
	const colorAttr = geometry.getAttribute( 'color' );
	const indexAttr = geometry.index;

	function removeItemOnce(arr, value) {
		var index = arr.indexOf(value);
		if (index > -1) {
		  arr.splice(index, 1);
		}
		return arr;
	}
	function removeItemAll(arr, value) {
		var i = 0;
		while (i < arr.length) {
		  if (arr[i] === value) {
			arr.splice(i, 1);
		  } else {
			++i;
		  }
		}
		return arr;
	}
	
	if (!brushActive) {

		brushMesh.visible = false;

	} else {
		if (params.paint) {
			brushMesh.scale.setScalar( params.size );

			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera( mouse, camera );
			raycaster.firstHitOnly = true;

			const res = raycaster.intersectObject( targetMesh, true );
			if ( res.length ) {

				brushMesh.position.copy( res[ 0 ].point );
				brushMesh.visible = true;

				const inverseMatrix = new THREE.Matrix4();
				inverseMatrix.copy( targetMesh.matrixWorld ).invert();

				const sphere = new THREE.Sphere();
				sphere.center.copy( brushMesh.position ).applyMatrix4( inverseMatrix );
				sphere.radius = params.size;

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
					// console.log('indeces: %O', indices);
					// console.log('indeces [0]: %O', indices[0])
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
	const currTime = window.performance.now();
	lastTime = currTime;
	controls.update();
	renderer.render( scene, camera );
	stats.end();
}


init();
render();
