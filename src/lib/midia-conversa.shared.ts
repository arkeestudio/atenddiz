// Marcador de mídia gravado no texto da mensagem, ex: "📷 Imagem [Imagem: <caminho>]".
// Fica num arquivo à parte porque o painel também precisa dele, e o `.server`
// carrega a chave de serviço do Supabase — que nunca pode ir para o navegador.

const MARCADOR = /\[Imagem:\s*([^\]]+)\]/;

export function extrairCaminhoMidia(texto: string): string | null {
  const m = String(texto ?? "").match(MARCADOR);
  return m ? m[1].trim() : null;
}

export function marcadorMidia(caminho: string) {
  return `[Imagem: ${caminho}]`;
}

/** Texto sem o marcador, para exibir no balão e mandar para a IA. */
export function textoSemMarcadorMidia(texto: string): string {
  return String(texto ?? "").replace(MARCADOR, "").replace(/\s{2,}/g, " ").trim();
}
