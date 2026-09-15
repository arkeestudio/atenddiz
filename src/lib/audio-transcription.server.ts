// Transcrição de áudios do WhatsApp (recebidos e enviados).
// A mensagem é salva antes com o marcador de "transcrevendo" e atualizada aqui, para o áudio
// aparecer na conversa na hora e a transcrição chegar pelo realtime assim que ficar pronta.

import { audioTranscribedText } from "@/lib/audio-labels";

export { AUDIO_RECEBIDO, AUDIO_ENVIADO, TRANSCREVENDO, audioPendingText, audioTranscribedText } from "@/lib/audio-labels";

/**
 * Transcreve o áudio e atualiza o texto da mensagem. Usa o `base64` quando já disponível
 * (nota gravada no painel); senão baixa a mídia do WhatsApp pelo id da mensagem.
 * Retorna a transcrição, ou "" se não foi possível (a mensagem fica só com o rótulo).
 */
export async function transcribeAndUpdateMessage(opts: {
  db: any;
  companyId: string;
  messageId: string;
  label: string;
  instanceName?: string | null;
  whatsappMedia?: any;
  base64?: string;
  mimetype?: string;
}): Promise<string> {
  const { db, companyId, messageId, label } = opts;
  let transcript = "";
  try {
    let base64 = opts.base64;
    let mimetype = opts.mimetype;
    if (base64?.startsWith("data:")) {
      const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(base64);
      mimetype = mimetype || match?.[1];
      base64 = match?.[3];
    }
    if (!base64 && opts.instanceName && opts.whatsappMedia) {
      const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");
      const provider = getWhatsAppProvider();
      if (provider.getMediaBase64) {
        const media = await provider.getMediaBase64(companyId, opts.instanceName, opts.whatsappMedia);
        base64 = media?.base64;
        mimetype = media?.mimetype;
      }
    }
    if (base64) {
      const { geminiTranscribeAudio } = await import("@/lib/lovable-ai.server");
      transcript = (await geminiTranscribeAudio(base64, mimetype)).trim();
    }
  } catch (e: any) {
    console.error("[audio transcribe]", e?.message);
  }

  await db
    .from("mensagens")
    .update({ texto: transcript ? audioTranscribedText(label, transcript) : label })
    .eq("id", messageId)
    .eq("company_id", companyId);

  return transcript;
}
