import type {
  IWhatsAppProvider,
  ConnectResult,
  StatusResult,
  DisconnectResult,
  SendMessageResult,
} from "./whatsapp-provider.interface";

function deriveInstanceName(companyId: string) {
  return `atendezap_${companyId.replace(/-/g, "").slice(0, 16)}`;
}

function nextInstanceName(companyId: string, current?: string | null) {
  const base = deriveInstanceName(companyId);
  const match = current ? /_r(\d+)$/.exec(current) : null;
  const gen = match ? Number(match[1]) + 1 : 2;
  return `${base}_r${gen}`;
}

async function buildWebhookUrl(token?: string | null) {
  try {
    const { getRequestOrigin } = await import("@/lib/request-utils.server");
    const origin = getRequestOrigin();
    if (!origin) return "";
    const tokenQuery = token ? `?t=${encodeURIComponent(token)}` : "";
    return `${origin}/api/public/whatsapp-webhook${tokenQuery}`;
  } catch {
    return "";
  }
}

export class EvolutionAdapter implements IWhatsAppProvider {
  readonly providerName = "evolution";

  async connect(
    companyId: string,
    currentInstanceOrSessionId?: string | null,
    force?: boolean,
  ): Promise<ConnectResult> {
    const {
      evoCreateInstance,
      evoGetQr,
      evoSetWebhook,
      evoCurrentState,
      evoHardDisconnect,
      parseQrPayload,
    } = await import("../evolution.server");

    let instanceName = currentInstanceOrSessionId || deriveInstanceName(companyId);
    const webhookUrl = await buildWebhookUrl();

    if (currentInstanceOrSessionId && !force) {
      if ((await evoCurrentState(currentInstanceOrSessionId)) === "open") {
        if (webhookUrl) {
          try {
            await evoSetWebhook(currentInstanceOrSessionId, webhookUrl);
          } catch (e) {
            console.warn("[evolution.setWebhook]", e);
          }
        }
        return {
          instanceName: currentInstanceOrSessionId,
          qrBase64: null,
          code: null,
          state: "open",
          webhookUrl,
        };
      }
    }

    if (currentInstanceOrSessionId && force) {
      const dropped = await evoHardDisconnect(currentInstanceOrSessionId);
      if (dropped.orphaned) {
        instanceName = nextInstanceName(companyId, currentInstanceOrSessionId);
      }
    }

    const acquireQr = async (name: string) => {
      try {
        const created: any = await evoCreateInstance(name, webhookUrl);
        const fromCreate = await parseQrPayload(created?.qrcode ?? created);
        if (fromCreate.qrBase64 || fromCreate.code) return fromCreate;
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (!/exists|already|in use/i.test(msg)) {
          throw e;
        }
      }

      if (webhookUrl) {
        try {
          await evoSetWebhook(name, webhookUrl);
        } catch (e) {
          console.warn("[evolution.setWebhook]", e);
        }
      }

      let lastQrError: unknown = null;
      for (let i = 0; i < 6; i++) {
        try {
          const qr = await evoGetQr(name);
          if (qr.qrBase64 || qr.code) return qr;
        } catch (e) {
          lastQrError = e;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      if (lastQrError) throw lastQrError;
      return { qrBase64: null, code: null, pairingCode: null };
    };

    let qr = await acquireQr(instanceName);

    if (!qr.qrBase64 && !qr.code && (await evoCurrentState(instanceName)) === "open") {
      instanceName = nextInstanceName(companyId, instanceName);
      qr = await acquireQr(instanceName);
    }

    if (!qr.qrBase64 && !qr.code) {
      throw new Error(
        "O servidor do WhatsApp (Evolution API) não devolveu o QR Code. Tente novamente em alguns segundos.",
      );
    }

    const state = (await evoCurrentState(instanceName)) ?? undefined;
    return {
      instanceName,
      qrBase64: qr.qrBase64,
      code: qr.code,
      pairingCode: qr.pairingCode,
      state,
      webhookUrl,
    };
  }

  async getStatus(
    _companyId: string,
    currentInstanceOrSessionId?: string | null,
  ): Promise<StatusResult> {
    if (!currentInstanceOrSessionId) {
      return { status: "disconnected", state: null, numero: null };
    }

    const { evoState, evoFetchNumberFromInstance } = await import("../evolution.server");

    let state: string | null = null;
    let stateError = false;
    try {
      const s = await evoState(currentInstanceOrSessionId);
      state = s?.instance?.state || (s as any)?.state || null;
    } catch (e) {
      stateError = true;
    }

    if (stateError) {
      return { status: "disconnected", state: null, numero: null };
    }

    const newStatus =
      state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";

    let numero: string | null = null;
    if (newStatus === "connected") {
      try {
        numero = await evoFetchNumberFromInstance(currentInstanceOrSessionId);
      } catch {}
    }

    return { status: newStatus, state, numero, qrBase64: null, code: null };
  }

  async disconnect(
    _companyId: string,
    currentInstanceOrSessionId?: string | null,
  ): Promise<DisconnectResult> {
    if (!currentInstanceOrSessionId) return { ok: true };
    const { evoHardDisconnect } = await import("../evolution.server");
    const { closed, deleted, orphaned, logoutError, deleteError } =
      await evoHardDisconnect(currentInstanceOrSessionId);
    if (!closed) {
      throw new Error(
        `Não foi possível encerrar a sessão na Evolution API (${logoutError || deleteError || "erro desconhecido"}).`,
      );
    }
    return { ok: true, deleted, orphaned };
  }

  async sendText(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    text: string,
  ): Promise<SendMessageResult> {
    const { evoSendText } = await import("../evolution.server");
    const res: any = await evoSendText(instanceOrSessionId, number, text);
    return { ok: true, messageId: res?.key?.id || res?.messageId || null };
  }

  async sendMedia(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<SendMessageResult> {
    const { evoSendMedia } = await import("../evolution.server");
    const res: any = await evoSendMedia(instanceOrSessionId, number, mediaUrl, caption);
    return { ok: true, messageId: res?.key?.id || res?.messageId || null };
  }

  async sendPresence(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    presence: "composing" | "paused" | "available",
    delayMs = 1500,
  ): Promise<void> {
    const { evoSendPresence } = await import("../evolution.server");
    await evoSendPresence(instanceOrSessionId, number, presence, delayMs);
  }

  async getMediaBase64(
    _companyId: string,
    instanceOrSessionId: string,
    messageObjOrId: any,
  ): Promise<{ base64: string; mimetype?: string } | null> {
    const { evoGetMediaBase64 } = await import("../evolution.server");
    return evoGetMediaBase64(instanceOrSessionId, messageObjOrId);
  }
}
