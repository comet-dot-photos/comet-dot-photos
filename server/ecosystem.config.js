module.exports = {
  apps: [
    {
      name: 'cometserver3',
      script: 'cometserver.js',
      args: [
        '--redirect',
        '--port', '443',
        '--http_port', '80',
        '--certfile', '/etc/letsencrypt/live/comet.photos/fullchain.pem',
        '--keyfile', '/etc/letsencrypt/live/comet.photos/privkey.pem'
      ],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000
    }
  ]
};

