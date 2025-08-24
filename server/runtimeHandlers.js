const fs = require('fs');
const { exit } = require('process');
const { load_c}  = require('./load_c.js');

function runtimeHandlers(io, localServer, VISFILE, BYTESPERROW) {
    let nRows;
    const clientSet = new Set();

    // Step 1 - if not PREPROCESSING, load the C Functions
    // for visibility checks, and the VISFILE
    const { c_load_vbuff, c_check_vis } = load_c();
    const stats = fs.statSync(VISFILE);
    nRows = stats.size / BYTESPERROW;    // each row is BYTESPERROW bytes, file size is nrows*BYTESPERROW;
    if (c_load_vbuff(VISFILE, nRows, BYTESPERROW) == 0)
        console.log(`Successfully loaded ${VISFILE}. nRows = ${nRows}, BYTESPERROW = ${BYTESPERROW}.`);
    else {
        console.log(`Loading of ${VISFILE} failed.`);   // no message back to client though...
        exit();
    }

    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {
        const clientIp = socket.handshake.address;      // print out the IP 
        const ipv4 = clientIp.startsWith('::ffff:') ? clientIp.split(':').pop() : clientIp;
        console.log(`Client connection from: ${socket.handshake.query.clientID} at ${ipv4}`);
        if (localServer)
            clientSet.add(socket.handshake.query.clientID);


        // PPclientReadyToStart - just tell the client that server is not in preprocessing mode
        socket.on('PPclientReadyToStart', (message) => { 
                socket.emit('PPserverNotInPreprocessingMode');
        });

        // clientRequestsVis - requests a visibility check from the server for a 
        //   particular candidate set of images (imgSel), the painted region (visAr),
        //   and a number of vertices that must match (mustMatch)
        //
        //   Argument message is {imgSel: imgSelArray, visAr: visArray, mustMatch: int}
        //
        socket.on('clientRequestsVis', function(message, ack) { 
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
                //socket.emit('serverProvidesVis', message.imgSel);
                ack(message.imgSel);
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


        socket.on('clientRequestsLogSave', function(message) { // message is json object to save, with sessionName as file name
            console.log("Got a clientRequestsLogSave event");
            const jsonString = JSON.stringify(message);           // write out a new json file including new bbox info
            fs.writeFileSync('logfile.txt', jsonString);
        });

        socket.on('clientRequestsLogLoad', function(message, ack) { 
            console.log("Got a clientRequestsLogLoad event")
            try {
                fileText = fs.readFileSync('logfile.txt', 'utf-8');
                log = JSON.parse(fileText);
            }
            catch(err) {
                console.error(err.message);
                log = null;
            }
            ack(log);
        });
    });
}

module.exports = { runtimeHandlers };