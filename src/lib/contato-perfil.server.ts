// SERVER ONLY. Nome e foto de perfil do contato, direto do WhatsApp.
//
// O link que o WhatsApp devolve é temporário: em poucas horas ele morre e o painel
// volta a mostrar só as iniciais. Por isso a foto é baixada e guardada no nosso bucket,
// como já é feito com as imagens da conversa. O que fica no card é um link assinado
// nosso, renovado a cada sincronização.
const PERFIL_TTL_MS = 3 * 24 * 60 * 60_000; // 3 dias
// Folga grande de propósito: contato que fica meses sem falar continua com foto no painel.
const FOTO_URL_TTL_S = 365 * 24 * 60 * 60;
const MAX_FOTO_BYTES = 5 * 1024 * 1024;

/** Baixa a foto do WhatsApp e guarda no bucket. Devolve link nosso, ou null se não der. */
async function guardarFoto(companyId: string, numero: string, url: string): Promise<string | null> {
  try {
    const { BUCKET_MIDIA, assinarMidia } = await import("./midia-conversa.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const res = await fetch(url);
    if (!res.ok) return null;
    const tipo = res.headers.get("content-type") || "image/jpeg";
    if (!tipo.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_FOTO_BYTES) return null;

    // Caminho fixo por contato: a foto nova substitui a antiga em vez de acumular lixo.
    const caminho = `${companyId}/perfil/${numero.replace(/\D/g, "")}.jpg`;
    const { error } = await (supabaseAdmin as any).storage
      .from(BUCKET_MIDIA)
      .upload(caminho, bytes, { contentType: tipo, upsert: true });
    if (error) {
      console.warn("[perfil-contato] upload da foto falhou:", error.message);
      return null;
    }
    return await assinarMidia(caminho, FOTO_URL_TTL_S);
  } catch (e: any) {
    console.warn("[perfil-contato] não foi possível baixar a foto:", e?.message);
    return null;
  }
}

export async function sincronizarPerfilContato(opts: {
  admin: any;
  companyId: string;
  instanceName: string;
  numero: string;
}) {
  const { admin, companyId, instanceName, numero } = opts;
  try {
    const { data: card } = await admin
      .from("crm_cards")
      .select("id, nome, foto_em")
      .eq("company_id", companyId)
      .eq("numero", numero)
      .maybeSingle();
    if (!card) return;
    const last = card.foto_em ? new Date(card.foto_em).getTime() : 0;
    if (Date.now() - last < PERFIL_TTL_MS) return;

    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();
    if (!provider.getProfile) return;
    const perfil = await provider.getProfile(companyId, instanceName, numero);

    // Sem foto nova, não apaga a que já está no card: pode ser só falha momentânea
    // do WhatsApp, e é melhor uma foto antiga do que o contato perder o rosto.
    const doWhats = perfil?.profilePicUrl || null;
    const nossa = doWhats ? await guardarFoto(companyId, numero, doWhats) : null;
    const patch: any = { foto_em: new Date().toISOString() };
    if (nossa) patch.foto_url = nossa;
    else if (doWhats) patch.foto_url = doWhats; // pelo menos aparece enquanto o link durar
    if (perfil?.name?.trim()) {
      patch.nome_whatsapp = perfil.name.trim();
      // Só preenche o nome visível se ainda for o número (equipe pode ter renomeado).
      const generico = !card.nome || card.nome === numero || /^\d+$/.test(String(card.nome).replace(/\D/g, ""));
      if (generico) patch.nome = perfil.name.trim();
    }
    const { error } = await admin.from("crm_cards").update(patch).eq("id", card.id);
    if (error) console.warn("[perfil-contato] não foi possível salvar:", error.message);
  } catch (e: any) {
    console.warn("[perfil-contato]", e?.message);
  }
}
