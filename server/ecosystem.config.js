module.exports = {
  apps : [{
    name: 'cometserver',
    script: 'cometserver.js',
    env: {
    "REDIRECT": "TRUE",
	  "PORT": "443",
    "HTTP_PORT": "80",
    "CERTFILE": "/etc/letsencrypt/live/comet.photos/fullchain.pem",
    "KEYFILE": "/etc/letsencrypt/live/comet.photos/privkey.pem",
    "VISFILE": "../data/visTableV3.5.bin"
    },
  },
  ],

  deploy : {
    production : {
      user : 'SSH_USERNAME',
      host : 'SSH_HOSTMACHINE',
      ref  : 'origin/master',
      repo : 'GIT_REPOSITORY',
      path : 'DESTINATION_PATH',
      'pre-deploy-local': '',
      'post-deploy' : 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
