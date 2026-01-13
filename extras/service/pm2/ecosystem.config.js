// This is the PM2 ecosystem configuration file for Comet.Photos server.
//   It is only needed if you are using PM2 to manage a persistent server.
//   It is not used when running cometserver locally as an app.
//
module.exports = {
  apps: [
    {
      // Public HTTPS setup - works without Cloudflare Dns
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
    },
    {
      // Public HTTPS setup - assumes a Cloudflare proxy
      name: 'cometserver3-proxied',
      script: 'cometserver.js',
      args: [
        '--protocol', 'https',
        '--port', '443',
        '--keyfile', '/etc/ssl/cloudflare/origin.key',
        '--certfile', '/etc/ssl/cloudflare/origin.pem'
      ],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000
    },
    {
      // Cloudflare-tunneled setup (HTTP-only behind the tunnel)
      name: 'cometserver3-tunneled',
      script: 'cometserver.js',
      args: [
        '--port', '8082'
      ],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000
    }
  ]
};