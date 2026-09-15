import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeFichaCampos } from "./ficha-campos";

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

async function nomeDoUsuario(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("profiles").select("nome, email").eq("user_id", userId).maybeSingle();
  return data?.nome || (data?.email ? String(data.email).split("@")[0] : "Equipe");
}

// Pede para a IA reler a conversa e atualizar a ficha agora.
export const atualizarFichaIa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { atualizarFichaComIa } = await import("./ficha-atendimento.server");
    // Usa o client do usuário: a RLS garante que ele só mexe na própria empresa.
    const res = await atualizarFichaComIa({ admin: context.supabase, companyId, numero: data.numero });
    if (!res) throw new Error("Ainda não há conversa suficiente para montar a ficha deste contato.");
    return res;
  });

// Salva a ficha editada pela equipe e registra no histórico o que mudou e quem mudou.
export const salvarFicha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { numero: string; ficha: Record<string, string>; resumo: string; proximoPasso: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    const [{ data: card }, { data: cfg }] = await Promise.all([
      supabase
        .from("crm_cards")
        .select("id, ficha, ficha_resumo, ficha_proximo_passo")
        .eq("company_id", companyId)
        .eq("numero", data.numero)
        .maybeSingle(),
      supabase.from("agent_config").select("ficha_campos").eq("company_id", companyId).maybeSingle(),
    ]);
    if (!card) throw new Error("Contato não encontrado no CRM.");

    const campos = normalizeFichaCampos((cfg as any)?.ficha_campos);
    const antes: Record<string, string> = ((card as any).ficha as any) || {};
    const ficha: Record<string, string> = { ...antes };
    const mudancas: string[] = [];
    for (const c of campos) {
      if (!(c.id in data.ficha)) continue;
      const novo = String(data.ficha[c.id] ?? "").trim().slice(0, 500);
      if (novo !== (antes[c.id] ?? "")) {
        mudancas.push(`${c.label}: "${antes[c.id] ?? ""}" → "${novo}"`);
        if (novo) ficha[c.id] = novo;
        else delete ficha[c.id];
      }
    }
    const resumo = data.resumo.trim().slice(0, 2000);
    const proximoPasso = data.proximoPasso.trim().slice(0, 500);
    if (resumo !== ((card as any).ficha_resumo ?? "")) mudancas.push("Resumo");
    if (proximoPasso !== ((card as any).ficha_proximo_passo ?? "")) mudancas.push("Próximo passo");
    if (!mudancas.length) return { ok: true, changed: false };

    const { error } = await supabase
      .from("crm_cards")
      .update({
        ficha,
        ficha_resumo: resumo || null,
        ficha_proximo_passo: proximoPasso || null,
      } as any)
      .eq("id", (card as any).id);
    if (error) throw new Error(error.message);

    const autor = await nomeDoUsuario(supabase, userId);
    await supabase.from("lead_evento").insert({
      company_id: companyId,
      card_id: (card as any).id,
      tipo: "ficha",
      descricao: `${autor} editou a ficha — ${mudancas.join("; ")}`.slice(0, 2000),
    });
    return { ok: true, changed: true };
  });

// Tira o contato da fila "Aguardando humano".
export const marcarAtendido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { data: card } = await supabase
      .from("crm_cards")
      .select("id, aguardando_humano")
      .eq("company_id", companyId)
      .eq("numero", data.numero)
      .maybeSingle();
    if (!card || !(card as any).aguardando_humano) return { ok: true };
    const { error } = await supabase
      .from("crm_cards")
      .update({ aguardando_humano: false, aguardando_desde: null } as any)
      .eq("id", (card as any).id);
    if (error) throw new Error(error.message);
    const autor = await nomeDoUsuario(supabase, userId);
    await supabase.from("lead_evento").insert({
      company_id: companyId,
      card_id: (card as any).id,
      tipo: "atendido",
      descricao: `${autor} assumiu o atendimento`,
    });
    return { ok: true };
  });
