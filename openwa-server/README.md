# Servidor OpenWA (WhatsApp)

Servidor Node que mantém a sessão do WhatsApp Web (Chrome headless via `@open-wa/wa-automate`)
e expõe a API usada pelo app (`OPENWA_API_URL` / `OPENWA_API_KEY`). Roda separado do app:
o app fica na Vercel e este servidor numa VM com Chrome (hoje: Oracle, `~/atenddiz-openwa`).

## Instalação (Ubuntu)

Pré-requisitos: Node 18+, Google Chrome, pm2, nginx + certbot (HTTPS).

```bash
# copie esta pasta para o servidor (ex.: ~/atenddiz-openwa) e, dentro dela:
PUPPETEER_SKIP_DOWNLOAD=true npm install      # usa o Chrome instalado; o postinstall aplica openwa-patches/
node node_modules/ffmpeg-static/install.js    # se o npm bloquear o script de instalação do ffmpeg
openssl rand -hex 32 > .api_key && chmod 600 .api_key
pm2 start ecosystem.config.cjs && pm2 save
pm2 startup systemd                           # rode o comando sudo que ele imprimir
```

O nginx faz proxy HTTPS para `127.0.0.1:2785` (`client_max_body_size 25m`, `proxy_read_timeout 180s`).

## Atualizar

Envie o `openwa_server.mjs` novo e rode `pm2 restart atenddiz-openwa`. As sessões registradas em
`openwa_sessions.json` são reabertas sozinhas (sem novo QR enquanto o login do WhatsApp for válido).

## Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `OPENWA_API_KEY` | vazio | Exigida no header `X-API-Key`. Vazia = só aceita chamadas de 127.0.0.1 |
| `PORT` / `HOST` | `2785` / todas | Porta e interface |
| `OPENWA_ENABLE_EVAL` | `false` | Libera `/api/sessions/:id/eval` (executa código; só para depuração local) |
| `OPENWA_SESSIONS_FILE` | `openwa_sessions.json` | Onde ficam as sessões registradas |

## openwa-patches/

Correções do `@open-wa/wa-automate@4.76.0` (detecção do QR e esperas com o WhatsApp Web atual).
A versão publicada no npm não gera QR sem elas; o `postinstall` copia os arquivos para `node_modules`.
