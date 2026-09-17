// Guarda a mídia das conversas no bucket privado `whatsapp-media`.
//
// O OpenWA entrega a imagem como base64 dentro da própria mensagem. Guardar esse base64
// no texto da mensagem seria ruim por dois motivos: polui a conversa no painel e, pior,
// entra no histórico que a IA lê a cada resposta — uma foto de 700 KB viraria ~230 mil
// tokens numa mensagem só. Por isso subimos o arquivo e guardamos apenas o caminho.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const BUCKET_MIDIA = "whatsapp-media";

// Os helpers do marcador vivem no .shared porque o painel também os usa.
export { extrairCaminhoMidia, marcadorMidia, textoSemMarcadorMidia } from "./midia-conversa.shared";

const EXTENSOES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Descobre o tipo pela assinatura quando o OpenWA não informa o mimetype.
function tipoPelaAssinatura(b64: string): string | null {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  return null;
}

/**
 * Sobe a imagem e devolve o caminho dentro do bucket, ou null se não der.
 * Nunca lança: falhar em guardar a imagem não pode derrubar o recebimento da mensagem.
 */
export async function salvarImagemConversa(opts: {
  companyId: string;
  base64: string;
  mimetype?: string | null;
  numero: string;
}): Promise<string | null> {
  try {
    const bruto = String(opts.base64 || "").trim();
    if (!bruto) return null;
    // Aceita tanto "data:image/jpeg;base64,XXXX" quanto o base64 puro.
    const semPrefixo = bruto.includes(",") && bruto.startsWith("data:") ? bruto.slice(bruto.indexOf(",") + 1) : bruto;
    const doPrefixo = bruto.startsWith("data:") ? bruto.slice(5, bruto.indexOf(";")) : null;
    const mime = opts.mimetype || doPrefixo || tipoPelaAssinatura(semPrefixo);
    if (!mime || !EXTENSOES[mime]) return null;

    const bytes = Buffer.from(semPrefixo, "base64");
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return null;

    const nome = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${EXTENSOES[mime]}`;
    const caminho = `${opts.companyId}/${opts.numero}/${nome}`;

    const { error } = await (supabaseAdmin as any).storage
      .from(BUCKET_MIDIA)
      .upload(caminho, bytes, { contentType: mime, upsert: false });
    if (error) {
      console.error("[midia-conversa] upload falhou:", error.message);
      return null;
    }
    return caminho;
  } catch (e: any) {
    console.error("[midia-conversa]", e?.message);
    return null;
  }
}

/** URL assinada para exibir a imagem no painel. O bucket é privado, então expira. */
export async function assinarMidia(caminho: string, segundos = 3600): Promise<string | null> {
  try {
    const { data, error } = await (supabaseAdmin as any).storage
      .from(BUCKET_MIDIA)
      .createSignedUrl(caminho, segundos);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
