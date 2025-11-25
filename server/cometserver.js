// cometserver.js -
//    Main server code for Comet.Photos application.
//    Sets up an express/httpolyglot web server, serves static files,
//    and sets up socket.io event handlers for client-server communication.

const express = require('express');
const socketIO = require('socket.io');
const httpolyglot = require('httpolyglot');
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
let key = null, cert = null;
try {
    if (args.keyfile) key = fs.readFileSync(args.keyfile);
    if (args.certfile) cert = fs.readFileSync(args.certfile);
} catch (error) {
    console.warn("Warning: Key or certificate file not found or could not be read.");
    console.warn("Defaulting to HTTP mode.");
    key = cert = null;  // Clear both to ensure fallback to http mode
}
const options = (key && cert) ? {key, cert} : {};
var server = httpolyglot.createServer(options, app);

const io = socketIO(server, {
  maxHttpBufferSize: 100 * 1024 * 1024  // to accomodate log files
});

if (args.redirect) {  // Redirect all http traffic to https if args.redirect is set
    const httpApp = express();
    const httpServer = httpolyglot.createServer({}, httpApp);

    // Redirect all HTTP traffic to HTTPS
    httpApp.use((req, res) => {
        console.log(`Not https: redirecting: ${req.url}   IP= ${req.ip || req.socket.remoteAddress}`);
        const host = req.headers.host.replace(/:\d+$/, ':' + args.port); // Replace port if necessary
        res.redirect(`https://${host}${req.url}`);
    });

    // Start the HTTP server
    httpServer.listen(args.http_port, () => {
        console.log(`HTTP server running and redirecting to HTTPS on port ${args.http_port}`);
    });
}

// Step 4 - set up compression only if not running locally
if (!args.open) {   
    const compression = require('compression');
    const shouldCompress = (req, res) => {
        if (req.url.endsWith('.obj'))    // explictly compress .obj files
            return true;

        return compression.filter(req, res); // Default filter for other cases (e.g., .js, .json, .html)
    };

    const compressionMiddleware = compression({ filter: shouldCompress }); // Initialize once
    app.use(compressionMiddleware); // Files compressed as set by default filter + .obj files
}


app.use(express.static('../client/dist'));
app.use(express.static('../data'));


server.listen(args.port, () => {
    console.log(`Server running on port ${args.port}`);
}).on('error', (err) => {
    console.log(`Failed to start server: ${err.message}. Already running?`);
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
