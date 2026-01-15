// commonHandlers.js -
//   Common socket.io event handlers for both preprocessing and runtime modes.

const fs = require('fs');
const { exit } = require('process');

function commonHandlers(io, args) {
    const clientSet = new Set();
    let fileText, datasets;

    // Step 1 - Fetch the datasets
    const fetchDatasets = require('./fetchDatasets.js');
    datasets = fetchDatasets(args);
    if (datasets.length === 0) {
        console.error("No datasets found. Please check your data directory.");
        exit(1);
    }

    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {
        let mesg = `Client connection from: ${socket.handshake.query.clientID}`;
        if (args.open)
            clientSet.add(socket.handshake.query.clientID);
        else {
            const headers = socket.handshake.headers;
            const cfIp = headers['cf-connecting-ip'];  // cloudflare tunnel
            const forwarded = headers['x-forwarded-for'];  // regular proxy
            const forwardedIp = forwarded ? forwarded.split(',')[0].trim() : null;
            const directIp = socket.handshake.address;
            const realIp = cfIp || forwardedIp || directIp;
            const clientIp = realIp.startsWith('::ffff:') ? realIp.split(':').pop() : realIp;
            const userAgent = headers['user-agent'];
            mesg += ` at ${clientIp} [UA: ${userAgent}]`;
        }
        console.log(mesg);


        socket.on('clientShutdown', () => {
            console.log(`Client shutting down: ${socket.handshake.query.clientID}`);
            if (args.open) {
                clientSet.delete(socket.handshake.query.clientID);
                if (clientSet.size === 0) {
                    console.log('No more clients. Shutting down local server.');
                    exit();
                }
            }
        });

        // message is not used. ack is {params, datasets}
        socket.on('clientRequestsDatasets', function(message, ack) { 
            ack({preprocessMode: args.preprocess, datasets: datasets});
        });

    });
    return datasets;
}

module.exports = { commonHandlers };