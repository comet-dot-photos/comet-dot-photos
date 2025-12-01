// preprocessingHandlers.js -
//   Socket.io event handlers for preprocessing mode.

const fs = require('fs');
const path = require('path');
const { exit } = require('process');

function preprocessingHandlers(io, datasets) {
    let fileText, viewArray;

    // Step 1 - Load the phase1 metaData file
    //   We will be preprocessing just the first mission and first instrument in datasets.
    const mission = datasets[0];
    const inst = mission.instruments[0];
    const oldMetaFile = path.join(__dirname, '..', 'data', mission.missionFolder, inst.instrumentFolder, inst.metaData);
    try {
        fileText = fs.readFileSync(oldMetaFile, 'utf-8');
    }
    catch(err) {
        console.error(err.message);
    }
    viewArray = JSON.parse(fileText);
    console.log(`ViewArray.length is ${viewArray.length}`);


    // Step 2 - When a socket connection occurs, register handlers for events
    io.on('connection', function(socket) {

        socket.on('PPclientReadyToStart', (message) => { //message {count:n}, where count is number of images in client's viewArray
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
                const visFile = path.join(__dirname, '..', 'data', mission.missionFolder, inst.instrumentFolder, inst.visTable + '.new');
                fs.writeFileSync(visFile, '');                       // create a new empty file
                for (let i = 0; i < viewArray.length; i++) {            // append the buffer to the file
                    console.log(`writing line ${i}...`)
                    fs.appendFileSync(visFile, viewArray[i].vb);
                    delete viewArray[i].vb;                             // delete buffer prior to writing json file
                }
                console.log('Getting ready to write JSON');
                const jsonString = JSON.stringify(viewArray);           // write out a new json file including new bbox info
                console.log('After stringify');
                const newMetaFile = path.join(__dirname, '..', 'data', mission.missionFolder, inst.instrumentFolder, inst.metaData + '.new');
                fs.writeFileSync(newMetaFile, jsonString);
                console.log('Done. Files written. Preprocessing complete!')
            } else {
                socket.emit('PPserverRequestsVisibility', {index: message.index + 1, name: viewArray[message.index + 1].nm});
                console.log(`sending PPserverRequestsVisibility: ${message.index + 1}`);
            }
        });

    });
}

module.exports = { preprocessingHandlers };
