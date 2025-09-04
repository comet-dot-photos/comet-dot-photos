const fs = require('fs');
const { exit } = require('process');
const { load_c}  = require('./load_c.js');

function runtimeHandlers(io, datasets) {

    // Step 1 - load the C Functions for fast visibility checks, and
    //   one by one, load the VISFILES in the datasets
    const { c_load_vbuff2, c_check_vis2 } = load_c();
    
    datasets.forEach((ds, i) => {
        const visFile = '../data/' + ds.dataFolder + ds.visTable;
        const stats = fs.statSync(visFile);
        ds.nRows = stats.size / ds.rowSize;  // cache it for buffer size safety check
        // each row is ds.rowSize bytes, file size is ds.nRows*ds.rowSize;
        if (c_load_vbuff2(i, visFile, ds.nRows, ds.rowSize) == 0)
            console.log(`Successfully loaded ${visFile}. nRows = ${ds.nRows}, bytesPerRow = ${ds.rowSize}.`);
        else {
            console.log(`Loading of ${visFile} failed.`);   // no message back to client though...
            exit();
        }
    });
        
    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {

        // clientRequestsVis - requests a visibility check from the server for a 
        //   particular candidate set of images (imgSel), the painted region (visAr),
        //   and a number of vertices that must match (mustMatch)
        //
        //   Argument message is {imgSel: imgSelArray, visAr: visArray, mustMatch: int}
        //   Replies with ack(imgSelArray), which altered to indicate the matches.
        //
        socket.on('clientRequestsVis', function(message, ack) { 
            try {
                const tableIndex = datasets.findIndex(x => x.shortName == message.dsName);
                if (tableIndex < 0)
                    throw new Error(`Bad tableInex: ${tableIndex}`);

                // checks to make sure client cannot cause check_vis to exceed buffers
                const {nRows, rowSize} = datasets[tableIndex];
                if (!Buffer.isBuffer(message.imgSel) || message.imgSel.length != Math.ceil(nRows/8)) {
                    throw new Error (`message.imgSel must be a Buffer and ${Math.ceil(nRows/8)} long.`);
                }
                if (!Buffer.isBuffer(message.visAr) || message.visAr.length != rowSize) {
                    throw new Error (`message.visArray must be a Buffer and ${rowSize} long.`);
                }
                if (!Number.isInteger(message.mustMatch)) {
                    throw new Error ('message.mustMatch must be an integer.');
                }
                c_check_vis2(tableIndex, message.mustMatch, message.imgSel, message.visAr);
                ack(message.imgSel);
            } catch (error) {  // Additional protection against malformed messages. Perhaps unneeded given earlier checks?
                console.error(`clientRequestsVis error: `, error.message);
                ack(null);
            }
        });

        function getLegalFilename(str) {
            return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        }

        // 'clientRequestsLogSave' - Sent by the client to have the server save a log.
        //      message.log is the json log to save, message.logName is the name.
        //      replies with ack(bool), where bool is success.
        //
        socket.on('clientRequestsLogSave', function(message, ack) { 
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

        // 'clientRequestsLogLoad' - Sent by the client to retrieve a log.
        //      message.logName specifies which log. 
        //      Replies with ack(log), where log is null if failed.
        //
        socket.on('clientRequestsLogLoad', function(message, ack) { 
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