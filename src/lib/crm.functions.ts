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
 * Avisa os sistemas integrados que um lead foi ganho ou perdido.
 *
 * Os eventos `lead.won` e `lead.lost` estavam declarados e anunciados na tela de
 * Integrações desde sempre, mas nunca eram disparados — quem integrasse ficaria
 * esperando para sempre. O disparo mora aqui porque `emitWebhook` assina com HMAC
 * e só pode rodar no servidor.
 */
export const emitirDesfechoLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; tipo: "ganho" | "perda"; motivo?: string | null; detalhe?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const companyId = await resolveCompanyId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emitWebhook } = await import("./webhooks.server");

    const { data: card } = await (supabaseAdmin as any)
      .from("crm_cards")
      .select("id, numero, nome, valor, origem, motivo_perda, motivo_perda_detalhe")
      .eq("company_id", companyId)
      .eq("numero", data.numero)
      .maybeSingle();
    if (!card) return { ok: false };

    await emitWebhook(companyId, data.tipo === "ganho" ? "lead.won" : "lead.lost", {
      id: card.id,
      numero: card.numero,
      nome: card.nome,
      valor: Number(card.valor) || 0,
      origem: card.origem ?? null,
      ...(data.tipo === "perda"
        ? { motivo: data.motivo ?? card.motivo_perda ?? null, detalhe: data.detalhe ?? card.motivo_perda_detalhe ?? null }
        : {}),
    });
    return { ok: true };
  });
