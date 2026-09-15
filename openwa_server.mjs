import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Windows 11 não tem mais wmic.exe; o shim em ./bin cobre as chamadas da biblioteca.
if (process.platform === 'win32') {
  process.env.PATH = `${path.join(SCRIPT_DIR, 'bin')};${process.env.PATH}`;
}

import wa from '@open-wa/wa-automate';

const PORT = Number(process.env.PORT) || 2785;
const HOST = process.env.HOST || undefined; // ex: 127.0.0.1 atrás de um proxy (nginx)
const API_KEY = (process.env.OPENWA_API_KEY || '').trim();
const ENABLE_EVAL = process.env.OPENWA_ENABLE_EVAL === 'true';
const SESSIONS_FILE = path.resolve(process.cwd(), process.env.OPENWA_SESSIONS_FILE || 'openwa_sessions.json');
const sessions = new Map();

// --- Sessões registradas: sobrevivem a reinícios (o login do WhatsApp fica nos .data.json) ---
function loadRegisteredSessions() {
  try {
    const list = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === 'string') : [];
  } catch {
    return [];
  }
}

function saveRegisteredSessions() {
  const list = [...sessions.values()].map((s) => ({ name: s.id, webhookUrl: s.webhookUrl || null }));
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('[OpenWA Server] Falha ao salvar sessões registradas:', err.message);
  }
}

const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Encerra os processos do Chrome que usam o perfil da sessão (_IGNORE_<sessão>).
function killSessionBrowser(sessionId) {
  if (!SESSION_NAME_RE.test(sessionId)) return;
  const marker = `_IGNORE_${sessionId}`;
  const proc =
    process.platform === 'win32'
      ? spawn('powershell', ['-NoProfile', '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`])
      : spawn('pkill', ['-f', `${marker}( |$)`]);
  proc.on('error', (err) => console.warn(`[OpenWA Server] Falha ao encerrar Chrome de ${sessionId}:`, err.message));
}

function isAuthorized(req) {
  if (!API_KEY) {
    // Sem chave configurada, só aceita chamadas da própria máquina.
    const addr = req.socket.remoteAddress || '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }
  const supplied = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function setSessionQr(sessionId, qrData) {
  if (!sessionId || !qrData) return;
  console.log(`[OpenWA Server] setSessionQr for "${sessionId}", length: ${qrData?.length}`);
  // Só sessões criadas por getOrCreateSession: QR tardio de uma sessão apagada não a recria.
  const s = sessions.get(sessionId);
  if (!s) return;

  if (typeof qrData === 'string' && qrData.startsWith('data:image/')) {
    s.qrBase64 = qrData;
  } else if (typeof qrData === 'string') {
    s.qrCode = qrData;
    try {
      s.qrBase64 = await QRCode.toDataURL(qrData, { width: 320, margin: 2 });
    } catch (err) {
      console.error('[OpenWA Server] Error converting QR code to base64:', err);
      s.qrBase64 = qrData;
    }
  }
  s.status = 'CONNECTING';
}

// Global wildcard listeners for ALL wa.ev events
wa.ev.onAny((event, data, sessionId, namespace) => {
  console.log(`[OpenWA Server EVENT] event="${event}", sessionId="${sessionId}", namespace="${namespace}", dataType=${typeof data}`);
  if (event && (event.startsWith('qr.') || event.startsWith('qrData.'))) {
    const sId = sessionId || event.split('.')[1];
    setSessionQr(sId, data);
  }
});

wa.ev.on('qr.**', (data, sessionId) => {
  console.log(`[OpenWA Server qr.**] sessionId="${sessionId}", dataType=${typeof data}, length=${data?.length}`);
  setSessionQr(sessionId, data);
});

wa.ev.on('qrData.**', (data, sessionId) => {
  console.log(`[OpenWA Server qrData.**] sessionId="${sessionId}", dataType=${typeof data}, length=${data?.length}`);
  setSessionQr(sessionId, data);
});

async function getOrCreateSession(name, webhookUrl) {
  let s = sessions.get(name);
  if (s) {
    if (webhookUrl) s.webhookUrl = webhookUrl;
    return s;
  }

  s = {
    id: name,
    status: 'STARTING',
    qrBase64: null,
    qrCode: null,
    client: null,
    webhookUrl: webhookUrl || null,
  };
  sessions.set(name, s);
  saveRegisteredSessions();

  console.log(`[OpenWA Server] Starting session: ${name}`);

  wa.create({
    sessionId: name,
    multiDevice: true,
    authTimeout: 0,
    qrTimeout: 0,
    blockCrashLogs: true,
    disableSpins: true,
    useChrome: true,
    headless: true,
    cacheEnabled: false,
  }).then(async (client) => {
    if (sessions.get(name) !== s) {
      // Sessão apagada enquanto aguardava o login: descarta o navegador.
      try { await client.kill('session deleted'); } catch {}
      return;
    }
    console.log(`[OpenWA Server] Client connected for session: ${name}`);
    s.client = client;
    s.status = 'CONNECTED';
    s.qrBase64 = null;
    s.qrCode = null;

    try {
      const me = await client.getMe();
      s.me = me;
      s.phone = me?.id?.split('@')[0] || null;
      console.log(`[OpenWA Server] Session ${name} connected as ${s.phone}`);
    } catch (e) {
      console.warn('[OpenWA Server] Error fetching me info:', e);
    }

    client.onStateChanged((state) => {
      console.log(`[OpenWA Server] State changed for ${name}: ${state}`);
      if (state === 'CONNECTED' || state === 'NORMAL') {
        s.status = 'CONNECTED';
      } else if (state === 'PAIRING' || state === 'UNPAIRED') {
        s.status = 'CONNECTING';
      } else {
        s.status = 'DISCONNECTED';
      }
    });

    client.onAnyMessage(async (message) => {
      let from = message.from || '';
      if (from.endsWith('@g.us') || from.endsWith('@newsletter') || from.endsWith('@broadcast') || from.startsWith('0@')) {
        return;
      }

      // If message is from a @lid, resolve to real phone number
      const page = s.client?._page || s.client?.page;
      if (page && (from.endsWith('@lid') || message.chatId?.endsWith('@lid') || message.author?.endsWith('@lid'))) {
        try {
          const lidToResolve = from.endsWith('@lid') ? from : (message.chatId || message.author);
          const resolvedPn = await page.evaluate((lidStr) => {
            try {
              const widFactory = window.require("WAWebWidFactory");
              const lidUtils = window.require("WAWebLidMigrationUtils");
              const wid = widFactory.createWid(lidStr);
              const res = lidUtils.toPn(wid);
              return res ? (res._serialized || String(res)) : null;
            } catch (e) {
              return null;
            }
          }, lidToResolve);
          if (resolvedPn) {
            console.log(`[OpenWA Server] Resolved LID ${lidToResolve} -> ${resolvedPn}`);
            if (from.endsWith('@lid')) message.from = resolvedPn;
            if (message.chatId && message.chatId.endsWith('@lid')) message.chatId = resolvedPn;
            if (message.sender) message.sender.phoneNumber = resolvedPn.split('@')[0];
            from = message.from;
          }
        } catch (e) {}
      }

      console.log(`[OpenWA Server] Message received from ${message.from} (fromMe: ${message.fromMe}) for ${name}`);
      if (s.webhookUrl) {
        try {
          const payload = {
            event: 'message.created',
            instance: name,
            instanceName: name,
            sessionId: name,
            data: message,
          };
          console.log(`[OpenWA Server] Forwarding message from ${message.from} to webhook ${s.webhookUrl}`);
          const res = await fetch(s.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const text = await res.text();
          console.log(`[OpenWA Server] Webhook response (${res.status}): ${text}`);
        } catch (err) {
          console.error('[OpenWA Server] Webhook dispatch error:', err.message);
        }
      } else {
        console.warn(`[OpenWA Server] No webhookUrl set for session ${name}! Message not forwarded.`);
      }
    });

  }).catch((err) => {
    console.warn(`[OpenWA Server] wa.create warning for ${name}:`, err.message);
    if (!s.client && !s.qrBase64) {
      s.status = 'FAILED';
      s.error = err.message;
    }
  });

  return s;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  return { mimetype: match[1].split(';')[0].trim(), base64: match[3] };
}

let ffmpegBinary = null;
async function getFfmpegBinary() {
  if (ffmpegBinary) return ffmpegBinary;
  try {
    ffmpegBinary = (await import('ffmpeg-static')).default || 'ffmpeg';
  } catch {
    ffmpegBinary = 'ffmpeg';
  }
  return ffmpegBinary;
}

// Nota de voz do WhatsApp precisa ser OGG/Opus; o navegador grava em WebM.
async function toOggOpusDataUrl(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('Áudio inválido: esperado data URL em base64');
  if (parsed.mimetype === 'audio/ogg') return `data:audio/ogg;base64,${parsed.base64}`;

  const bin = await getFfmpegBinary();
  const output = await new Promise((resolve, reject) => {
    const proc = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => (stderr += c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg falhou (${code}): ${stderr.slice(0, 300)}`));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(Buffer.from(parsed.base64, 'base64'));
  });
  return `data:audio/ogg;base64,${output.toString('base64')}`;
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  console.log(`[OpenWA Server HTTP] ${method} ${pathname}`);

  // Health check público (sem dados sensíveis) para monitoramento/proxy.
  if (method === 'GET' && pathname === '/health') {
    return json({ ok: true, sessions: sessions.size, authRequired: !!API_KEY });
  }

  if (!isAuthorized(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    // POST /api/sessions
    if (method === 'POST' && pathname === '/api/sessions') {
      const body = await parseJsonBody(req);
      const name = body.name || 'default';
      if (!SESSION_NAME_RE.test(name)) return json({ error: 'Nome de sessão inválido' }, 400);
      const s = await getOrCreateSession(name, body.webhookUrl);
      return json({ id: s.id, status: s.status });
    }
    // GET /api/sessions/:sessionId/qr
    const qrMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/qr$/);
    if (method === 'GET' && qrMatch) {
      const sessionId = decodeURIComponent(qrMatch[1]);
      let s = sessions.get(sessionId);
      if (!s) return json({ qrBase64: null, code: null, pairingCode: null });

      if (!s.qrBase64 && s.client && s.client.page) {
        try {
          const qr = await s.client.page.evaluate(() => {
            const canvas = document.querySelector("canvas");
            if (canvas) {
              try {
                const d = canvas.toDataURL("image/png");
                if (d && d.length > 200) return d;
              } catch (e) {}
            }
            const ref = document.querySelector("[data-ref]")?.getAttribute("data-ref");
            return ref || null;
          });
          if (qr) {
            await setSessionQr(sessionId, qr);
          }
        } catch (e) {
          console.warn("[OpenWA Server] Direct canvas evaluation failed:", e.message);
        }
      }

      return json({
        qrBase64: s.qrBase64,
        code: s.qrCode,
        pairingCode: null,
      });
    }



    // GET /api/sessions/:sessionId
    const getSessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === 'GET' && getSessionMatch) {
      const sessionId = decodeURIComponent(getSessionMatch[1]);
      const s = sessions.get(sessionId);
      if (!s) return json({ status: 'DISCONNECTED' }, 404);
      return json({
        id: s.id,
        status: s.status,
        phone: s.phone,
        me: s.me,
      });
    }

    // POST /api/sessions/:sessionId/webhooks
    const webhookMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/webhooks$/);
    if (method === 'POST' && webhookMatch) {
      const sessionId = decodeURIComponent(webhookMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (s) {
        s.webhookUrl = body.url;
        saveRegisteredSessions();
        console.log(`[OpenWA Server] Set webhookUrl for ${sessionId}: ${s.webhookUrl}`);
      }
      return json({ ok: true });
    }

    // POST /api/sessions/:sessionId/sync-chats
    const syncMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/sync-chats$/);
    if (method === 'POST' && syncMatch) {
      const sessionId = decodeURIComponent(syncMatch[1]);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'Session not connected' }, 400);

      try {
        console.log(`[OpenWA Server] Starting sync-chats for ${sessionId}`);
        const chats = await s.client.getAllChats();
        let syncedCount = 0;

        for (const chat of chats || []) {
          const chatId = chat.id?._serialized || chat.id || chat.jid || '';
          if (
            !chatId ||
            typeof chatId !== 'string' ||
            chatId.endsWith('@g.us') ||
            chatId.endsWith('@newsletter') ||
            chatId.endsWith('@broadcast') ||
            chatId.startsWith('0@')
          ) {
            continue;
          }

          try {
            const msgsPromise = s.client.getAllMessagesInChat(chatId, true, false);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout fetching messages')), 5000));
            const msgs = await Promise.race([msgsPromise, timeoutPromise]);
            const recent = (msgs || []).slice(-15);
            for (const message of recent) {
              if (s.webhookUrl) {
                const payload = {
                  event: 'message.created',
                  instance: sessionId,
                  instanceName: sessionId,
                  sessionId: sessionId,
                  data: message,
                };
                await fetch(s.webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                }).catch((e) => console.error('[Sync fetch error]', e.message));
                syncedCount++;
              }
            }
          } catch (err) {
            console.warn(`[OpenWA Server] Sync error for chat ${chatId}:`, err.message);
          }
        }
        return json({ ok: true, syncedMessages: syncedCount, chatsCount: (chats || []).length });
      } catch (err) {
        console.error('[OpenWA Server] Sync chats error:', err.message);
        return json({ error: err.message }, 500);
      }
    }

    // DELETE /api/sessions/:sessionId
    const deleteMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const sessionId = decodeURIComponent(deleteMatch[1]);
      const s = sessions.get(sessionId);
      if (s) {
        sessions.delete(sessionId);
        saveRegisteredSessions();
        if (s.client) {
          try { await s.client.kill('session deleted'); } catch {}
        }
        // Sessão sem login ainda não tem client: o Chrome dela precisa ser encerrado pelo perfil.
        killSessionBrowser(sessionId);
      }
      return json({ ok: true });
    }

    // POST /api/sessions/:sessionId/messages/send-text
    const sendTextMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/send-text$/);
    if (method === 'POST' && sendTextMatch) {
      const sessionId = decodeURIComponent(sendTextMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'Session not connected' }, 400);

      let chatId = body.chatId || '';
      if (!chatId.includes('@')) {
        chatId = `${chatId.replace(/\D/g, '')}@c.us`;
      } else if (chatId.endsWith('@lid')) {
        const digits = chatId.split('@')[0].replace(/\D/g, '');
        if (digits) chatId = `${digits}@c.us`;
      }

      try {
        const page = s.client._page || s.client.page;
        if (page) {
          const sendResult = await page.evaluate(async (targetChatId, textToSend) => {
            const r = window.require;
            const widFactory = r("WAWebWidFactory");
            const queryExistsMod = r("WAWebQueryExistsJob");
            const sendTextMod = r("WAWebSendTextMsgChatAction");

            // Clean DRM on Wid.prototype if not already cleaned
            const proto = Object.getPrototypeOf(widFactory.createWid("0@c.us"));
            if (!proto.__cleanDrmApplied) {
              Object.defineProperty(proto, "_serialized", {
                get() {
                  return this.user + (this.device != null && this.device !== 0 ? ":" + this.device : "") + "@" + this.server;
                },
                set(v) { this.__val = v; },
                configurable: true,
                enumerable: true
              });
              proto.toString = function(opts) {
                if (opts && opts.forLog) return this.user.slice(-4) + "@" + this.server;
                return this._serialized;
              };
              proto.__cleanDrmApplied = true;
            }

            let cleanDigits = targetChatId.replace(/\D/g, "");
            let cleanJid = targetChatId.includes("@") ? targetChatId : `${cleanDigits}@c.us`;
            let wid = widFactory.createWid(cleanJid);
            delete wid["$1"];

            let targetWid = wid;
            if (!cleanJid.endsWith("@g.us") && !cleanJid.endsWith("@lid")) {
              try {
                const exists = await queryExistsMod.queryWidExists(wid);
                if (exists && exists.wid) {
                  targetWid = exists.wid;
                  delete targetWid["$1"];
                }
              } catch (e) {}
            }

            let chat = window.Store.Chat.get(targetWid) || 
                       window.Store.Chat.get(targetWid._serialized) || 
                       window.Store.Chat.get(cleanJid) ||
                       window.Store.Chat.getLatestChatForWid(targetWid);

            if (!chat) {
              window.Store.Chat.add({ id: targetWid });
              chat = window.Store.Chat.get(targetWid) || window.Store.Chat.get(targetWid._serialized);
            }
            if (chat && chat.id) {
              delete chat.id["$1"];
            }

            if (!chat) throw new Error("Não foi possível encontrar ou criar chat para " + targetChatId);

            const res = await sendTextMod.sendTextMsgToChat(chat, textToSend);
            const msgId = res?.id?._serialized || (chat.lastReceivedKey?._serialized) || "msg_" + Date.now();
            return { messageId: msgId, status: res?.status };
          }, chatId, body.text);

          return json(sendResult);
        } else {
          const result = await s.client.sendText(chatId, body.text);
          return json({ messageId: result });
        }
      } catch (err) {
        console.error(`[OpenWA Server] sendText error for ${chatId}:`, err.message);
        return json({ error: err.message }, 500);
      }
    }

    // POST /api/sessions/:sessionId/messages/send-media
    const sendMediaMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/send-media$/);
    if (method === 'POST' && sendMediaMatch) {
      const sessionId = decodeURIComponent(sendMediaMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'Session not connected' }, 400);

      let chatId = body.chatId || '';
      if (!chatId.includes('@')) {
        chatId = `${chatId.replace(/\D/g, '')}@c.us`;
      } else if (chatId.endsWith('@lid')) {
        const digits = chatId.split('@')[0].replace(/\D/g, '');
        if (digits) chatId = `${digits}@c.us`;
      }

      try {
        const result = await s.client.sendFile(chatId, body.mediaUrl || body.base64, body.filename || 'file', body.caption || '');
        return json({ messageId: result });
      } catch (err) {
        console.error(`[OpenWA Server] sendFile error for ${chatId}:`, err.message);
        return json({ error: err.message }, 500);
      }
    }

    // POST /api/sessions/:sessionId/messages/send-voice
    const sendVoiceMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/send-voice$/);
    if (method === 'POST' && sendVoiceMatch) {
      const sessionId = decodeURIComponent(sendVoiceMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'Session not connected' }, 400);

      let chatId = body.chatId || '';
      if (!chatId.includes('@')) {
        chatId = `${chatId.replace(/\D/g, '')}@c.us`;
      } else if (chatId.endsWith('@lid')) {
        const digits = chatId.split('@')[0].replace(/\D/g, '');
        if (digits) chatId = `${digits}@c.us`;
      }

      try {
        const base64Data = body.base64 || '';
        const audio = base64Data ? await toOggOpusDataUrl(base64Data) : body.audioUrl || '';
        if (!audio) return json({ error: 'Áudio vazio' }, 400);
        const result = await s.client.sendPtt(chatId, audio);
        return json({ messageId: result });
      } catch (err) {
        console.error(`[OpenWA Server] sendPtt error for ${chatId}:`, err.message);
        return json({ error: err.message }, 500);
      }
    }

    // GET /api/sessions/:sessionId/messages/:messageId/media (baixa e descriptografa áudio/imagem recebidos)
    const mediaMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/([^/]+)\/media$/);
    if (method === 'GET' && mediaMatch) {
      const sessionId = decodeURIComponent(mediaMatch[1]);
      const messageId = decodeURIComponent(mediaMatch[2]);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'Session not connected' }, 400);
      try {
        const parsed = parseDataUrl(await s.client.decryptMedia(messageId));
        if (!parsed) return json({ error: 'Mídia não encontrada' }, 404);
        return json(parsed);
      } catch (err) {
        console.error(`[OpenWA Server] decryptMedia error for ${messageId}:`, err.message);
        return json({ error: err.message }, 500);
      }
    }

    // POST /api/sessions/:sessionId/chat/presence
    const presenceMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/chat\/presence$/);
    if (method === 'POST' && presenceMatch) {
      const sessionId = decodeURIComponent(presenceMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (s && s.client) {
        try {
          let chatId = body.chatId || '';
          if (!chatId.includes('@')) chatId = `${chatId.replace(/\D/g, '')}@c.us`;
          if (body.presence === 'composing') {
            await s.client.simulateTyping(chatId, true);
          } else {
            await s.client.simulateTyping(chatId, false);
          }
        } catch {}
      }
      return json({ ok: true });
    }

    // POST /api/sessions/:sessionId/chat/seen (Marca mensagens como lidas com tick azul)
    const seenMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/chat\/seen$/);
    if (method === 'POST' && seenMatch) {
      const sessionId = decodeURIComponent(seenMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (s && s.client) {
        try {
          let chatId = body.chatId || '';
          if (!chatId.includes('@')) chatId = `${chatId.replace(/\D/g, '')}@c.us`;
          await s.client.sendSeen(chatId);
        } catch (e) {
          console.warn('[OpenWA sendSeen]', e.message);
        }
      }
      return json({ ok: true });
    }

    // GET /api/sessions/:sessionId/contacts/:chatId/profile (Foto de perfil e dados reais do WhatsApp)
    const profileMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/contacts\/([^/]+)\/profile$/);
    if (method === 'GET' && profileMatch) {
      const sessionId = decodeURIComponent(profileMatch[1]);
      const rawChatId = decodeURIComponent(profileMatch[2]);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'Session not connected' }, 400);
      let chatId = rawChatId.includes('@') ? rawChatId : `${rawChatId.replace(/\D/g, '')}@c.us`;
      try {
        const [pic, contact, status] = await Promise.allSettled([
          s.client.getProfilePicFromServer(chatId),
          s.client.getContact(chatId),
          s.client.getStatus(chatId),
        ]);
        return json({
          profilePicUrl: pic.status === 'fulfilled' ? pic.value : null,
          name: contact.status === 'fulfilled' ? (contact.value?.pushname || contact.value?.name) : null,
          about: status.status === 'fulfilled' ? status.value?.status : null,
        });
      } catch (e) {
        return json({ profilePicUrl: null, name: null, about: null });
      }
    }

    // POST /api/sessions/:sessionId/eval
    const evalMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/eval$/);
    // Executa código arbitrário no servidor: só para depuração local, com OPENWA_ENABLE_EVAL=true.
    if (method === 'POST' && evalMatch && !ENABLE_EVAL) {
      return json({ error: 'Not found' }, 404);
    }
    if (method === 'POST' && evalMatch) {
      const sessionId = decodeURIComponent(evalMatch[1]);
      const body = await parseJsonBody(req);
      const s = sessions.get(sessionId);
      if (!s || !s.client) return json({ error: 'No client' }, 400);
      try {
        const page = s.client.page || s.client._page;
        if (page) {
          const fn = new Function('page', body.code);
          const result = await fn(page);
          return json({ ok: true, result });
        } else if (s.client.pup) {
          const result = await s.client.pup(new Function(body.code));
          return json({ ok: true, result });
        }
        return json({ error: 'No page or pup' }, 400);
      } catch (e) {
        return json({ ok: false, error: e.message, stack: e.stack }, 500);
      }
    }

    // Default 404
    json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('[OpenWA Server Error]', err);
    json({ error: err.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`===================================================`);
  console.log(`[OpenWA Server] Listening on http://${HOST || 'localhost'}:${PORT}`);
  if (!API_KEY) console.warn('[OpenWA Server] OPENWA_API_KEY não definida: aceitando apenas chamadas locais (127.0.0.1).');
  console.log(`===================================================`);

  // Reabre as sessões que já estavam conectadas antes do reinício (sem novo QR se o login ainda vale).
  const registered = loadRegisteredSessions();
  if (registered.length) {
    console.log(`[OpenWA Server] Restaurando ${registered.length} sessão(ões): ${registered.map((s) => s.name).join(', ')}`);
    for (const { name, webhookUrl } of registered) {
      getOrCreateSession(name, webhookUrl).catch((err) =>
        console.error(`[OpenWA Server] Falha ao restaurar ${name}:`, err.message),
      );
    }
  }
});
