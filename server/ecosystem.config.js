module.exports = {
  apps : [{
    name: 'cometserver3',
    script: 'cometserver.js',
    env: {
    "PORT": "8082", 
    "CERTFILE": "/etc/letsencrypt/live/comet.photos/fullchain.pem",
    "KEYFILE": "/etc/letsencrypt/live/comet.photos/privkey.pem",
    "VISFILE": "../data/visTableNAC.bin"
    },
    env_production: {
    "REDIRECT": "TRUE",
	  "PORT": "443",
    "HTTP_PORT": "80",
    "CERTFILE": "/etc/letsencrypt/live/comet.photos/fullchain.pem",
    "KEYFILE": "/etc/letsencrypt/live/comet.photos/privkey.pem",
    "VISFILE": "../data/visTableNAC.bin"
    }
  },
  ]
};
