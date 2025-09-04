const fs = require('fs');
const { exit } = require('process');

function commonHandlers(io, localServer, PREPROCESSING, DATASETSFILE) {
    const clientSet = new Set();
    let fileText, datasets;

    // Step 1 - Load the DATASETSFILE
    try {
        fileText = fs.readFileSync(DATASETSFILE, 'utf-8');
        datasets = JSON.parse(fileText);
    }
    catch(err) {
        console.error(err.message);
    }

    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {
        const clientIp = socket.handshake.address;      // print out the IP 
        const ipv4 = clientIp.startsWith('::ffff:') ? clientIp.split(':').pop() : clientIp;
        console.log(`Client connection from: ${socket.handshake.query.clientID} at ${ipv4}`);
        if (localServer)
            clientSet.add(socket.handshake.query.clientID);


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

        // message is not used. ack is {params, datasets}
        socket.on('clientRequestsDatasets', function(message, ack) { 
            ack({preprocessMode: PREPROCESSING, datasets: datasets});
        });

    });
    return datasets;
}

module.exports = { commonHandlers };