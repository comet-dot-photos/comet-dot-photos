// runtimeHandlers.js -
//   Socket.io event handlers for runtime mode.

const fs = require('fs');
const path = require('path');
const { exit } = require('process');
const { load_c}  = require('./load_c.js');

function runtimeHandlers(io, datasets) {

    // Step 1 - load the C Functions for fast visibility checks, and
    //   one by one, load the VISFILES in the datasets
    const { c_load_vbuff2, c_check_vis2 } = load_c();
    
    let tableCount = 0;
    let nRows = [], rowSize = [];
    datasets.forEach(ms => {
        ms.instruments.forEach((ds, i) => {
            const visFile = path.join(__dirname, '..', 'data', ms.missionFolder, ds.dataFolder, ds.visTable);
            const stats = fs.statSync(visFile);
            rowSize.push(Math.ceil(ms.nVerts/64)*8);
            nRows.push(stats.size / rowSize[tableCount]);  // cache it for buffer size safety check
            // each row is rowSize bytes, file size is nRows*rowSize;
            // console.log(`calling c_load_vbuff2 for ${visFile}, i is ${i}, nRows is ${nRows[tableCount]}, rowSize is ${rowSize[tableCount]}`);
            if (c_load_vbuff2(tableCount, visFile, nRows[tableCount], rowSize[tableCount]) == 0) {
                console.log(`Loaded ${visFile}. nRows = ${nRows[tableCount]}, bytesPerRow = ${rowSize[tableCount]}.`);
                ds.tableIndex = tableCount++;
            } else {
                console.log(`Loading of ${visFile} failed.`);   // no message back to client though...
                exit();
            }
        });
    });
        
    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {

        // clientRequestsVis - requests a visibility check from the server for a 
        //   particular candidate set of images (imgSel), the painted region (visAr),
        //   and a number of vertices that must match (mustMatch)
        //
        //   Argument message is {imgSels: [[tableIndex, imgSel]...], visAr: visArray, mustMatch: int}
        //   Replies with ack(imgSels), which are altered to indicate the matches.
        //
        socket.on('clientRequestsVis', function(message, ack) { 
            try {
                if (!Number.isInteger(message.mustMatch)) {
                    throw new Error ('message.mustMatch must be an integer.');
                }
                for (const [tableIndex, imgSelBuff] of message.imgSels) {
                    if (tableIndex < 0 || tableIndex >= tableCount)
                        throw new Error(`Bad tableIndex: ${tableIndex}`);

                    // checks to make sure client cannot cause check_vis to exceed buffers
                    if (!Buffer.isBuffer(imgSelBuff) || imgSelBuff.length != Math.ceil(nRows[tableIndex]/8)) {
                        throw new Error (`imgSelBuff must be a Buffer and ${Math.ceil(nRows[tableIndex]/8)} long.`);
                    }
                    if (!Buffer.isBuffer(message.visAr) || message.visAr.length != rowSize[tableIndex]) {
                        throw new Error (`message.visArray must be a Buffer and ${rowSize[tableIndex]} long.`);
                    }

                    c_check_vis2(tableIndex, message.mustMatch, imgSelBuff, message.visAr);
                }
                // All done, reply with altered imgSels
                ack(message.imgSels);
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