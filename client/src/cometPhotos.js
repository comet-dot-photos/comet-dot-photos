// cometPhotos.js - main entry point for the Comet.Photos client application.
//   	Processes URL parameters, connects to the server via socket.io to fetch
//      the dataset catalog, and initializes the CometPhotosApp.


import { CometPhotosApp } from './app/CometPhotosApp.js';
import { io } from 'socket.io-client';


// Connect to the server, using a socket.io connection with a unique ID
function generateSessionID() {	
	return '_' + Math.random().toString(36).substring(2, 11);
 };

var socket = io({
	query: {
	  clientID: generateSessionID()
	},
  });


function processURL(preprocessMode) {
	// Create a new URL object
	const urlString = window.location.href;
	const url = new URL(urlString);
	const searchParams = url.searchParams;
	const debugMode = searchParams.has('debug') || preprocessMode; // debug mode if requested or in preprocess mode
	const dsOnURL = searchParams.get('dataset'); // dataSet on url - null if not present
	const host = window.location.hostname;
	const isLocal = (host === "localhost" || host === "127.0.0.1" || host === "::1"); // close enough
	const runTest = isLocal ? searchParams.get('test') : null; // test name - only if provided & local
	return {debugMode, preprocessMode, isLocal, dsOnURL, runTest}
}

function init(dsArray, preprocessMode) {
	const opts = processURL(preprocessMode);
	window.app = new CometPhotosApp(dsArray, socket, opts);

	// Let the server know on client shutdown, so it too can shut down if running locally
	window.addEventListener('beforeunload', () => {  
		socket.emit('clientShutdown'); 
	});
}

// Get the dataset and start initialization and loading...
socket.emit('clientRequestsDatasets', null, resp => {
	const {datasets, preprocessMode} = resp;
	if (datasets && datasets.length > 0) {
		console.log('Client received datasets.');
		init(datasets, preprocessMode);
	} else console.log('Client failed to receive datasets.');
	});

