// API pública /api/public/v1/* — autenticação via Bearer token (tabela api_token)
import { createFileRoute } from "@tanstack/react-router";

async function authToken(request: Request): Promise<{ companyId: string; userId: string | null } | null> {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(azp_[a-z0-9]+)$/i);
  if (!m) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("api_token").select("id, company_id, criado_por, revogado").eq("token", m[1]).maybeSingle();
  if (!data || data.revogado) return null;
  await (supabaseAdmin as any).from("api_token").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", data.id);
  return { companyId: data.company_id as string, userId: data.criado_por as string | null };
}

async function handle(request: Request) {
  const auth = await authToken(request);
  if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const { companyId, userId } = auth;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "contacts";

  if (request.method === "GET") {
    if (resource === "contacts") {
      const { data } = await (supabaseAdmin as any).from("crm_cards")
        .select("id, numero, contato_nome:nome, tags, stage_id, valor, utm_source, utm_medium, utm_campaign, created_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(200);
      return Response.json({ data: data ?? [] });
    }
    if (resource === "messages") {
      const numero = url.searchParams.get("numero") || "";
      let q = (supabaseAdmin as any).from("mensagens")
        .select("id, numero, direcao, autor, texto, created_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(100);
      if (numero) q = q.eq("numero", numero);
      const { data } = await q;
      return Response.json({ data: data ?? [] });
    }
    return new Response(JSON.stringify({ error: "Unknown resource" }), { status: 400 });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({})) as any;
    if (resource === "messages") {
      const numero = String(body.numero || "").replace(/\D/g, "");
      const texto = String(body.texto || "");
      if (!numero || !texto) return new Response(JSON.stringify({ error: "numero e texto obrigatórios" }), { status: 400 });
      const { data: inst } = await (supabaseAdmin as any).from("whatsapp_instances")
        .select("instance_name, status").eq("company_id", companyId).maybeSingle();
      if (!inst || (inst.status !== "open" && inst.status !== "connected")) return new Response(JSON.stringify({ error: "WhatsApp não conectado" }), { status: 400 });
      if (!userId) return new Response(JSON.stringify({ error: "Token sem owner; recrie o token." }), { status: 400 });
      try {
        const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");
        const provider = getWhatsAppProvider();
        await provider.sendText(companyId, inst.instance_name, numero, texto);
        await (supabaseAdmin as any).from("mensagens").insert({
          company_id: companyId, user_id: userId, numero, direcao: "saida", autor: "api", texto,
        });
        return Response.json({ ok: true });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
      }
    }
    return new Response(JSON.stringify({ error: "Unknown resource" }), { status: 400 });
  }

  return new Response("Method Not Allowed", { status: 405 });
}

export const Route = createFileRoute("/api/public/v1/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
