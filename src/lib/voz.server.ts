// SERVER ONLY. Transforma a resposta da IA em nota de voz (Gemini TTS).
//
// O WAV que sai daqui vai para o servidor OpenWA, que já converte para o formato de nota
// de voz do WhatsApp com ffmpeg — é o mesmo caminho do microfone do painel. Falhou ou
// demorou demais: a resposta vai em texto, como sempre. O cliente nunca fica sem resposta.
import { VOZ_PADRAO } from "./voz.shared";

const MODELO_TTS = "gemini-3.8-flash-lite-tts";
// Em teste, 13 s de áudio levaram 5 a 6 s para gerar. Acima disso, texto.
const TIMEOUT_MS = 12_000;
// Ninguém ouve nota de voz de 30 segundos de uma empresa. ~45 palavras ≈ 15 s.
const MAX_PALAVRAS_AUDIO = 45;

const ESTILO = "simpática e acolhedora, falando português do Brasil com naturalidade, no ritmo de uma conversa de WhatsApp";

/** Decide se a resposta vira áudio. O motivo vai para o rastro da IA quando não vira. */
export function deveVirarAudio(texto: string): { ok: true } | { ok: false; motivo: string } {
  const palavras = texto.split(/\s+/).filter(Boolean).length;
  if (palavras > MAX_PALAVRAS_AUDIO) return { ok: false, motivo: `longa (${palavras} palavras)` };
  // De ouvido ninguém guarda "mil trezentos e quarenta e nove reais", nem um link, nem um
  // horário. Isso a pessoa precisa reler — fica em texto.
  if (/R\$\s?\d/.test(texto)) return { ok: false, motivo: "tem valor" };
  if (/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(texto)) return { ok: false, motivo: "tem data" };
  if (/\b\d{1,2}(:\d{2}|h\d{0,2})\b/i.test(texto)) return { ok: false, motivo: "tem horário" };
  if (/https?:\/\/|www\./i.test(texto)) return { ok: false, motivo: "tem link" };
  if (/\bpix\b|```/i.test(texto)) return { ok: false, motivo: "tem pix" };
  if (/\b\d{8,}\b/.test(texto)) return { ok: false, motivo: "tem telefone/código" };
  if (/\b(rua|avenida|av\.|travessa|nº|n°|cep)\b/i.test(texto)) return { ok: false, motivo: "tem endereço" };
  return { ok: true };
}

// O que vai para a voz é só a fala: sem emoji, sem asterisco de negrito, sem o separador de bolhas.
function limparParaFala(texto: string): string {
  return texto
    .replace(/\|\|\|/g, " ")
    .replace(/[*_~`]+/g, "")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Gera a nota de voz. Devolve data URL (audio/wav) ou null se não deu. Nunca lança. */
export async function gerarNotaDeVoz(texto: string, voz?: string | null): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const fala = limparParaFala(texto);
  if (!fala) return null;

  const body = {
    model: MODELO_TTS,
    input: [{ type: "user_input", content: [{ type: "text", text: fala, annotations: [{ type: "speech_metadata", style: ESTILO }] }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: voz?.trim() || VOZ_PADRAO }] },
  };

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[voz] Gemini TTS", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const json = await res.json();
    // O áudio vem em steps[].content[] como { type: "audio", data, mime_type }. Procura
    // em qualquer profundidade para não quebrar se o envelope mudar de lugar.
    let audio: { data: string; mime_type?: string; mimeType?: string } | null = null;
    const anda = (o: any) => {
      if (!o || typeof o !== "object" || audio) return;
      if (o.type === "audio" && typeof o.data === "string") { audio = o; return; }
      for (const v of Object.values(o)) anda(v);
    };
    anda(json);
    if (!audio) return null;
    const { data, mime_type, mimeType } = audio as { data: string; mime_type?: string; mimeType?: string };
    return `data:${mime_type || mimeType || "audio/wav"};base64,${data}`;
  } catch (e: any) {
    console.warn("[voz] não gerou:", e?.name === "TimeoutError" ? `passou de ${TIMEOUT_MS / 1000}s` : e?.message);
    return null;
  }
}
