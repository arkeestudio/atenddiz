// SERVER ONLY. Usa supabaseAdmin para resolver plano + uso, sem expor chave.
import { PLAN_LABEL, normalizePlanSlug, type PlanSlug } from "./plan-features";

export type LimitKind = "instancias" | "usuarios" | "contatos" | "mensagens";

export type CompanyPlan = {
  slug: PlanSlug;
  nome: string;
  limites: {
    instancias: number;
    usuarios: number;
    contatos: number;
    mensagens: number;
  };
};

export type CompanyUsage = {
  instancias: number;
  usuarios: number;
  contatos: number;
  mensagens: number; // mês corrente
};

function startOfMonthISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function getCompanyPlan(companyId: string): Promise<CompanyPlan> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) Assinatura ativa/trialing → plano vinculado
  const { data: sub } = await supabaseAdmin
    .from("subscription")
    .select("plan_id, status, plan:plan(slug, nome, limite_instancias, limite_mensagens, limite_usuarios, limite_contatos)")
    .eq("company_id", companyId)
    .in("status", ["active", "trialing", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let row: any = sub?.plan ?? null;

  // 2) Fallback: plano starter ativo
  if (!row) {
    const { data: fallback } = await supabaseAdmin
      .from("plan")
      .select("slug, nome, limite_instancias, limite_mensagens, limite_usuarios, limite_contatos")
      .eq("slug", "starter")
      .maybeSingle();
    row = fallback;
  }

  const slug = normalizePlanSlug(row?.slug);
  return {
    slug,
    nome: row?.nome || PLAN_LABEL[slug],
    limites: {
      instancias: 1,
      usuarios: Number(row?.limite_usuarios ?? 1),
      contatos: Number(row?.limite_contatos ?? 1000),
      mensagens: Number(row?.limite_mensagens ?? 1500),
    },
  };
}

export async function getCompanyUsage(companyId: string): Promise<CompanyUsage> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const monthStart = startOfMonthISO();

  const [inst, users, contatos, msgs] = await Promise.all([
    supabaseAdmin.from("whatsapp_instances").select("instance_name", { count: "exact", head: true }).eq("company_id", companyId),
    supabaseAdmin.from("company_user").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("ativo", true),
    supabaseAdmin.from("crm_cards").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabaseAdmin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("direcao", "saida")
      .gte("created_at", monthStart),
  ]);

  return {
    instancias: inst.count ?? 0,
    usuarios: users.count ?? 0,
    contatos: contatos.count ?? 0,
    mensagens: msgs.count ?? 0,
  };
}

export async function getCompanyPlanUsage(companyId: string): Promise<{ plan: CompanyPlan; usage: CompanyUsage }> {
  const [plan, usage] = await Promise.all([getCompanyPlan(companyId), getCompanyUsage(companyId)]);
  return { plan, usage };
}

const LIMIT_MSG: Record<LimitKind, (planName: string, lim: number) => string> = {
  instancias: (_p, n) =>
    `Limite da conta: até ${n} número${n === 1 ? "" : "s"} de WhatsApp conectado${n === 1 ? "" : "s"}.`,
  usuarios: (_p, n) =>
    `Limite da conta: até ${n} usuário${n === 1 ? "" : "s"} na equipe.`,
  contatos: (_p, n) =>
    `Limite da conta: até ${n.toLocaleString("pt-BR")} contatos.`,
  mensagens: (_p, n) =>
    `Limite da conta: até ${n.toLocaleString("pt-BR")} mensagens enviadas por mês.`,
};

export async function assertWithinLimit(companyId: string, tipo: LimitKind, delta = 1): Promise<void> {
  const [plan, usage] = await Promise.all([getCompanyPlan(companyId), getCompanyUsage(companyId)]);
  const limite = plan.limites[tipo];
  const atual = usage[tipo];
  if (atual + delta > limite) {
    throw new Error(LIMIT_MSG[tipo](plan.nome, limite));
  }
}

// Sem disparar erro — útil em hot paths (webhook IA) que só pulam a ação.
export async function isWithinLimit(companyId: string, tipo: LimitKind, delta = 1): Promise<boolean> {
  const [plan, usage] = await Promise.all([getCompanyPlan(companyId), getCompanyUsage(companyId)]);
  return usage[tipo] + delta <= plan.limites[tipo];
}
