import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("company_user").select("company_id").eq("user_id", userId).eq("ativo", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!data) throw new Error("Sem empresa.");
  return data.company_id as string;
}

async function appOrigin(): Promise<string> {
  const { getRequestOrigin } = await import("@/lib/request-utils.server");
  return getRequestOrigin();
}

export const sendCsat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; contatoNome?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const numero = String(data.numero).replace(/\D/g, "");
    if (!numero) throw new Error("Número inválido.");

    const { data: row, error } = await supabase
      .from("csat_response")
      .insert({ company_id: companyId, numero, contato_nome: data.contatoNome ?? null, enviado_por: userId })
      .select("token")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Falha ao registrar CSAT.");

    const { data: inst } = await supabase.from("whatsapp_instances").select("instance_name,status").eq("company_id", companyId).maybeSingle();
    if (inst && (inst.status === "open" || inst.status === "connected")) {
      const link = `${await appOrigin()}/csat/${row.token}`;
      const texto = `Olá! Como foi nosso atendimento? Avalie em 1 minuto: ${link}`;
      try {
        const { getWhatsAppProvider } = await import("./whatsapp-provider");
        const provider = getWhatsAppProvider();
        await provider.sendText(companyId, inst.instance_name, numero, texto);
        await supabase.from("mensagens").insert({
          company_id: companyId, user_id: userId, numero, contato_nome: data.contatoNome ?? null,
          direcao: "saida", autor: "sistema", texto,
        });
      } catch (e: any) {
        console.warn("[csat send]", e);
      }
    }
    return { ok: true, token: row.token };
  });

export const submitCsat = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; score: number; comentario?: string }) => d)
  .handler(async ({ data }) => {
    if (!data.token || data.score < 1 || data.score > 5) throw new Error("Dados inválidos.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any).from("csat_response").select("id, respondido_em").eq("token", data.token).maybeSingle();
    if (!row) throw new Error("Pesquisa não encontrada.");
    if (row.respondido_em) throw new Error("Pesquisa já respondida.");
    const { error } = await (supabaseAdmin as any).from("csat_response").update({
      score: data.score, comentario: data.comentario ?? null, respondido_em: new Date().toISOString(),
    }).eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCsatByToken = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("csat_response")
      .select("token, respondido_em, company_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { found: false as const };
    const { data: comp } = await (supabaseAdmin as any).from("company").select("nome, primary_color").eq("id", row.company_id).maybeSingle();
    return { found: true as const, respondido: !!row.respondido_em, empresa: comp?.nome ?? "", primaryColor: comp?.primary_color ?? "#22C55E" };
  });
