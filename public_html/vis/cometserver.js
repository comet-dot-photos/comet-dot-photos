const express = require('express');
const socketIO = require('socket.io');
const httpolyglot = require('httpolyglot');
//const https = require('https');
const fs = require('fs');
var ffi = require('ffi-napi');
const compression = require('compression');

var app = express();

const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/comet.photos/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/comet.photos/fullchain.pem')
 };


var server = httpolyglot.createServer(options, app);

var io = socketIO(server);

const port = process.env.PORT || 8080;

// Redirect HTTP to HTTPS
app.use((req, res, next) => {
    if (req.secure) {
      next();
    } else {
      console.log(`Not https: redirecting: ${req.url}`);
      res.redirect(`https://${req.headers.host}${req.url}`);
    }
  });

// compress only .obj files and JSON responses
app.use(function(req, res, next) {
    if (req.url.endsWith('.obj') || req.url.endsWith('.json') || req.url.endsWith('.js') || req.url.endsWith('.png') || req.url.endsWith('.html')) {
      //console.log(`Trying to compress: ${req.url}`);
      compression()(req, res, next);
    } else {
      next();
    }
  })


app.use(express.static('../bvh'));
app.use(express.static('../dan/V2'))

// app.get('/foo.html', async(req, res) => {
//     res.sendFile('newtest.html');
//     console.log("Got a request for the html!")
// });


server.listen(port, function() {
    console.log(`The app is running on port ${port}`);
});

const internal = require('stream');
const { exit } = require('process');

const VISFILE = 'cometVis.bin';
const BYTESPERROW = 12504;
let fileText;

let viewArray, libvis;
let nRows;

if (process.env.PREPROCESSING) {
    try {
        fileText = fs.readFileSync('../viewdata.json', 'utf-8');
    }
    catch(err) {
        console.error(err.message);
    }
    viewArray = JSON.parse(fileText);
    console.log(`ViewArray.length is ${viewArray.length}`)
} else {
    libvis = ffi.Library('./checkvis', {
        'load_vbuff' : ['int', ['int', 'int']],
        'check_vis': ['void', ['int', 'pointer', 'pointer']],
        'check_nRows' : ['int', [] ],
        'count_filterarray' : ['int', ['pointer']]
    });
    const stats = fs.statSync(VISFILE);
    nRows = stats.size / BYTESPERROW;             // With this shape model, each row is 12504 bytes, file size is nrows*bytesPerRow;
    if (libvis.load_vbuff(nRows, BYTESPERROW) == 0)
        console.log(`Successfully loaded ${VISFILE}. nRows = ${nRows}, BYTESPERROW = ${BYTESPERROW}.`);
    else console.log(`Loading of ${VISFILE} failed.`);   // no message back to client though...
}

io.on('connection', function(socket) { 
    console.log(`Got a connection from: ${socket.id}`);

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
//        console.log(`visbuff constructor is ${message.visBuffer.constructor}`)
//        console.log(`visbuff length is ${message.visBuffer.byteLength}`);
        if (message.index == viewArray.length-1) {
            console.log("DONE!!!!!!")
            // Remove all elements that had no vertices visible (d1 > d2)
            viewArray = viewArray.filter((val) => val.d1 <= val.d2)
            // FINISH UP CODE HERE!! WRITE TO FILE!!!
            fs.writeFileSync(VISFILE, '');                       // create a new empty file
            for (let i = 0; i < viewArray.length; i++) {            // append the buffer to the file
                console.log(`writing line ${i}...`)
                fs.appendFileSync(VISFILE, viewArray[i].vb);
                delete viewArray[i].vb;                             // delete buffer prior to writing json file
            }
            console.log('Getting ready to write JSON');
            const jsonString = JSON.stringify(viewArray);           // write out a new json file including new bbox info
            console.log('After stringify');
            fs.writeFileSync('new_viewArray.json', jsonString);
        } else {
            socket.emit('PPserverRequestsVisibility', {index: message.index + 1, name: viewArray[message.index + 1].nm});
            console.log(`sending PPserverRequestsVisibility: ${message.index + 1}`);
        }
    });


    socket.on('clientRequestsTest', function(message) { //message {test: n}, where n is the test
        console.log(`Got a clientRequestsTest for test number ${message.test}`);
        if (message.test === 1) {
            var libm = ffi.Library('libm', {
                        'ceil': [ 'double', [ 'double' ] ]
            });
            console.log(`The ceil of 1.5 is ${libm.ceil(1.5)}`);
        } else if (message.test === 2) {
        }
    });

    socket.on('clientRequestsVisCount', function(message) { // message is the visArray
        console.log(`Got a clientRequestsVisCount`);
        //console.log(`visbuff constructor is ${message.constructor}`)
        //console.log(`visbuff length is ${message.byteLength}`);
        if (message.byteLength == BYTESPERROW) 
            console.log(`There are ${libvis.count_vis(message)} matches`)
    });

    socket.on('clientRequestsVis', function(message) { //message {imgSel: imgSelArray, visAr: visArray}
        console.log(`Got a clientRequestsVis`);

        // checks to make sure client cannot cause check_vis to exceed buffers
        if (message.imgSel.length < (nRows/8)) {
            console.log(`message.imgSel must be at least${nRows/8} long, but is ${message.imgSel.length} long.`);
            return;
        }
        if (message.visAr.length != BYTESPERROW) {
            console.log(`message.visArray must be ${BYTESPERROW} long, but is ${message.visAr.length} long.`);
            return;
        }
        libvis.check_vis(message.mustMatch, message.imgSel, message.visAr);
        socket.emit('serverProvidesVis', message.imgSel);
    });

    function getLegalFilename(str) {
        return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    socket.on('clientRequestsSessionSave', function(message) { // message is json object to save, with sessionName as file name
        console.log("Got a clientRequestsSessionSave event");
        const filename = './sessions/' + getLegalFilename(message.sessionName);
        const jsonString = JSON.stringify(message);           // write out a new json file including new bbox info
        console.log('After stringify');
        fs.writeFileSync(filename, jsonString);
    });

    socket.on('clientRequestsSessionLoad', function(sessionName) { // message is just a string with the sessionName
        console.log("Got a clientRequestsSessionLoad event")
        const filename = './sessions/' + getLegalFilename(sessionName);
        try {
            fileText = fs.readFileSync(filename, 'utf-8');
            session = JSON.parse(fileText);
        }
        catch(err) {
            console.error(err.message);
            session = null;
        }

        socket.emit('serverProvidesSessionLoad', session);
    });

    socket.on('disconnect', function() {   // nothing yet
    });
});
