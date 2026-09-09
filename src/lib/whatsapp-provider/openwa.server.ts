import * as QRCode from "qrcode";

const SUPPORT_SUFFIX = " Se persistir, verifique as configurações da API do OpenWA.";

function env() {
  const url = process.env.OPENWA_API_URL || "http://localhost:2785";
  const key = process.env.OPENWA_API_KEY || "";
  return { url: url.replace(/\/+$/, ""), key };
}

let startingPromise: Promise<void> | null = null;

async function ensureOpenWAServerRunning(url: string) {
  if (!url.includes("localhost:2785") && !url.includes("127.0.0.1:2785")) return;
  if (startingPromise) return startingPromise;

  startingPromise = (async () => {
    console.log("[openwa] Servidor OpenWA local offline na porta 2785. Iniciando openwa_server.mjs automaticamente...");
    try {
      const { spawn } = await import("child_process");
      const path = await import("path");
      const serverPath = path.resolve(process.cwd(), "openwa_server.mjs");

      const child = spawn(process.execPath, [serverPath], {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
      });
      child.unref();

      // Aguarda até o servidor responder (até 8 segundos)
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const check = await fetch(`${url}/api/sessions`, {
            method: "GET",
            signal: AbortSignal.timeout(800),
          });
          if (check.status !== 502 && check.status !== 504) {
            console.log("[openwa] Servidor local OpenWA iniciado com sucesso e respondendo!");
            break;
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn("[openwa] Falha ao auto-iniciar openwa_server.mjs:", e.message);
    } finally {
      startingPromise = null;
    }
  })();

  return startingPromise;
}

async function openwaFetch<T = any>(
  path: string,
  init: RequestInit & { json?: any } = {},
): Promise<T> {
  const { url, key } = env();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(key ? { "X-API-Key": key } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const fullPath = path.startsWith("/api") ? path : `/api${path}`;
  let res: Response;
  try {
    res = await fetch(`${url}${fullPath}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch (e: any) {
    if (url.includes("localhost:2785") || url.includes("127.0.0.1:2785")) {
      await ensureOpenWAServerRunning(url);
      try {
        res = await fetch(`${url}${fullPath}`, {
          ...init,
          headers,
          body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        });
      } catch (retryErr: any) {
        throw new Error(`OpenWA API indisponível: ${retryErr?.message || "falha de rede"}.${SUPPORT_SUFFIX}`);
      }
    } else {
      throw new Error(`OpenWA API indisponível: ${e?.message || "falha de rede"}.${SUPPORT_SUFFIX}`);
    }
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    console.warn(`[openwa] ${init.method || "GET"} ${path} -> ${res.status}`, text.slice(0, 400));
    throw new Error(`OpenWA API: ${msg}.${SUPPORT_SUFFIX}`);
  }

  return data as T;
}

export async function openwaCreateSession(name: string, webhookUrl?: string) {
  // POST /api/sessions
  const body: any = { name };
  if (webhookUrl) {
    body.webhookUrl = webhookUrl;
  }
  return openwaFetch(`/sessions`, { method: "POST", json: body });
}

export async function openwaGetSession(sessionId: string) {
  // GET /api/sessions/{id}
  try {
    return await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
  } catch (e) {
    return null;
  }
}

export async function openwaGetQr(sessionId: string): Promise<{ qrBase64: string | null; code: string | null; pairingCode: string | null }> {
  try {
    const res = await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/qr`, { method: "GET" });
    const qrString = res?.qrBase64 || res?.qrCode || res?.code || res?.data || (typeof res === "string" ? res : null);
    const pairingCode = res?.pairingCode || null;

    if (qrString) {
      if (qrString.startsWith("data:image/")) {
        return { qrBase64: qrString, code: null, pairingCode };
      }
      // Se for string pura do QR, gera a data URL base64
      const qrBase64 = await QRCode.toDataURL(qrString, { width: 320, margin: 2, errorCorrectionLevel: "M" });
      return { qrBase64, code: qrString, pairingCode };
    }
    return { qrBase64: null, code: null, pairingCode };
  } catch (e) {
    console.warn("[openwa.getQr]", e);
    return { qrBase64: null, code: null, pairingCode: null };
  }
}

export async function openwaSetWebhook(sessionId: string, webhookUrl: string) {
  try {
    return await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/webhooks`, {
      method: "POST",
      json: { url: webhookUrl, events: ["message.created", "session.status_changed"] },
    });
  } catch (e) {
    console.warn("[openwa.setWebhook]", e);
  }
}

export async function openwaDeleteSession(sessionId: string) {
  try {
    return await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch (e: any) {
    console.warn("[openwa.deleteSession]", e?.message || e);
    return { ok: false, error: e?.message };
  }
}

export async function openwaSendText(sessionId: string, number: string, text: string) {
  const chatId = number.includes("@") ? number : `${number.replace(/\D/g, "")}@c.us`;
  return openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
    method: "POST",
    json: { chatId, text },
  });
}

export async function openwaSendMedia(sessionId: string, number: string, mediaUrlOrBase64: string, caption?: string, filename?: string) {
  const chatId = number.includes("@") ? number : `${number.replace(/\D/g, "")}@c.us`;
  const isBase64 = mediaUrlOrBase64.startsWith("data:");
  return openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/messages/send-media`, {
    method: "POST",
    json: {
      chatId,
      ...(isBase64 ? { base64: mediaUrlOrBase64 } : { mediaUrl: mediaUrlOrBase64 }),
      filename: filename || "file",
      caption: caption || "",
    },
  });
}

export async function openwaSendVoice(sessionId: string, number: string, base64Audio: string) {
  const chatId = number.includes("@") ? number : `${number.replace(/\D/g, "")}@c.us`;
  return openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/messages/send-voice`, {
    method: "POST",
    json: { chatId, base64: base64Audio },
  });
}

export async function openwaSendPresence(sessionId: string, number: string, presence: "composing" | "paused" | "available", delayMs = 1500) {
  try {
    const chatId = number.includes("@") ? number : `${number.replace(/\D/g, "")}@c.us`;
    await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/chat/presence`, {
      method: "POST",
      json: { chatId, presence, delay: delayMs },
    });
  } catch {
    // best-effort
  }
}

export async function openwaSendSeen(sessionId: string, number: string) {
  try {
    const chatId = number.includes("@") ? number : `${number.replace(/\D/g, "")}@c.us`;
    await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/chat/seen`, {
      method: "POST",
      json: { chatId },
    });
  } catch {
    // best-effort
  }
}

export async function openwaGetProfile(sessionId: string, number: string): Promise<{ profilePicUrl: string | null; name: string | null; about: string | null }> {
  try {
    const chatId = number.includes("@") ? number : `${number.replace(/\D/g, "")}@c.us`;
    return await openwaFetch(`/sessions/${encodeURIComponent(sessionId)}/contacts/${encodeURIComponent(chatId)}/profile`, {
      method: "GET",
    });
  } catch {
    return { profilePicUrl: null, name: null, about: null };
  }
}

