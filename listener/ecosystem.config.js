// pm2 process file for the ADMS listener (spec §5 keep-alive).
//   pm2 start ecosystem.config.js
//   pm2 startup && pm2 save     # survive reboots
module.exports = {
  apps: [
    {
      name: 'attendance-listener',
      script: 'src/server.js',
      // Load .env if present (Node >=20.6 native flag; no dotenv dependency).
      node_args: '--env-file-if-exists=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 50,
      watch: false,
      env: { NODE_ENV: 'production' },
    },
  ],
};
