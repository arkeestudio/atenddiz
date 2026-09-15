// pm2 do servidor OpenWA (produção: Oracle, ~/atenddiz-openwa).
// A chave da API fica em .api_key (fora do git): `openssl rand -hex 32 > .api_key && chmod 600 .api_key`.
const fs = require("fs");
const path = require("path");

const keyFile = path.join(__dirname, ".api_key");

module.exports = {
  apps: [
    {
      name: "atenddiz-openwa",
      cwd: __dirname,
      script: "openwa_server.mjs",
      node_args: "--max-old-space-size=256",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      env: {
        NODE_ENV: "production",
        PORT: "2785",
        HOST: "127.0.0.1",
        OPENWA_API_KEY: fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "",
      },
    },
  ],
};
