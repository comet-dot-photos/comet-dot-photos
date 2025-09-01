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


function processURL() {
	// Create a new URL object
	const urlString = window.location.href;
	const url = new URL(urlString);
	const searchParams = url.searchParams;
	const debugMode = searchParams.has('debug');
	const dsOnURL = searchParams.get('dataset'); // dataSet on url - null if not present
	const host = window.location.hostname;
	const isLocal = (host === "localhost" || host === "127.0.0.1" || host === "::1"); // close enough
	return {debugMode, isLocal, dsOnURL};
}

function init(datasets, preprocessMode) {
	let {debugMode, isLocal, dsOnURL } = processURL();
	const dataset = datasets.find(x => x.shortName === dsOnURL) ?? datasets[0];
	debugMode |= preprocessMode;  // always be verbose when preprocessing

	window.app = new CometPhotosApp(datasets, dataset, socket, { debugMode, preprocessMode, isLocal });

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

