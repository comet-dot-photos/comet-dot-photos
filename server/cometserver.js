const express = require('express');
const socketIO = require('socket.io');
const httpolyglot = require('httpolyglot');
const fs = require('fs');
const koffi = require('koffi');
const path = require('path');

// Check for data directory
const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: Required data directory not found at ${dataDir}. Please see the Comet.Photos GitHub page for data installation instructions.`);
    process.exit(1);
}

var app = express();

let key = null, cert = null;
try {
    if (process.env.KEYFILE) key = fs.readFileSync(process.env.KEYFILE);
    if (process.env.CERTFILE) cert = fs.readFileSync(process.env.CERTFILE);
} catch (error) {
    console.warn("Warning: Key or certificate file not found or could not be read.");
    console.warn("Defaulting to HTTP mode.");
    key = cert = null;  // Clear both to ensure fallback to http mode
}
const options = (key && cert) ? {key: key, cert: cert} : {};
var server = httpolyglot.createServer(options, app);

var io = socketIO(server);

const port = process.env.PORT || 8080;
const httpPort = process.env.HTTP_PORT || 8081;
const VISFILE = process.env.VISFILE || 'visTableV2.0.bin';
const NEW_VISFILE = VISFILE + '.new';
const VIEWFILE = process.env.VIEWFILE || 'imageMetadataV2.0.json'
const REDIRECT = process.env.REDIRECT;
const localServer = process.env.LAUNCHBROWSER;
const clientSet = new Set();

if (REDIRECT) {  // Redirect all http traffic to https if REDIRECT is set
    const httpApp = express();
    const httpServer = httpolyglot.createServer({}, httpApp);

    // Redirect all HTTP traffic to HTTPS
    httpApp.use((req, res) => {
        console.log(`Not https: redirecting: ${req.url}   IP= ${req.ip || req.socket.remoteAddress}`);
        const host = req.headers.host.replace(/:\d+$/, ':' + port); // Replace port if necessary
        res.redirect(`https://${host}${req.url}`);
    });

    // Start the HTTP server
    httpServer.listen(httpPort, () => {
        console.log(`HTTP server running and redirecting to HTTPS on port ${httpPort}`);
    });
}

if (!localServer) {   // set up compression only if not running locally
    const compression = require('compression');
    const shouldCompress = (req, res) => {
        if (req.url.endsWith('.obj'))    // explictly compress .obj files
            return true;

        return compression.filter(req, res); // Default filter for other cases (e.g., .js, .json, .html)
    };

    const compressionMiddleware = compression({ filter: shouldCompress }); // Initialize once
    app.use(compressionMiddleware); // Files compressed as set by default filter + .obj files
}

app.use(express.static('../client'));
app.use(express.static('../data'));

const { exec } = require('child_process');

function isChromeInstalled() {
    // Define likely Chrome installation paths across all OSes
    const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',   // Windows
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', // Windows
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'), // Windows
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Mac...      
        '/usr/bin/google-chrome', // Linux
        '/usr/bin/google-chrome-stable', // Linux
        '/opt/google/chrome/google-chrome' // linux
    ];

    // Check each path and return true if any one exists
    return chromePaths.some(fs.existsSync);
}


function openInBrowser(url) {
    // Define Chrome commands based on the operating system
    const chromeCmds = {
        win32: `start chrome --new-window --start-maximized ${url}`,
        darwin: `open -a "Google Chrome" "${url}"`,
        linux: `google-chrome --new-window --start-maximized ${url}`
    };
    const cmdLine = chromeCmds[process.platform];

    // Check if Chrome is installed and open the URL in maximized mode
    if (isChromeInstalled() && cmdLine) {
        exec(cmdLine, (error) => {
            if (error) {
                console.error('Failed to open Chrome:', error);
            } else {
                console.log('Chrome opened successfully.');
            }
        });
    } else {
        console.log('Chrome installation not found. Opening default browser.');
        // Only attempt to open in the default browser if Chrome fails
        import('open').then(({ default: open }) => {
            open(url);
            console.log('Opened in default browser');
        }).catch(error => {
            console.error('Failed to open default browser:', error);
        });
    }
}


server.listen(port, () => {
    console.log(`Server running on port ${port}`);
}).on('error', (err) => {
    console.log(`Failed to start server: ${err.message}. Already running?`);
});

// Open the browser after attempting to start the server
if (localServer) {
    openInBrowser(`http://localhost:${port}`);
    console.log(`Starting up browser. To open additional comet.photos windows, browse to http://localhost:${port}`);
    console.log(`To exit the server, type Control-C.`)
}

const { exit } = require('process');


const BYTESPERROW = 12504;  // dependent on the shape model
let fileText;

let libVis, c_load_vbuff, c_check_vis, c_count_vis; // c_check_nRows, c_count_filterarray
const obj_dir = __dirname + '/c_build';  // where the arch/os specific libraries live
function loadCFunctions() {
    let libraryPath = null;
    if (process.platform === 'darwin') {
        if (process.arch === 'x64')
            libraryPath = path.join(obj_dir, 'checkvis.darwin_x64.dylib');
        else if (process.arch === 'arm64') {}
    } else if (process.platform === 'win32') {
        if (process.arch === 'x64')
            libraryPath = path.join(obj_dir, 'checkvis.win_x64.dll');
    } else if (process.platform === 'linux') {
        if (process.arch === 'x64' && fs.existsSync('/etc/redhat-release'))
            libraryPath = path.join(obj_dir, 'checkvis.linux_redhat_x64.so');
        else if (process.arch === 'x64' && fs.existsSync('/etc/debian_version'))
            libraryPath = path.join(obj_dir, 'checkvis.linux_debian_x64.so');
    }
    if (!libraryPath) throw new Error('Unsupported platform');
 
    libVis = koffi.load(libraryPath);
    c_load_vbuff = libVis.func('int load_vbuff(char*, int, int)');
    c_check_vis = libVis.func('void check_vis(int, uint8_t*, uint64_t*)');
    //c_count_vis = libVis.func('int count_vis(uint64_t*)'); - for debugging
}

let viewArray, nRows;

if (process.env.PREPROCESSING) {
    try {
        fileText = fs.readFileSync(VIEWFILE, 'utf-8');
    }
    catch(err) {
        console.error(err.message);
    }
    viewArray = JSON.parse(fileText);
    console.log(`ViewArray.length is ${viewArray.length}`)
} else {
    loadCFunctions();
    const stats = fs.statSync(VISFILE);
    nRows = stats.size / BYTESPERROW;    // each row is BYTESPERROW bytes, file size is nrows*BYTESPERROW;
    if (c_load_vbuff(VISFILE, nRows, BYTESPERROW) == 0)
        console.log(`Successfully loaded ${VISFILE}. nRows = ${nRows}, BYTESPERROW = ${BYTESPERROW}.`);
    else {
        console.log(`Loading of ${VISFILE} failed.`);   // no message back to client though...
        exit();
    }
}

io.on('connection', function(socket) {
    const clientIp = socket.handshake.address;      // print out the IP 
    const ipv4 = clientIp.startsWith('::ffff:') ? clientIp.split(':').pop() : clientIp;
    console.log(`Client connection from: ${socket.handshake.query.clientID} at ${ipv4}`);
    if (localServer)
        clientSet.add(socket.handshake.query.clientID);

    if (process.env.PREPROCESSING) {    // only process the following two messages if PREPROCESSING is set
        socket.on('PPclientReadyToStart', function(message) { //message {count:n}, where count is number of images in client's viewArray
            console.log(`Got a PPclientReadyToStart event with the message ${message}`);
            console.log(`Type of message.count is ${typeof message.count} and value is ${message.count}`);
            if (message.count == viewArray.length) {
                console.log("And client's count is the same as ours!")
            } else {
                console.log("But client's count differs from ours!");
                exit();
            }
            socket.emit('PPserverRequestsVisibility', {index: 0, name: viewArray[0].nm});  // start at the beginning...
        });

        socket.on('PPclientProvidesVisibility', function(message) { // message is {index, name, bbox: {min, max}, depth: {min, max}, visbuffer}
            console.log(`Got a PPclientProvidesVisibility event for index ${message.index}`);
            viewArray[message.index].b1 = message.bbox.min;
            viewArray[message.index].b2 = message.bbox.max;
            viewArray[message.index].d1 = message.depth.min;
            viewArray[message.index].d2 = message.depth.max;
            viewArray[message.index].vb = message.visBuffer;
            if (message.index == viewArray.length-1) {
                console.log("DONE!!!!!!")
                // Remove all elements that had no vertices visible (d1 > d2)
                viewArray = viewArray.filter((val) => val.d1 <= val.d2)
                // FINISH UP CODE HERE!! WRITE TO FILE!!!
                fs.writeFileSync(NEW_VISFILE, '');                       // create a new empty file
                for (let i = 0; i < viewArray.length; i++) {            // append the buffer to the file
                    console.log(`writing line ${i}...`)
                    fs.appendFileSync(NEW_VISFILE, viewArray[i].vb);
                    delete viewArray[i].vb;                             // delete buffer prior to writing json file
                }
                console.log('Getting ready to write JSON');
                const jsonString = JSON.stringify(viewArray);           // write out a new json file including new bbox info
                console.log('After stringify');
                fs.writeFileSync('imageMetadata_phase2.json', jsonString);
                console.log('Done. Files written. Preprocessing complete!')
            } else {
                socket.emit('PPserverRequestsVisibility', {index: message.index + 1, name: viewArray[message.index + 1].nm});
                console.log(`sending PPserverRequestsVisibility: ${message.index + 1}`);
            }
        });
    }

    /* - Only for debugging purposes
    socket.on('clientRequestsVisCount', function(message) { // message is the visArray
        console.log(`Got a clientRequestsVisCount`);
        //console.log(`visbuff constructor is ${message.constructor}`)
        //console.log(`visbuff length is ${message.byteLength}`);
        if (message.byteLength == BYTESPERROW) 
            console.log(`There are ${c_count_vis(message)} matches`)
    });
    */

    socket.on('clientRequestsVis', function(message) { //message {imgSel: imgSelArray, visAr: visArray, mustMatch: int}
        console.log(`clientRequestsVis: Client requesting visibility matches.`);
        try {
            // checks to make sure client cannot cause check_vis to exceed buffers
            if (!Buffer.isBuffer(message.imgSel) || message.imgSel.length != Math.ceil(nRows/8)) {
                console.log(`message.imgSel must be a Buffer and at least ${Math.ceil(nRows/8)} long.`);
                return;
            }
            if (!Buffer.isBuffer(message.visAr) || message.visAr.length != BYTESPERROW) {
                console.log(`message.visArray must be a Buffer and ${BYTESPERROW} long.`);
                return;
            }
            if (!Number.isInteger(message.mustMatch)) {
                console.log('message.mustMatch must be an integer.');
                return;
            }
            c_check_vis(message.mustMatch, message.imgSel, message.visAr);
            socket.emit('serverProvidesVis', message.imgSel);
        } catch (error) {  // Additional protection against malformed messages. Perhaps unneeded given earlier checks?
            console.error(`An error occurred in clientRequestsVis handler: `, error.message);
        }
    });

    socket.on('clientShutdown', () => {
        console.log(`Client shutting down: ${socket.handshake.query.clientID}`);
        if (localServer) {
            clientSet.delete(socket.handshake.query.clientID);
            if (clientSet.size === 0) {
                console.log('No more clients. Shutting down local server.');
                exit();
            }
        }
    });

    // Currently we do not need to handle disconnections explicitly
    /* socket.on('disconnect', function() {   // nothing yet
        console.log(`${socket.id} has disconnected`);
    });
    */
});
