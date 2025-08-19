import * as THREE from 'three';
import { OBJLoader2 } from 'wwobjloader2'
import ProjectedMaterial from 'three-projected-material';
import { CometView } from './view/CometView.js';
import { CometPhotosApp } from './app/CometPhotosApp.js';
import { io } from 'socket.io-client';
import { COMETGREYVAL, COMETCOLOR } from './core/constants.js';

const dataset = {
	model:"cg-dlr_spg-shap7-v1.0_200Kfacets.obj",
	metaData: "imageMetadataNAC.json",
	visTable: "visTableNAC.bin",
	FOV: 2.20746,
	defaultRes: 2048,
	initialEye: [100, 100, 100],
	longName: "NAC Rosetta Images of Comet 67P",
	shortName: "NAC",
	dataFolder: "",
	modelFolder: "",
};


// Connect to the server, using a socket.io connection with a unique ID
function generateSessionID() {	
	return '_' + Math.random().toString(36).substring(2, 11);
 };

var socket = io({
	query: {
	  clientID: generateSessionID()
	},
  });


function processArguments() {
	// Create a new URL object
	const urlString = window.location.href;
	const url = new URL(urlString);
	const searchParams = url.searchParams;
	let preprocessMode = searchParams.has('preprocess');
	let debugMode = searchParams.has('debug') || preprocessMode;
	return {debugMode, preprocessMode};
}

function init() {
	const {debugMode, preprocessMode} = processArguments();

	const app = new CometPhotosApp(dataset, socket, { debugMode, preprocessMode });

	CometView.FOV = dataset.FOV;			// Load relevant dataset parameters
	CometView.defaultRes = dataset.defaultRes;

	// Load the 3D model
	const objLoader2 = new OBJLoader2().setUseIndices(true);
	
		const loadData = (object3d) => {
			const sceneMgr = app.sceneMgr;
			sceneMgr.cometGeometry = object3d.children[0].geometry;
			sceneMgr.cometGeometry.computeVertexNormals();                
			sceneMgr.colorArray = new Uint8Array(sceneMgr.cometGeometry.attributes.position.count * 3);
			sceneMgr.colorArray.fill(COMETGREYVAL);
			sceneMgr.colorAttr = new THREE.BufferAttribute(sceneMgr.colorArray, 3, true);
			sceneMgr.colorAttr.setUsage(THREE.DynamicDrawUsage);
			app.ROI.allocatePaintBuffer(sceneMgr.cometGeometry.attributes.position.count, sceneMgr.colorArray);
			sceneMgr.cometGeometry.setAttribute('color', sceneMgr.colorAttr);
			sceneMgr.cometMaterial = new ProjectedMaterial ({ 
				cover: false,
				color: COMETCOLOR,
				transparent: false,
				opacity: 1.0,
				vertexColors: true,
				flatShading: sceneMgr.state['flatShading']
				});
			sceneMgr.targetMesh = new THREE.Mesh(sceneMgr.cometGeometry, sceneMgr.cometMaterial);
			sceneMgr.targetMesh.geometry.computeBoundsTree();
			sceneMgr.scene.add(sceneMgr.targetMesh);
		};
	
		objLoader2.load(dataset.model, loadData);

	// Load the image metadata
	const url = preprocessMode ? "imageMetadata_phase1.json" : dataset.metaData; // hardwired json file for preprocessing only
	fetch(url) 	// Fetch the JSON file
		.then(response => response.json()) // Parse the response as JSON
		.then(data => {  // Now "data" contains the parsed JSON object
			app.installMetadata(data);
			document.title = `Comet.Photos: ${dataset.longName} (${data.length} images)`;
		})
		.catch(error => {
			console.error('Error loading JSON:', error);
		});

	// Let the server know on client shutdown, so it too can shut down if running locally
	window.addEventListener('beforeunload', () => {  
		socket.emit('clientShutdown'); 
	});
}

init();
