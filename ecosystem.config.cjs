module.exports = {
  apps: [
    {
      name: 'atenddiz-openwa',
      script: 'openwa_server.mjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 2785,
        WHATSAPP_PROVIDER: 'openwa',
      },
    },
    {
      name: 'atenddiz-web',
      script: 'node_modules/vite/bin/vite.js',
      args: 'dev --port 3000',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        WHATSAPP_PROVIDER: 'openwa',
        OPENWA_API_URL: 'http://localhost:2785',
      },
    },
  ],
};
