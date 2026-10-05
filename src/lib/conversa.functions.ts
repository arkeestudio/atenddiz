import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("company_user")
    .select("company_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Você ainda não possui uma empresa.");
  return data.company_id as string;
}

/**
 * Apaga tudo o que o sistema sabe sobre UM contato, para testar a IA do zero.
 *
 * Sem isso, cada teste de tom carrega o histórico e a ficha do teste anterior — a IA
 * responde diferente porque já "conhece" a pessoa, e nunca dá para ver como ela recebe
 * um lead novo de verdade. Depois de reiniciar, a próxima mensagem daquele número entra
 * como primeiro contato.
 *
 * Apaga: mensagens, card do CRM (leva junto ficha, notas e eventos por cascade),
 * pausa de atendimento humano e as imagens que o contato mandou.
 * Não toca na configuração da IA nem em nenhum outro contato.
 */
// Duas ações com propósitos diferentes, mesmo miolo:
// - "recomecar": zera a conversa (mensagens, mídia, ficha, pausa, visitas) e a IA trata o
//   contato como novo — mas o CADASTRO fica (nome, telefone, tags, origem, histórico de
//   eventos). Para teste ou para "começar do zero com esta família".
// - "excluir": remove o contato do sistema. Some da lista, do Kanban e da planilha. Para
//   spam, número errado, teste que não deve existir.
async function apagarConversa(
  context: { supabase: any; userId: string },
  numeroBruto: string,
  modo: "recomecar" | "excluir",
) {
  const companyId = await resolveCompanyId(context.supabase, context.userId);
  await exigirAdmin(context.supabase, context.userId, companyId);
  const numero = String(numeroBruto || "").trim();
  if (!numero) throw new Error("Número não informado.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { extrairCaminhoMidia } = await import("./midia-conversa.shared");
  const admin = supabaseAdmin as any;

  // Recolhe as imagens antes de apagar as mensagens, senão o caminho se perde e os
  // arquivos ficam órfãos no bucket a cada rodada de teste.
  const { data: msgs } = await admin.from("mensagens").select("texto").eq("company_id", companyId).eq("numero", numero);
  const arquivos = ((msgs ?? []) as any[])
    .map((m) => extrairCaminhoMidia(String(m.texto ?? "")))
    .filter((c): c is string => !!c);
  const apagadas = (msgs ?? []).length;

  const { data: card } = await admin.from("crm_cards").select("id").eq("company_id", companyId).eq("numero", numero).maybeSingle();

  await admin.from("mensagens").delete().eq("company_id", companyId).eq("numero", numero);
  await admin.from("contact_pause").delete().eq("company_id", companyId).eq("numero", numero);
  if (card?.id) await admin.from("agendamento").delete().eq("company_id", companyId).eq("card_id", card.id);

  if (modo === "excluir") {
    // O card leva ficha, notas e eventos junto (ON DELETE CASCADE).
    await admin.from("crm_cards").delete().eq("company_id", companyId).eq("numero", numero);
  } else if (card?.id) {
    // Volta para a primeira etapa do funil, ficha vazia, sem fila nem próxima ação.
    const { data: primeira } = await admin
      .from("crm_stage").select("id, nome").eq("company_id", companyId).order("ordem", { ascending: true }).limit(1).maybeSingle();
    await admin
      .from("crm_cards")
      .update({
        ficha: {}, ficha_resumo: null, ficha_proximo_passo: null, ficha_atualizada_em: null,
        aguardando_humano: false, aguardando_desde: null, transferencia_motivo: null,
        proxima_acao: null, follow_up: null, ultima_mensagem: null,
        ...(primeira ? { stage_id: primeira.id, status: primeira.nome } : {}),
      })
      .eq("id", card.id);
    await admin.from("lead_evento").insert({
      company_id: companyId, card_id: card.id, tipo: "conversa_recomecada",
      descricao: `Conversa recomeçada pela equipe: ${apagadas} mensagens apagadas, ficha zerada`,
    });
  }

  if (arquivos.length) {
    try {
      const { BUCKET_MIDIA } = await import("./midia-conversa.server");
      await admin.storage.from(BUCKET_MIDIA).remove(arquivos);
    } catch (e: any) {
      // Arquivo órfão é chato, não é erro: a conversa já foi apagada.
      console.warn("[apagarConversa] não deu para apagar a mídia:", e?.message);
    }
  }

  return { ok: true, mensagens: apagadas, arquivos: arquivos.length };
}

export const reiniciarConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(({ context, data }) => apagarConversa(context, data.numero, "recomecar"));

export const excluirConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(({ context, data }) => apagarConversa(context, data.numero, "excluir"));

// Apagar é coisa de dono/admin: atendente não zera o histórico da escola por engano.
async function exigirAdmin(supabase: any, userId: string, companyId: string) {
  const { data } = await supabase
    .from("company_user")
    .select("role")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  const role = data?.role;
  if (role !== "owner" && role !== "admin") {
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "super_admin")) {
      throw new Error("Só dono ou admin pode apagar conversas.");
    }
  }
}

/**
 * Zera o atendimento da empresa inteira: mensagens, leads (com ficha, notas e eventos),
 * visitas, pausas e os arquivos de mídia. Configuração da IA, funil e equipe ficam.
 *
 * Existe para a virada de testes para produção — sem isso a escola dependia de SQL.
 * Só dono/admin, e a tela ainda pede para digitar APAGAR.
 */
export const limparConversas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { confirmacao: string }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    await exigirAdmin(context.supabase, context.userId, companyId);
    if (data.confirmacao !== "APAGAR") throw new Error("Confirmação inválida.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const [{ count: mensagens }, { count: leads }] = await Promise.all([
      admin.from("mensagens").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      admin.from("crm_cards").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ]);

    await admin.from("mensagens").delete().eq("company_id", companyId);
    await admin.from("agendamento").delete().eq("company_id", companyId);
    await admin.from("contact_pause").delete().eq("company_id", companyId);
    // Leva ficha, notas e eventos junto (ON DELETE CASCADE).
    await admin.from("crm_cards").delete().eq("company_id", companyId);

    // Mídia: o bucket guarda <empresa>/<numero>/arquivo e <empresa>/perfil/arquivo.
    // Dois níveis bastam; falhar aqui não desfaz a limpeza, só deixa arquivo órfão.
    let arquivos = 0;
    try {
      const { BUCKET_MIDIA } = await import("./midia-conversa.server");
      const bucket = admin.storage.from(BUCKET_MIDIA);
      const { data: pastas } = await bucket.list(companyId, { limit: 1000 });
      for (const pasta of pastas ?? []) {
        const { data: itens } = await bucket.list(`${companyId}/${pasta.name}`, { limit: 1000 });
        const caminhos = (itens ?? []).filter((i: any) => i.id).map((i: any) => `${companyId}/${pasta.name}/${i.name}`);
        if (caminhos.length) {
          await bucket.remove(caminhos);
          arquivos += caminhos.length;
        }
      }
    } catch (e: any) {
      console.warn("[limparConversas] mídia não apagada por completo:", e?.message);
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit({
      companyId,
      userId: context.userId,
      acao: "limpar_conversas",
      recurso: "conversas",
      detalhes: { mensagens: mensagens ?? 0, leads: leads ?? 0, arquivos },
    });

    return { ok: true, mensagens: mensagens ?? 0, leads: leads ?? 0, arquivos };
  });
