module.exports = {
  apps : [{
    name: 'cometserver',
    script: 'cometserver.js',
    env: {
	  "PORT": "443"
    },
    watch: ['app.js', 'checkvis.so'],
    ignore_watch : ["sessions"],
  },
  {
    name: 'redirect',
    script: 'redirect.js',
    watch: ['redirect.js'],
    ignore_watch : ["sessions"],
  }
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
