// Rótulos das mensagens de áudio, compartilhados entre servidor e tela de conversas.

export const AUDIO_RECEBIDO = "🎤 [Áudio]";
export const AUDIO_ENVIADO = "🎤 [Nota de Voz]";
export const TRANSCREVENDO = "⏳ Transcrevendo...";

export function audioPendingText(label: string) {
  return `${label} ${TRANSCREVENDO}`;
}

export function audioTranscribedText(label: string, transcript: string) {
  return `${label} 📝 Transcrição: "${transcript}"`;
}
