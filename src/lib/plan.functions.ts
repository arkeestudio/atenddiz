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
  if (!data) throw new Error("Sem empresa.");
  return data.company_id as string;
}

export const getPlanUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { getCompanyPlanUsage } = await import("./plan-limits.server");
    return getCompanyPlanUsage(companyId);
  });

export const createContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; nome?: string | null }) => {
    const numero = String(d.numero || "").replace(/\D/g, "");
    if (numero.length < 8) throw new Error("Número inválido.");
    return { numero, nome: (d.nome ?? "").toString().trim() || null };
  })
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { assertWithinLimit } = await import("./plan-limits.server");

    // se já existe um card com esse número não conta como novo
    const { data: existing } = await context.supabase
      .from("crm_cards")
      .select("id")
      .eq("company_id", companyId)
      .eq("numero", data.numero)
      .maybeSingle();
    if (!existing) await assertWithinLimit(companyId, "contatos");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: firstStage } = await supabaseAdmin
      .from("crm_stage")
      .select("id, nome")
      .eq("company_id", companyId)
      .order("ordem", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("crm_cards").upsert(
      {
        company_id: companyId,
        user_id: context.userId,
        numero: data.numero,
        nome: data.nome,
        status: firstStage?.nome ?? "Conversas",
        stage_id: firstStage?.id ?? null,
        origem: "Manual",
        ultima_em: new Date().toISOString(),
      },
      { onConflict: "company_id,numero" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const importContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { contatos: Array<{ numero: string; nome?: string | null }> }) => {
    const list = Array.isArray(d.contatos) ? d.contatos : [];
    const clean = list
      .map((c) => ({ numero: String(c.numero || "").replace(/\D/g, ""), nome: (c.nome ?? "")?.toString().trim() || null }))
      .filter((c) => c.numero.length >= 8);
    return { contatos: clean };
  })
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getCompanyPlanUsage } = await import("./plan-limits.server");

    const numeros = data.contatos.map((c) => c.numero);
    let existingNumeros = new Set<string>();
    if (numeros.length) {
      const { data: ex } = await supabaseAdmin
        .from("crm_cards")
        .select("numero")
        .eq("company_id", companyId)
        .in("numero", numeros);
      existingNumeros = new Set((ex ?? []).map((r: any) => r.numero));
    }
    const novos = data.contatos.filter((c) => !existingNumeros.has(c.numero));

    if (novos.length > 0) {
      const { plan, usage } = await getCompanyPlanUsage(companyId);
      if (usage.contatos + novos.length > plan.limites.contatos) {
        const restante = Math.max(0, plan.limites.contatos - usage.contatos);
        throw new Error(
          `Importação excede o limite do plano ${plan.nome} (${plan.limites.contatos.toLocaleString("pt-BR")} contatos). Você ainda pode adicionar ${restante.toLocaleString("pt-BR")}.`,
        );
      }
    }

    const { data: firstStage } = await supabaseAdmin
      .from("crm_stage")
      .select("id, nome")
      .eq("company_id", companyId)
      .order("ordem", { ascending: true })
      .limit(1)
      .maybeSingle();

    const payload = data.contatos.map((c) => ({
      company_id: companyId,
      user_id: context.userId,
      numero: c.numero,
      nome: c.nome,
      status: firstStage?.nome ?? "Conversas",
      stage_id: firstStage?.id ?? null,
      origem: "Importação",
      ultima_em: new Date().toISOString(),
    }));
    if (payload.length === 0) return { ok: true, inseridos: 0 };

    const { error } = await supabaseAdmin
      .from("crm_cards")
      .upsert(payload, { onConflict: "company_id,numero" });
    if (error) throw new Error(error.message);
    return { ok: true, inseridos: novos.length };
  });
