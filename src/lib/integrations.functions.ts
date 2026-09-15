import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from("company_user").select("company_id").eq("user_id", userId).eq("ativo", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!data) throw new Error("Sem empresa.");
  return data.company_id as string;
}

// ---------- Webhooks ----------
export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const { data } = await context.supabase.from("webhook_endpoint").select("*").eq("company_id", cid).order("created_at", { ascending: false });
    return data ?? [];
  });

export const saveWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; nome: string; url: string; eventos: string[]; ativo: boolean }) => d)
  .handler(async ({ context, data }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    if (!/^https?:\/\//.test(data.url)) throw new Error("URL deve começar com http(s)://");
    const payload = { company_id: cid, nome: data.nome, url: data.url, eventos: data.eventos, ativo: data.ativo };
    if (data.id) {
      const { error } = await context.supabase.from("webhook_endpoint").update(payload).eq("id", data.id).eq("company_id", cid);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("webhook_endpoint").insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const { error } = await context.supabase.from("webhook_endpoint").delete().eq("id", data.id).eq("company_id", cid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listWebhookLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const { data } = await context.supabase.from("webhook_delivery_log").select("*").eq("company_id", cid).order("created_at", { ascending: false }).limit(50);
    return data ?? [];
  });

// ---------- API tokens ----------
export const listApiTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const { data } = await context.supabase.from("api_token").select("*").eq("company_id", cid).order("created_at", { ascending: false });
    return data ?? [];
  });

export const createApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { label: string }) => d)
  .handler(async ({ context, data }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    // Gating: apenas Business
    const { data: sub } = await context.supabase
      .from("subscription").select("plan:plan(slug)")
      .eq("company_id", cid).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const slug = (sub as any)?.plan?.slug ?? "starter";
    if (slug !== "business") throw new Error("API pública não está liberada nesta conta.");
    const { data: row, error } = await context.supabase
      .from("api_token").insert({ company_id: cid, label: data.label, criado_por: context.userId })
      .select("*").maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Falha.");
    return row;
  });

export const revokeApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const cid = await resolveCompanyId(context.supabase, context.userId);
    const { error } = await context.supabase.from("api_token").update({ revogado: true }).eq("id", data.id).eq("company_id", cid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
