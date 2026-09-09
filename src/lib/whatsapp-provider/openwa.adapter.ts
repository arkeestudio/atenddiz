import type {
  IWhatsAppProvider,
  ConnectResult,
  StatusResult,
  DisconnectResult,
  SendMessageResult,
} from "./whatsapp-provider.interface";
import {
  openwaCreateSession,
  openwaGetSession,
  openwaGetQr,
  openwaSetWebhook,
  openwaDeleteSession,
  openwaSendText,
  openwaSendMedia,
  openwaSendPresence,
} from "./openwa.server";

function deriveSessionName(companyId: string) {
  return `openwa_${companyId.replace(/-/g, "").slice(0, 16)}`;
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

export class OpenWAAdapter implements IWhatsAppProvider {
  readonly providerName = "openwa";

  async connect(
    companyId: string,
    currentInstanceOrSessionId?: string | null,
    force?: boolean,
  ): Promise<ConnectResult> {
    const sessionName = currentInstanceOrSessionId || deriveSessionName(companyId);
    const webhookUrl = await buildWebhookUrl();

    if (currentInstanceOrSessionId && force) {
      await openwaDeleteSession(currentInstanceOrSessionId);
    }

    let session: any = null;
    try {
      session = await openwaCreateSession(sessionName, webhookUrl);
    } catch (e) {
      session = await openwaGetSession(sessionName);
    }

    const sessionId = session?.id || session?.sessionId || sessionName;

    if (webhookUrl) {
      await openwaSetWebhook(sessionId, webhookUrl);
    }

    const qrInfo = await openwaGetQr(sessionId);

    return {
      instanceName: sessionId,
      qrBase64: qrInfo.qrBase64,
      code: qrInfo.code,
      pairingCode: qrInfo.pairingCode,
      state: session?.status || "INITIALIZING",
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

    const session = await openwaGetSession(currentInstanceOrSessionId);
    if (!session) {
      return { status: "disconnected", state: null, numero: null };
    }

    const rawStatus = String(session.status || session.state || "").toUpperCase();
    const newStatus =
      rawStatus === "CONNECTED" || rawStatus === "OPEN"
        ? "connected"
        : rawStatus === "PAIRING" || rawStatus === "CONNECTING" || rawStatus === "STARTING" || rawStatus === "SCAN_QR_CODE" || rawStatus === "INITIALIZING"
        ? "connecting"
        : "disconnected";

    const numero = session.phone || session.phoneNumber || session.me?.id?.split("@")[0] || null;

    let qrBase64: string | null = null;
    let code: string | null = null;

    if (newStatus === "connecting") {
      const qr = await openwaGetQr(currentInstanceOrSessionId);
      qrBase64 = qr.qrBase64;
      code = qr.code;
    }

    return { status: newStatus, state: session.status || null, numero, qrBase64, code };
  }

  async disconnect(
    _companyId: string,
    currentInstanceOrSessionId?: string | null,
  ): Promise<DisconnectResult> {
    if (!currentInstanceOrSessionId) return { ok: true };
    await openwaDeleteSession(currentInstanceOrSessionId);
    return { ok: true, deleted: true };
  }

  async sendText(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    text: string,
  ): Promise<SendMessageResult> {
    const res: any = await openwaSendText(instanceOrSessionId, number, text);
    return { ok: true, messageId: res?.messageId || res?.id || null };
  }

  async sendMedia(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<SendMessageResult> {
    const res: any = await openwaSendMedia(instanceOrSessionId, number, mediaUrl, caption);
    return { ok: true, messageId: res?.messageId || res?.id || null };
  }

  async sendVoice(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    base64Audio: string,
  ): Promise<SendMessageResult> {
    const { openwaSendVoice } = await import("./openwa.server");
    const res: any = await openwaSendVoice(instanceOrSessionId, number, base64Audio);
    return { ok: true, messageId: res?.messageId || res?.id || null };
  }

  async sendPresence(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
    presence: "composing" | "paused" | "available",
    delayMs = 1500,
  ): Promise<void> {
    await openwaSendPresence(instanceOrSessionId, number, presence, delayMs);
  }

  async sendSeen(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
  ): Promise<void> {
    const { openwaSendSeen } = await import("./openwa.server");
    await openwaSendSeen(instanceOrSessionId, number);
  }

  async getProfile(
    _companyId: string,
    instanceOrSessionId: string,
    number: string,
  ): Promise<{ profilePicUrl: string | null; name: string | null; about: string | null }> {
    const { openwaGetProfile } = await import("./openwa.server");
    return await openwaGetProfile(instanceOrSessionId, number);
  }
}
