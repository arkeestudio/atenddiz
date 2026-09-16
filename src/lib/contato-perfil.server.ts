// SERVER ONLY. Nome e foto de perfil do contato, direto do WhatsApp.
// A foto do WhatsApp expira, então é renovada de tempos em tempos.
const PERFIL_TTL_MS = 3 * 24 * 60 * 60_000; // 3 dias

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

    const patch: any = { foto_url: perfil?.profilePicUrl || null, foto_em: new Date().toISOString() };
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
