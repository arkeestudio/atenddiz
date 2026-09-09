export interface ConnectResult {
  instanceName: string;
  qrBase64: string | null;
  code: string | null;
  pairingCode?: string | null;
  state?: string;
  webhookUrl?: string;
}

export interface StatusResult {
  status: "connected" | "connecting" | "disconnected";
  state: string | null;
  numero: string | null;
  qrBase64?: string | null;
  code?: string | null;
}

export interface DisconnectResult {
  ok: boolean;
  deleted?: boolean;
  orphaned?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: string | null;
}

export interface IWhatsAppProvider {
  readonly providerName: string;

  connect(
    companyId: string,
    currentInstanceOrSessionId?: string | null,
    force?: boolean,
  ): Promise<ConnectResult>;

  getStatus(
    companyId: string,
    currentInstanceOrSessionId?: string | null,
  ): Promise<StatusResult>;

  disconnect(
    companyId: string,
    currentInstanceOrSessionId?: string | null,
  ): Promise<DisconnectResult>;

  sendText(
    companyId: string,
    instanceOrSessionId: string,
    number: string,
    text: string,
  ): Promise<SendMessageResult>;

  sendMedia?(
    companyId: string,
    instanceOrSessionId: string,
    number: string,
    mediaUrl: string,
    caption?: string,
  ): Promise<SendMessageResult>;

  sendVoice?(
    companyId: string,
    instanceOrSessionId: string,
    number: string,
    base64Audio: string,
  ): Promise<SendMessageResult>;

  sendPresence?(
    companyId: string,
    instanceOrSessionId: string,
    number: string,
    presence: "composing" | "paused" | "available",
    delayMs?: number,
  ): Promise<void>;

  getMediaBase64?(
    companyId: string,
    instanceOrSessionId: string,
    messageObjOrId: any,
  ): Promise<{ base64: string; mimetype?: string } | null>;

  sendSeen?(
    companyId: string,
    instanceOrSessionId: string,
    number: string,
  ): Promise<void>;

  getProfile?(
    companyId: string,
    instanceOrSessionId: string,
    number: string,
  ): Promise<{ profilePicUrl: string | null; name: string | null; about: string | null }>;
}
