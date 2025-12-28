// cometserver.js -
//    Main server code for Comet.Photos application.
//    Sets up an express/httpolyglot web server, serves static files,
//    and sets up socket.io event handlers for client-server communication.

const express = require('express');
const socketIO = require('socket.io');
const http = require('http');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { openInBrowser } = require('./openInBrowser.js');


// STEP 1: parse arguments
const parseArgs = require('./parseArgs.js');
const DEFAULTS = {
  port: 8080,
  http_port: 8081,
  //catalog: "../data/datasets.json"
};
const args = parseArgs(DEFAULTS);

console.log("Comet.Photos server starting with arguments:", args);

// Step 2 - Check for data directory
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: Required data directory not found at ${dataDir}. Please see the Comet.Photos GitHub page for data installation instructions.`);
    process.exit(1);
}

// STEP 3 - Set up the Web Server
var app = express();

// Redirect any .gz request to download.comet.photos/releases (for the app or datasets)
app.use((req, res, next) => {
    if (req.path.endsWith('.gz')) {
        return res.redirect(302, `https://download.comet.photos/releases${req.path}`);
    }
    next();
});

let key = null, cert = null;
try {
    if (args.keyfile) key = fs.readFileSync(args.keyfile);
    if (args.certfile) cert = fs.readFileSync(args.certfile);
} catch (error) {
    console.warn("SSL files not found, defaulting to HTTP.");
}

let server;
if (key && cert) {
    // 3A. Primary Secure Server (Port 443/args.port)
    server = https.createServer({ key, cert }, app); //
    
    // 3B. Dedicated Redirect Server (Port 80/args.http_port)
    http.createServer((req, res) => { //
        const host = req.headers.host.split(':')[0]; // Strip existing port
        const targetPort = args.port === 443 ? '' : `:${args.port}`;
        res.writeHead(301, { "Location": `https://${host}${targetPort}${req.url}` });
        res.end();
    }).listen(args.http_port || 80);
    
    console.log(`HTTPS server ready. Redirecting port ${args.http_port || 80} to ${args.port}`);
} else {
    // Fallback to plain HTTP if no certs are found
    server = http.createServer(app);
}

// Set long keep-alive for the primary server
server.keepAliveTimeout = 900000;   // 15 mins
server.headersTimeout = 901000;

// Attach Socket.io to the primary server
const io = socketIO(server, {
  maxHttpBufferSize: 100 * 1024 * 1024  // to accomodate large logs
});


// Step 4 - set up compression only if not running locally
if (!args.open) {
    const compression = require('compression');
    const skipExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'gz'];
    const forceExt = ['obj'];

    const shouldCompress = (req, res) => {
        const url = req.url.toLowerCase();
        const ext = url.split('.').pop();   // no dot, e.g. "jpg"

        if (skipExt.includes(ext)) return false;
        if (forceExt.includes(ext)) return true;

        // Default for JSON, JS, HTML, CSS, etc.
        return compression.filter(req, res);
    };

    app.use(compression({ filter: shouldCompress }));
}

app.use(cors());  // in case comet.photos gets images from another server

const clientDistDir = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientDistDir, {etag: true, lastModified: true, maxAge: args.open ? 0 : "1h"}));
app.use(express.static(dataDir, {etag: true, lastModified: true, maxAge: args.open ? 0 : "7d",
    setHeaders(res, filePath) { // cache jpgs to 365 days
    if (filePath.toLowerCase().endsWith('.jpg')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }  
}}));

server.listen(args.port, () => {
    console.log(`Server running on port ${args.port}`);
});

// Step 5 - Open the browser if requested
if (args.open) {
    const params = args.preprocess ? '?preprocess' : args.test ? `?test=${args.test}` : '';
    const url = `http://localhost:${args.port}${params}`;
    openInBrowser(url);
    console.log(`Starting up browser. To open additional comet.photos windows, browse to ${url}`);
    console.log(`To exit the server, type Control-C.`)
}

// Step 6 - Load and run the relevant event handlers
const { commonHandlers } = require ('./commonHandlers.js');
let datasets = commonHandlers(io, args);

if (args.preprocess) {
    const { preprocessingHandlers } = require('./preprocessingHandlers.js');
    preprocessingHandlers(io, datasets);
} 
else {
    const { runtimeHandlers } = require('./runtimeHandlers.js');
    runtimeHandlers(io, datasets);
}
