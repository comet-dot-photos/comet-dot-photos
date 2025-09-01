const fs = require('fs');
const { exit } = require('process');
const { load_c}  = require('./load_c.js');

function runtimeHandlers(io, datasets, VISFILE, BYTESPERROW) {

    // Step 1 - load the C Functions for fast visibility checks, and
    //   one by one, load the VISFILES in the datasets
    const { c_load_vbuff2, c_check_vis2 } = load_c();
    
    datasets.forEach((ds, i) => {
        const visFile = '../data/' + ds.dataFolder + ds.visTable;
        const stats = fs.statSync(visFile);
        ds.nRows = stats.size / ds.rowSize;  // cache it for buffer size safety check
        // each row is BYTESPERROW bytes, file size is nrows*BYTESPERROW;
        if (c_load_vbuff2(i, visFile, ds.nRows, ds.rowSize) == 0)
            console.log(`Successfully loaded ${visFile}. nRows = ${ds.nRows}, bytesPerRow = ${ds.rowSize}.`);
        else {
            console.log(`Loading of ${visFile} failed.`);   // no message back to client though...
            exit();
        }
    });
        
    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {

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
                const tableIndex = datasets.findIndex(x => x.shortName == message.dsName);
                if (tableIndex < 0) throw new Error(`Bad index in clietRequestsVis: ${tableIndex}`);

                // checks to make sure client cannot cause check_vis to exceed buffers
                const {nRows, rowSize} = datasets[tableIndex];
                if (!Buffer.isBuffer(message.imgSel) || message.imgSel.length != Math.ceil(nRows/8)) {
                    console.log(`message.imgSel must be a Buffer and ${Math.ceil(nRows/8)} long.`);
                    return;
                }
                if (!Buffer.isBuffer(message.visAr) || message.visAr.length != rowSize) {
                    console.log(`message.visArray must be a Buffer and ${rowSize} long.`);
                    return;
                }
                if (!Number.isInteger(message.mustMatch)) {
                    console.log('message.mustMatch must be an integer.');
                    return;
                }
                c_check_vis2(tableIndex, message.mustMatch, message.imgSel, message.visAr);
                ack(message.imgSel);
            } catch (error) {  // Additional protection against malformed messages. Perhaps unneeded given earlier checks?
                console.error(`An error occurred in clientRequestsVis handler: `, error.message);
            }
        });

        function getLegalFilename(str) {
            return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        }

        socket.on('clientRequestsLogSave', function(message, ack) { // message is json object to save (allow spec of file name?)
            console.log("Got a clientRequestsLogSave event");
            try {
                const jsonString = JSON.stringify(message.log);           // write out a new json file
                const filename = './logs/' + getLegalFilename(message.logName);
                fs.writeFileSync(filename, jsonString);
                ack(true);
            }
            catch(err) {
                console.log(`Unable to save log.`);
                console.error(err.message);
                ack(false);
            }

        });

        socket.on('clientRequestsLogLoad', function(message, ack) { 
            console.log("Got a clientRequestsLogLoad event");
            let log;
            try {
                const filename = './logs/' + getLegalFilename(message.logName);
                fileText = fs.readFileSync(filename, 'utf-8');
                log = JSON.parse(fileText);
            }
            catch(err) {
                console.log(`Unable to retrieve log.`)
                console.error(err.message);
                log = null;
            }
            ack(log);
        });
    });
}

module.exports = { runtimeHandlers };