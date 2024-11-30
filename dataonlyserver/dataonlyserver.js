const express = require('express');
const fs = require('fs');
const cors = require('cors');
const httpolyglot = require('httpolyglot');
const compression = require('compression');

var app = express();

let key = null, cert = null;
if (process.env.KEYFILE) key = fs.readFileSync(process.env.KEYFILE);
if (process.env.CERTFILE) cert = fs.readFileSync(process.env.CERTFILE);
const options = (key && cert) ? {key: key, cert: cert} : {};
var server = httpolyglot.createServer(options, app);

const port = process.env.PORT || 8080;
const REDIRECT = process.env.REDIRECT;

// Use the CORS middleware to allow requests from any origin
app.use(cors({preflightContinue: true}));

// Middleware to add Access-Control-Allow-Private-Network only for preflight requests
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Private-Network', 'true');
        return res.sendStatus(200); // Respond with 200 OK and stop further processing
    }
    next();
});

// Redirect HTTP to HTTPS if REDIRECT is set
app.use((req, res, next) => {
    if (req.secure || !REDIRECT) {
      next();
    } else {
      console.log(`Not https: redirecting: ${req.url}   IP= ${req.ip || req.socket.remoteAddress}`);
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

app.use(express.static('../data'));

server.listen(port, function() {
    console.log(`The app is running on port ${port}`);
    if (process.env.LAUNCHBROWSER) 
        import('open').then(open => {
            open.default(`http://localhost:${port}`);
          });
});
