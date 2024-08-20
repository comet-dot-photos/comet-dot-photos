const express = require('express');
const httpolyglot = require('httpolyglot');
const fs = require('fs');

var app = express();

const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/comet.photos/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/comet.photos/fullchain.pem')
 };


var server1 = httpolyglot.createServer(options, app); // , (req, res) => {});
var server2 = httpolyglot.createServer(options, app); // , (req, res) => {});

// Redirect to HTTPS on port 8383
app.use((req, res, next) => {
    console.log(`Got this url: ${req.url}`);
    var hostname = req.headers.host.split(':')[0];
    console.log(`req.headers.host is: ${req.headers.host}, and hostname = ${hostname}`);
    console.log(`Redirecting...`);
    res.redirect(`https://${hostname}${req.url}`);
  });

server1.listen(8383, function() {
    console.log(`The app is redirecting port 8383`);
});
server2.listen(80, function() {
    console.log(`The app is redirecting port 80`);
});



