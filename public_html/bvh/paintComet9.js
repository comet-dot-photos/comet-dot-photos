import Stats from 'three/examples/jsm/libs/stats.module.js';
import * as dat from 'three/examples/jsm/libs/lil-gui.module.min.js';
import * as THREE from 'three/build/three.module.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CONTAINED, INTERSECTED, NOT_INTERSECTED } from '/node_modules/three-mesh-bvh/src/index.js';   		// line for node access
//import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OBJLoader2 } from '/node_modules/wwobjloader2/dist/OBJLoader2.js';
//import ProjectedMaterial from '../node_modules/three-projected-material/build/ProjectedMaterial.module.js';
import { CometView, NormalDepth } from './cometUtils9.js';

var socket = io();		// set up socket communications with node server

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let stats, gui;
let scene, camera, renderer, controls;
let targetMesh, brushMesh, colorArray, colorAttr, cometMaterial, cometGeometry, cometMesh;
let light1, light2, light3, sunlight;
let mouse = new THREE.Vector2();
let mouseType = - 1, brushActive = false;
let currentView = null;
let viewArray = null, ogViewArray = null;
let viewIndex;
let loadCometViewByIndexAccessor; 	// hack
let gatherPaintInfoAccessor;		// hack
let loadJsonAccessor;				// hack
let paintDependentFiltersAccessor; // hack
let preProcessStart;
let paintInfo = null;

const MINBRUSHSIZE = 0.005, MAXBRUSHSIZE = 0.3, INITBRUSHSIZE = 0.1;
const COMETGREYVAL = 255;
const COMETCOLOR = COMETGREYVAL<<16 | COMETGREYVAL<<8 | COMETGREYVAL;

const params = {
	help: null,
	paint: false,
	brushSize: INITBRUSHSIZE,
	matchPercent: 1,
    clear: null,
    paintColor: 0xF1B2AB,   // original color in example
    eraseColor: (COMETGREYVAL<<16) | (COMETGREYVAL<<8) | COMETGREYVAL,
    flatShading: true,
	useNormals: false,
	filterAngle: 45,
	autoCam: false,
	computeVisible: null,
    memStats: null,
    imgFormat: 'J80',
	decalImage: false,
	outline: false,
    useSun: false,
    name: "None loaded",
    time: "Timeless",
    index: 0,
    //loadJson: null,
    nextImage: null,
    previousImage: null,
	preProcess: null,
	testNode: null,
	filterByGeometry: null,
	linearAlgebraTest: null,
	downloadNames: null,
	sessionName: "Session Name Here",
	saveSession: null,
	loadSession: null,
	m2: 10,
	emission: 90,
	incidence: 90,
	phase: 180,
	info: "",
	status: "Loading..."
    //projectImage: false,
};

function countBits (array) {
	let count = 0;
	for (let i = 0; i < array.length; i++) {
		for (let j = 0; j < 8; j++) {
			if (array[i] & (1 << j)) count++;
		}
	}
	return count;
}


function init() {

	const bgColor = 0x263238 / 2;
	
	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild( renderer.domElement );
	renderer.domElement.style.touchAction = 'none';

	function createSunLight() {
		sunlight = new THREE.DirectionalLight(0xffffff, 1.0);  // sun is effectively directional at this distance
		sunlight.position.set(0, 5, 0);						   //choose a default until a cometView is loaded
		sunlight.castShadow = true;
		const d = 4
		sunlight.shadow.camera.left = -d;
		sunlight.shadow.camera.right = d;
		sunlight.shadow.camera.top = d;
		sunlight.shadow.camera.bottom = -d;
	
		sunlight.shadow.camera.near = 1;
		sunlight.shadow.camera.far = 9;
	
		sunlight.shadow.mapSize.x = 1024;
		sunlight.shadow.mapSize.y = 1024;
		return sunlight;
	}

	// scene setup
	scene = new THREE.Scene();
	light1 = new THREE.DirectionalLight( 0xffffff, 0.5 );
	light1.position.set( 1, 1, 1 );
	scene.add(light1);
    light2 = new THREE.DirectionalLight( 0xffffff, 0.5);
    light2.position.set(-1, -1, -1);
    scene.add(light2);
	light3 = new THREE.AmbientLight( 0xffffff, 0.4);
	scene.add(light3);
	sunlight = createSunLight();

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

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 3, 3, 3 );
	camera.far = 100;
	camera.updateProjectionMatrix();


	// stats setup
	stats = new Stats();
	document.body.appendChild( stats.dom );

	
	window.addEventListener( 'resize', function () {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );
	}, false );

	renderer.domElement.addEventListener( 'pointermove', function ( e ) {
        if (params.paint) {
            mouse.x = ( e.clientX / window.innerWidth ) * 2 - 1;
            mouse.y = - ( e.clientY / window.innerHeight ) * 2 + 1;
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
			gatherPaintInfoAccessor();		// paint brush is up!
		}
	}, true );


	renderer.domElement.addEventListener( 'contextmenu', function ( e ) {
		e.preventDefault();
	} );

	renderer.domElement.addEventListener( 'wheel', function ( e ) {
        if (params.paint) {
            let delta = e.deltaY;

            if ( e.deltaMode === 1 || e.deltaMode ===2) { // line or page scroll mode
                delta *= 10; //40;
            }
            // console.log("delta is %i, deltaMode = %i", delta, e.deltaMode);
            params.brushSize += delta/150 * 0.01;
            params.brushSize = Math.max( Math.min( params.brushSize, MAXBRUSHSIZE ), MINBRUSHSIZE );

            gui.controllersRecursive().forEach( c => c.updateDisplay() );
        }
	} );


    const modelName = 'CG_NavCam_200k_facets.obj';
    const modelStart = window.performance.now();

    const objLoader2 = new OBJLoader2()
        .setUseIndices(true);

    const callbackOnLoad = (object3d) => {
		cometMesh = object3d.children[0];
        cometGeometry = cometMesh.geometry;  // object is a group, child is a mesh, mesh has a geometry
        cometGeometry.computeVertexNormals();                // make it pretty if flatShading turned off
        colorArray = new Uint8Array( cometGeometry.attributes.position.count * 3 );
		colorArray.fill( COMETGREYVAL );
		colorAttr = new THREE.BufferAttribute( colorArray, 3, true );
		colorAttr.setUsage( THREE.DynamicDrawUsage );
		cometGeometry.setAttribute( 'color', colorAttr );

		cometMaterial = new THREE.MeshStandardMaterial( { color: COMETCOLOR, roughness: 1.0, metalness: 0, vertexColors: true, flatShading: params.flatShading } );
		/*
        //cometMaterial = new ProjectedMaterial ( { color: COMETCOLOR, roughness: 1.0, metalness: 0, vertexColors: true, flatShading: params.flatShading } );
        const texture = new THREE.TextureLoader().load('./N20140905T064555557ID30F22.png');
        cometMaterial = new ProjectedMaterial ({ 
            camera: camera.clone(),
            texture,
            cover: false,
            color: 0x909090
             });
        */
        targetMesh = new THREE.Mesh(cometGeometry, cometMaterial);
		targetMesh.geometry.computeBoundsTree();
		targetMesh.traverse((child) => {
			if (child.isMesh)
				child.castShadow = child.receiveShadow = true;
		})
		scene.add(targetMesh);
        console.log(`Loading %s in %f milliseconds.`, modelName, window.performance.now()-modelStart);
		if (viewArray && viewIndex == -1) params.nextImage();			// call nextImage if comet has loaded after JSON
    };

    objLoader2.load(modelName, callbackOnLoad);

	controls = new TrackballControls(camera, renderer.domElement);
    //controls.enablePan = false;
	controls.noPan = true;
	controls.rotateSpeed = 4.;
	controls.zoomSpeed = 4.;
	controls.staticMoving = true;

	loadJsonAccessor();
}

function render() {
	requestAnimationFrame( render );

	if (targetMesh == null) return;

	stats.begin();

	const geometry = targetMesh.geometry;
	const bvh = geometry.boundsTree;
	const colorAttr = geometry.getAttribute( 'color' );
	const indexAttr = geometry.index;

	if (!brushActive) {
		brushMesh.visible = false;
	} else {
		brushMesh.scale.setScalar( params.brushSize );

		const raycaster = new THREE.Raycaster();
		raycaster.setFromCamera( mouse, camera );
		raycaster.firstHitOnly = true;

		const res = raycaster.intersectObject( targetMesh, true );
		if ( res.length && params.paint) {

			brushMesh.position.copy( res[ 0 ].point );
			brushMesh.visible = true;

			const inverseMatrix = new THREE.Matrix4();
			inverseMatrix.copy( targetMesh.matrixWorld ).invert();

			const sphere = new THREE.Sphere();
			sphere.center.copy( brushMesh.position ).applyMatrix4( inverseMatrix );
			sphere.radius = params.brushSize;

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
                let r, g, b;
                if (mouseType !== 0) {  // Erase
                    r = 256 - ((params.eraseColor & 0xff0000) >> 16);
                    g = 256 - ((params.eraseColor & 0x00ff00) >> 8);
                    b = 256 - (params.eraseColor & 0x0000ff);
                } else { // Paint
                    r = 256 - ((params.paintColor & 0xff0000) >> 16);
                    g = 256 - ((params.paintColor & 0x00ff00) >> 8);
                    b = 256 - (params.paintColor & 0x0000ff);
                }

				for ( let i = 0, l = indices.length; i < l; i ++ ) {
					const i2 = indexAttr.getX( indices[ i ] );
					colorAttr.setX( i2, r );
					colorAttr.setY( i2, g );
					colorAttr.setZ( i2, b );

				}

				colorAttr.needsUpdate = true;
			}

		} else {
			brushMesh.visible = false;
		}

	}
	controls.update();
	renderer.render( scene, camera );
 	stats.end();
}

function computeVisibleVertices(paintVisible = true) {
	const startTime = window.performance.now();
	const sc = currentView ? currentView.eyept.clone() : camera.position.clone();	// set sc to be sc position if known, otherwise camera position
	const v = new THREE.Vector3();
	const raycaster = new THREE.Raycaster();
	let res = [];
	raycaster.firstHitOnly = true;
	const r=0, g=0, b=VISIBLE_BLUE;   // bright blue for now (really) - and a unique byte for visibility in the blue channel
	const vertexNormal = new THREE.Vector3();
	const bbox = new THREE.Box3();
	const dotLimit = Math.cos(params.filterAngle * Math.PI / 180.);
	//const normDepth = new NormalDepth(currentView ? currentView.viewVec : new THREE.Vector3(1, 0, 0)); // only meaningful if currentView defined
	const normDepth = currentView ? new NormalDepth() : null;

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
			if (currentView && currentView.viewRect) {
				res = raycaster.intersectObject(currentView.viewRect, false, res );
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
				if (normDepth) normDepth.expandByVector(vertToSC, currentView.viewVec);
                if (paintVisible) {
				    colorArray[i] = r;
				    colorArray[i+1] = g;
				    colorArray[i+2] = b;
				    colorAttr.needsUpdate = true;
                }
			}
		}
	}
	if (currentView) currentView.saveExtentInfo(bbox, normDepth);
	console.log("ComputeVisible time = %f milliseconds", window.performance.now() - startTime);
	if (paintVisible) console.log(`Visible vertex count = ${countVisibleVertices()}`)
}

function initGui() {
	gui = new dat.GUI();
	const folderMain = gui.addFolder('Main')
	const folderSession = gui.addFolder('Session');
	const folderDebug = gui.addFolder('Debug');
	folderDebug.close();
	
	function openHelp() {
		window.open("https://comet.photos/help.html");
	}
	params.help = openHelp;
	folderMain.add(params, 'help').name("show help");

	folderMain.add(params, 'paint').onChange( function(newVal) { controls.enabled = !newVal; } );
	folderMain.add(params, 'brushSize' ).min(MINBRUSHSIZE).max(MAXBRUSHSIZE).step(MINBRUSHSIZE).name('brush size');
	folderMain.add(params, 'matchPercent').min(1).max(100).step(1).name('match %').onChange((val)=>{ params.filterByGeometry();});   // need to adjust the filter!
	folderDebug.add(params, 'flatShading').onChange( 
		function(boolFlat) {
			cometMaterial.flatShading = boolFlat;
			cometMaterial.needsUpdate = true;} );
	folderDebug.addColor(params, 'paintColor').name("paint color");
	folderDebug.addColor(params, 'eraseColor').name("erase color");
	folderDebug.add(params, 'useNormals');
	folderDebug.add(params, 'filterAngle', 0, 90);
	folderMain.add(params, 'autoCam').name('auto-cam').onChange((v) => {
		if (!v) {					// allow rotations about center again!
			controls.target = new THREE.Vector3(0, 0, 0);
			controls.update();
		} else {
			if (currentView) currentView.applyToCamera(camera, controls);
		}
	});

	params.computeVisible = computeVisibleVertices;
	folderDebug.add(params, 'computeVisible');

    function clearPaint () {     // CLEAR / ERASE ALL
			colorArray.fill(COMETGREYVAL);
			colorAttr.needsUpdate = true;
			paintInfo = null;
			if (!CometView.PREPROCESSING) paintDependentFiltersAccessor();
	    }
    params.clear = clearPaint;
    folderMain.add(params, 'clear');

	function clearAndDisposeCometView () {
		if (currentView) {
			currentView.clear(scene);
            currentView.dispose();
			currentView = null;
		}
	}

	function updateMaterials() {			// if sunlight changes, need to update materials because of shadows
		cometMaterial.needsUpdate = true;	
		if (currentView && currentView.decal) 
			currentView.decal.needsUpdate = true;   
	}

	function computeDepthInfo () {
		if (currentView && !currentView.normDepth) {
			computeVisibleVertices(false);        // this will set CometView.normDepth
			currentView.computeCometViewPost();       // this will recompute a lot of info, but update the corners and set the plane at normDepth.depthMin
		}
	}

	function getInfoString(i) {
		if (!paintInfo) return `#${viewArray[i].index}  m2: ${viewArray[i].m2}`
		const tmpSC = viewArray[i].sc_v.clone();
		const scVec = tmpSC.sub(paintInfo.avgLoc).normalize();	// norm vector from paintCenter to SC
		const emissionDot = scVec.dot(paintInfo.avgNorm);
		const emissionAngle = Math.round(180*Math.acos(emissionDot)/Math.PI);
		const incidDot = viewArray[i].sun_n.dot(paintInfo.avgNorm);
		const incidAngle = Math.round(180*Math.acos(incidDot)/Math.PI);
		const phaseDot = scVec.dot(viewArray[i].sun_n);
		const phaseAngle = Math.round(180*Math.acos(phaseDot)/Math.PI);
		return `#${viewArray[i].index}  m2: ${viewArray[i].m2}  e: ${emissionAngle}  i: ${incidAngle}  p: ${phaseAngle}`
	}

    function loadCometView (vd) {
		if (vd === currentView) return;	// loading the currentView should not do anything
        clearAndDisposeCometView();    // don't erase paint, unless we are preprocessing
		if (CometView.PREPROCESSING) clearPaint();
        currentView = new CometView(vd, params.imgFormat);
		if (!CometView.PREPROCESSING && (params.decalImage || params.outline)) {
			computeDepthInfo();
	        if (params.outline) currentView.addViewOutline(scene);
			if (params.decalImage) currentView.addDecal(scene, cometMesh, paintInfo ? paintInfo.avgLoc : null);
		}
		if (params.autoCam) currentView.applyToCamera(camera, controls);
		currentView.updateSunLight(sunlight);	// whether it is lit or not...
		updateMaterials();
    }

    function loadCometViewByIndex(index) {
        if (viewArray && index >= 0 && index < viewArray.length) {
            loadCometView(viewArray[index]);
            params.name = viewArray[index].nm;
            params.time = viewArray[index].ti;
            params.index = index;
			params.info = getInfoString(index);
			viewIndex = index;
        }
    }

	loadCometViewByIndexAccessor = loadCometViewByIndex;	// so can run this outside of init_gui scope - not ideal, but this version is just for preprocessing

    params.memStats = () => {
        console.log("Textures: %i. Geometries %i.", renderer.info.memory.textures, renderer.info.memory.geometries);
    }
    folderDebug.add(params, 'memStats');


    folderDebug.add(params, 'imgFormat', {PNG:'PNG', JPG:'J80', KTX2:'KTX2'}).onChange((val) => {
        console.log("imgFormat val was changed to %s", val);
        if (currentView) {
            if (params.decalImage)
                currentView.removeDecal(scene);
            currentView.loadImage(params.imgFormat);
            if (params.decalImage)
                currentView.addDecal(scene, cometMesh, paintInfo ? paintInfo.avgLoc : null);
        }
    });

	folderMain.add(params, 'decalImage').listen().onChange((val) => {
		if (val && currentView) {
			computeDepthInfo();
			currentView.addDecal(scene, cometMesh, paintInfo ? paintInfo.avgLoc : null);
		} else if (!val && currentView) {
			currentView.removeDecal(scene);
		}
	}).name('image');

	folderMain.add(params, 'outline').listen().onChange((val) => {
		if (val && currentView) {
			computeDepthInfo();
			currentView.addViewOutline(scene);
		} else if (!val && currentView) {
			currentView.removeViewOutline(scene);
		}
	});

	function removeDefaultLights(scene) {
		scene.remove(light1);
		scene.remove(light2);
		scene.remove(light3);
	}

	function addDefaultLights(scene) {
		scene.add(light1);
		scene.add(light2);
		scene.add(light3);
	}

    folderMain.add(params, 'useSun').name('use sun').listen().onChange((val) => {
		if (val) {
            removeDefaultLights(scene);
			scene.add(sunlight);
		} else {
            addDefaultLights(scene);
			scene.remove(sunlight);
		}
		updateMaterials();
	});   

    folderMain.add(params, 'name').listen().onChange((val) => {
		for (let i = 0; i < viewArray.length; i++) {
			if (viewArray[i].nm === val)
				loadCometViewByIndex(i);
			// else an error popup?
		}
	});
    folderMain.add(params, 'time').listen();

    var indexSelector = folderMain.add(params, 'index').listen().min(0).max(1000).step(1).onChange((val)=> {   // max is arbitrary here, set for real in loadJson
        loadCometViewByIndex(val);
    });

	function cacheViewArrayInfo() {
		for (let i = 0; i < ogViewArray.length; i++) {
			ogViewArray[i].index = i;		// save index
			if ('b1' in ogViewArray[i])
				ogViewArray[i].bbox = new THREE.Box3(new THREE.Vector3(...ogViewArray[i].b1), new THREE.Vector3(...ogViewArray[i].b2));
			ogViewArray[i].sun_n = new THREE.Vector3(...ogViewArray[i].su).normalize();
			ogViewArray[i].sc_v = new THREE.Vector3(...ogViewArray[i].sc);
			ogViewArray[i].filter = 0;
		}
	}

    function loadJson() {
        let startTime = window.performance.now();
        fetch("../viewdata.json")          // load all of the view data
            .then((response) => response.json())  // parse the response as JSON
            .then((data) => {
                ogViewArray = data;
                indexSelector.max(ogViewArray.length-1);
                console.log("Length of Json array is %i", ogViewArray.length);
				params.status = `Loaded ${ogViewArray.length} images.`
                viewIndex = -1;
                console.log("Fetched JSON in %f milliseconds", window.performance.now() - startTime);
				startTime = window.performance.now();
				cacheViewArrayInfo();
				console.log(`cacheViewArrayInfo() in ${window.performance.now() - startTime} milliseconds`);
				viewArray = [...ogViewArray];
                if (cometMesh) nextImage();			// only do this if comet is loaded!
            })
            .catch((error) => console.error(error));
    }
	loadJsonAccessor = loadJson;

    function nextImage() {
        if (viewArray && viewIndex < viewArray.length-1) {
            loadCometViewByIndex(viewIndex + 1);
        }
    }
    params.nextImage = nextImage;
    folderMain.add(params, 'nextImage').name('next image');

    function previousImage() {
        if (viewArray && viewIndex > 0) {
            loadCometViewByIndex(viewIndex - 1);
        }
    }
    params.previousImage = previousImage;
    folderMain.add(params, 'previousImage').name('previous image');

	let startedSession = false;
    function preProcess() {
		preProcessStart = window.performance.now();
		CometView.PREPROCESSING = true;
		if (!startedSession && ogViewArray) {
			socket.emit('PPclientReadyToStart', {count: ogViewArray.length});
			startedSession = true;
		}
    }
    params.preProcess = preProcess;
    folderDebug.add(params, 'preProcess');

	function testNode() {
		socket.emit('clientRequestsTest', {test: 2});
    }
    params.testNode = testNode;
    folderDebug.add(params, 'testNode');

	const FM_M2 = 1;
	const FM_BBOX = 2;
	const FM_EMISSION = 4
	const FM_PHASE = 8
	const FM_INCIDENCE = 16;

	function filterCleanup () {
		viewArray = ogViewArray.filter((item) => item.filter === 0);
		params.status = `Matching: ${viewArray.length} / ${ogViewArray.length}`;
		if (viewArray.length > 0 && currentView) {							// will need to update viewIndex
			const newIndex = viewArray.findIndex(info => info.index === currentView.index);
			loadCometViewByIndexAccessor(newIndex >= 0 ? newIndex : 0); 		// set CometView index to newIndex (0 otherwise) and reload if necessary
			indexSelector.max(viewArray.length-1); 
		}
		// should we do anything if viewArray is empty?
	}

	let imgSelBuffer = null, imgSelArray;
	function initializeImgSelector() {
		if (!imgSelBuffer) {
			const buffBytes = Math.ceil(ogViewArray.length/8);
			imgSelBuffer = new ArrayBuffer(buffBytes);
			imgSelArray = new Uint8Array(imgSelBuffer);
		} else {
			imgSelArray.fill(0);
		}
	}


	function filterByGeometry() {
		//console.log(`SET BITS at BEGINNING OF FILTERBYGEOMETRY: ${countBits(visArray)}`)		
		//let nInter = 0;
		if (!paintInfo) return;
		if (!imgSelBuffer) initializeImgSelector();
		for (let i = 0; i < ogViewArray.length; i++) {
			if (ogViewArray[i].bbox.intersectsBox(paintInfo.bbox)) {
				setNthBit(i, imgSelArray);
				//nInter++;
			}
		}
		const mustMatch = Math.ceil(paintInfo.nPainted * (params.matchPercent / 100.0)); // must match at least one, hence ceil
		//console.log(`In filterByGeometry, got ${nInter} bbox matches.`)
		//socket.emit('clientRequestsVisCount', visArray);  // test for now
		//console.log(`SET BITS IN VISARRAY at clientRequestsVis: ${countBits(visArray)}`)
		//console.log(`filterByGeometry: first 4 bytes of visArray: %d %d %d %d`, visArray[0], visArray[1], visArray[2], visArray[3]);
        socket.emit('clientRequestsVis', {mustMatch: mustMatch, imgSel: imgSelArray, visAr: visArray});  //
    }
	
    params.filterByGeometry = filterByGeometry;
    folderDebug.add(params, 'filterByGeometry');

	socket.on('serverProvidesVis', function(message) { // message is the returned, edited imgSelBuffer (or array?)
		console.log("Got a serverProvidesVis message!");
		//let nVis = 0;
		const newVisArray = new Uint8Array(message);	// message is a Buffer, need to make it a Uint8Array
		for (let i = 0; i < ogViewArray.length; i++) {
			if (getNthBit(i, newVisArray) != 0) {
				ogViewArray[i].filter &= ~FM_BBOX;		// success - clear the bit
				//nVis++;
			}
			else
				ogViewArray[i].filter |= FM_BBOX;		// failure - set the bit
		}
		// console.log(`The filter for 16045 is ${ogViewArray[16045].filter}`);
		// console.log(`The getNthBit returns: ${getNthBit(16045, newVisArray)}`)
		// console.log(`After serverProvidesVis, ${nVis} were visible..`);
		filterCleanup();								// set the status for now
	});


	function filterByM2() {
		for (let i = 0; i < ogViewArray.length; i++) {
			if (ogViewArray[i].m2 <= params.m2)
				ogViewArray[i].filter &= ~FM_M2;		// success - clear the bit
			else
				ogViewArray[i].filter |= FM_M2;		// failure - set the bit
		}
		filterCleanup();								// set the status for now
	}

	function filterByEmission() {
		if (!paintInfo) return;
		const minCos = Math.cos(params.emission*Math.PI/180.0);
		const tmpSC = new THREE.Vector3();				// avoid allocating memory each iteration
		for (let i = 0; i < ogViewArray.length; i++) {
			tmpSC.copy(ogViewArray[i].sc_v);
			const scVec = tmpSC.sub(paintInfo.avgLoc).normalize();	// norm vector from paintCenter to SC
			if (scVec.dot(paintInfo.avgNorm) >= minCos)
				ogViewArray[i].filter &= ~FM_EMISSION;		// success - clear the bit
			else
				ogViewArray[i].filter |= FM_EMISSION;		// failure - set the bit
		}
		filterCleanup();								// set the status for now
	}

	function filterByIncidence() {
		if (!paintInfo) return;
		const minCos = Math.cos(params.incidence*Math.PI/180.0);
		for (let i = 0; i < ogViewArray.length; i++) {
			if (ogViewArray[i].sun_n.dot(paintInfo.avgNorm) >= minCos)	// at this distance, sun is purely directional
				ogViewArray[i].filter &= ~FM_INCIDENCE;		// success - clear the bit
			else
				ogViewArray[i].filter |= FM_INCIDENCE;		// failure - set the bit
		}
		filterCleanup();								// set the status for now
	}

	function filterByPhase() {
		if (!paintInfo) return;
		const minCos = Math.cos(params.phase*Math.PI/180.0);
		const tmpSC = new THREE.Vector3();				// avoid allocating memory each iteration
		for (let i = 0; i < ogViewArray.length; i++) {
			tmpSC.copy(ogViewArray[i].sc_v);
			const scVec = tmpSC.sub(paintInfo.avgLoc).normalize();	// norm vector from paintCenter to SC
			if (scVec.dot(ogViewArray[i].sun_n) >= minCos)
				ogViewArray[i].filter &= ~FM_PHASE;		// success - clear the bit
			else
				ogViewArray[i].filter |= FM_PHASE;		// failure - set the bit
		}
		filterCleanup();								// set the status for now
	}

	function paintDependentFilters() { // M2 is prefiltered on load - no m2 > 10 are loaded, plus not paint dependent
		if (paintInfo) {
			filterByGeometry();		// see if fast enough to do here
			filterByEmission();
			filterByIncidence();
			filterByPhase();
		} else {
			for (let i = 0; i < ogViewArray.length; i++)
				ogViewArray[i].filter &= ~(FM_BBOX | FM_EMISSION | FM_INCIDENCE | FM_PHASE);
			filterCleanup();
		}
	}
	paintDependentFiltersAccessor = paintDependentFilters;

	folderMain.add(params, 'm2').min(.1).max(10).step(.1).onChange((val)=> { 
		filterByM2();
    });

	folderMain.add(params, 'emission').min(1).max(90).step(1).onChange((val)=> { 
		filterByEmission();
    });

	folderMain.add(params, 'incidence').min(1).max(90).step(1).onChange((val)=> { 
		filterByIncidence();
    });

	folderMain.add(params, 'phase').min(1).max(180).step(1).onChange((val)=> {
		filterByPhase();
    });

	folderMain.add(params, 'info').listen();
	folderMain.add(params, 'status').listen();

	function linearAlgebraTest() {
		CometView.worstIndex = -1;
		CometView.cornerMaxDist = 0;
		CometView.normalMaxDelta = 0;
		CometView.upMaxDelta = 0;
		CometView.cornerSumDelta = 0;
		CometView.normalSumDelta = 0;
		CometView.upSumDelta = 0;
		for (let i = 0; i < viewArray.length; i++) {
			loadCometViewByIndex(i);
		}
		console.log(`Worst offending image is index ${CometView.worstIndex}`);
		console.log(`Normal Deltas: worst ${CometView.normalMaxDelta}, average ${CometView.normalSumDelta / viewArray.length}`);
		console.log(`Up Deltas: worst ${CometView.upMaxDelta}, average ${CometView.upSumDelta / viewArray.length}`);
		console.log(`Corner Deltas: worst ${CometView.cornerMaxDist}, average ${CometView.cornerSumDelta / viewArray.length}`);
	}
	params.linearAlgebraTest = linearAlgebraTest;
	folderDebug.add(params, 'linearAlgebraTest');

	function download(filename, text) {  // Downloads filename with contents text. Thanks ChatGPT!
		var element = document.createElement('a');
		element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
		element.setAttribute('download', filename);
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	  }

	function downloadNames() {			// Currently, download a file with all the names in current viewArray
		let names = "";
		for (let i = 0; i < viewArray.length; i++) {
			names += viewArray[i].nm + '\n';
		}
		download("names.txt", names);
	}
	params.downloadNames = downloadNames;
	folderDebug.add(params, 'downloadNames').name('download names');

	folderSession.add(params, 'sessionName').name('session name');

	function saveSession () {
		const session = {};
		session.camPos = camera.position.toArray();
		session.camUp = camera.up.toArray();
		const lookAtVector = new THREE.Vector3(0, 0, -1);
		session.lookAt = lookAtVector.applyQuaternion(camera.quaternion).toArray();
		session.target = controls.target.toArray();
		session.sessionName = params.sessionName;
		session.paint = params.paint;
		session.brushSize = params.brushSize;
		session.matchPercent = params.matchPercent;
		session.autoCam = params.autoCam;
		session.decalImage = params.decalImage;
		session.outline = params.outline;
		session.useSun = params.useSun;
		session.name = params.name;
		session.m2 = params.m2;
		session.emission = params.emission;
		session.incidence = params.incidence;
		session.phase = params.phase;
		session.flatShading = params.flatShading;
		session.paintColor = params.paintColor;
		session.eraseColor = params.eraseColor;
		session.useNormals = params.useNormals;
		session.filterAngle = params.filterAngle;
		session.imgFormat = params.imgFormat;
		if (visBuffer) {
			const str = String.fromCharCode.apply(null, visArray);
			session.vis = btoa(str);	// convert to Base64
		} else session.vis = "";
		socket.emit('clientRequestsSessionSave', session);
		alert(`Your session has been saved as: ${session.sessionName}`);
	}
	params.saveSession = saveSession;
	folderSession.add(params, 'saveSession').name('save session');

	function loadSession() {
		socket.emit('clientRequestsSessionLoad', params.sessionName);
	}
	params.loadSession = loadSession;
	folderSession.add(params, 'loadSession').name('load session');

	socket.on('serverProvidesSessionLoad', function(session) { // message is json session object
		if (!session) {
			alert(`Could not find session: '${params.sessionName}'.`);
			return;
		}
		camera.position.set(...session.camPos);
		camera.lookAt(...session.lookAt);
		camera.up.set(...session.camUp);
        camera.updateProjectionMatrix();
		controls.target = new THREE.Vector3(...session.target);
		params.sessionName = session.sessionName;
		params.paint = session.paint;
		params.brushSize = session.brushSize;
		params.matchPercent = session.matchPercent;
		params.autoCam = session.autoCam;
		params.decalImage = session.decalImage;
		params.outline = session.outline;
		params.useSun = session.useSun;
		params.name = session.name;
		params.m2 = session.m2;
		params.emission = session.emission;
		params.incidence = session.incidence;
		params.phase = session.phase;
		params.flatShading = session.flatShading;
		params.paintColor = session.paintColor;
		params.eraseColor = session.eraseColor;
		params.useNormals = session.useNormals;
		params.filterAngle = session.filterAngle;
		params.imgFormat = session.imgFormat;
		params.clear();			// clear paint regardless...
		if (session.vis != "") {
			const binaryString = atob(session.vis);
			const u8 = Uint8Array.from(binaryString, c => c.charCodeAt(0));
			for (let i = 0; i < colorArray.length/3; i++) {
				if (getNthBit(i, u8)) {
					const offset = 3*i;
					colorArray[offset] = params.paintColor >> 16;
					colorArray[offset+1] = (params.paintColor & 0x00ff00) >> 8
					colorArray[offset+2] = (params.paintColor & 0x0000ff);
				}
			}
			gatherPaintInfoAccessor();
		}
		gui.controllersRecursive().forEach( c => c.updateDisplay() );
	});

    /*
    gui.add(params, 'projectImage').listen().onChange((val) => {
		if (val && currentView) {
			currentView.addProjection(camera, cometMesh, cometMaterial);
		} else if (!val && currentView) {
			currentView.removeProjection(cometMaterial);
		}
	});
    */

	gui.open();
}

const VISIBLE_BLUE= 249;

function countVisibleVertices() {
	let nVerts = 0;
	let i = 2;
	const arraySize = colorArray.length;
	while (i < arraySize-1) {
		if (colorArray[i] == VISIBLE_BLUE) 		// visibility blue :-) - made a unique byte so we only have to check blues
			nVerts++;
		i += 3;
	}
	return nVerts;
}


let visBuffer = null;
let visArray;

function setNthBit(n, array) {
	const byteIndex = Math.floor(n / 8);
	const bitIndex = n % 8;
	const mask = 1 << bitIndex;
	array[byteIndex] |= mask;
}

function getNthBit(n, array) {
	const byteIndex = Math.floor(n / 8);
	const bitIndex = n % 8;
	const mask = 1 << bitIndex;
	return (array[byteIndex] & mask);
}

function initializeVisBuffer() {
	if (!visBuffer) {
		const buffBytes = Math.ceil(cometGeometry.attributes.position.count/64)*8;  // each on a 64 bit boundary for efficiency if we address outside of Javascript
		visBuffer = new ArrayBuffer(buffBytes);
		visArray = new Uint8Array(visBuffer);
	} else {
		visArray.fill(0);
	}
}

function updateVisBuffer() {
	initializeVisBuffer();
	let i = 2;
	let vertIndex = 0;
	const arraySize = colorArray.length;
	while (i < arraySize) {
		if (colorArray[i] == VISIBLE_BLUE) { 		// visibility blue :-) - made a unique byte so we only have to check blues
			setNthBit(vertIndex, visArray);
		}
		i += 3;
		vertIndex++;
	}
}

socket.on('PPserverRequestsVisibility', function(message) { // {index:, name:}
	console.log(`Got a PPserverRequestsVisibility: ${message.index}`);
    if (ogViewArray[message.index].nm === message.name) {	// got a match! 
		loadCometViewByIndexAccessor(message.index);		// loaded requested index - this essentially clears the comet color buffers and sets the view parameters
		computeVisibleVertices(true);					// painting will be useful later

		const bbox = currentView.bbox;
		message.bbox = {min: bbox.min.toArray(), max: bbox.max.toArray()};
		const depth = currentView.normDepth;
		message.depth = {min: depth.depthMin, max: depth.depthMax};
		updateVisBuffer();
		message.visBuffer = visArray;
		socket.emit('PPclientProvidesVisibility', message);
		console.log('Sending a PPclientProvidesVisibility %O', message)
		if (message.index === ogViewArray.length-1) {
			/*
			console.log(`Average vertex count over entire run is ${totalVerts / viewArray.length}`);
			for (let i = 0; i < 20; i++) {
				console.log(`Bucket ${i} m^2/pixel: ${imgCount[i]} images, av. vis. vertices: ${imgCount[i] > 0 ? vertCounts[i]/imgCount[i] : 0}`)
			}
			*/
			CometView.PREPROCESSING = false;
			console.log(`Finished in ${(window.performance.now() - preProcessStart) / 1000} seconds!!!`);
		}
	} else {
		console.error("Bad index/name registration between client and server - debug it!");
	}
}); 

const BRUSH_RED = 0xf1;		// cannot let user set this in final version!

function gatherPaintInfo() {
	paintInfo = {};
	initializeVisBuffer();
	// console.log(`AFTER INITIALIZE VISBUFFER: ${countBits(visArray)}`);
	// get bbox, average vertex location, average normal location ...
	let bbox = new THREE.Box3();
	let loc = new THREE.Vector3(0, 0, 0);
	let norm = new THREE.Vector3(0, 0, 0);
	let thisVec = new THREE.Vector3();
	let nPainted = 0;
	const totalVerts = cometGeometry.attributes.position.count;
	for (let i = 0; i < totalVerts; i++) {
		const arrayPos = i*3;
		if (colorArray[arrayPos] == BRUSH_RED) {
			thisVec.fromArray(cometGeometry.attributes.position.array, arrayPos);
			bbox.expandByPoint(thisVec);
			loc.add(thisVec);
			thisVec.fromArray(cometGeometry.attributes.normal.array, arrayPos);
			norm.add(thisVec);
			setNthBit(i, visArray);
			nPainted++;
			//console.log(`Selected vertex ${i}.`)
		}
	}
	paintInfo.avgLoc = loc.divideScalar(nPainted);
	paintInfo.avgNorm = norm.divideScalar(nPainted).normalize();
	paintInfo.bbox = bbox;
	paintInfo.nPainted = nPainted;
	console.log(`Painted vertices: ${nPainted}`);
	// console.log(`SET BITS AT END OF GATHERPAINTINFO: ${countBits(visArray)}`);
	// console.log(`End of gatherPaintInfo: first 4 bytes of visArray: %d %d %d %d`, visArray[0], visArray[1], visArray[2], visArray[3]);
	paintDependentFiltersAccessor();
}

gatherPaintInfoAccessor = gatherPaintInfo;		// Hack

initGui();
init();
render();
