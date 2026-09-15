import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function buildOrigin() {
  const { getRequestOrigin } = await import("@/lib/request-utils.server");
  return getRequestOrigin();
}


export const startGoogleOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
      return { ok: false as const, error: "Google OAuth não configurado. Peça ao administrador para definir GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET." };
    }
    const { supabase, userId } = context;
    const { data: cu } = await supabase
      .from("company_user").select("company_id").eq("user_id", userId).eq("ativo", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!cu) return { ok: false as const, error: "Sem empresa." };

    const { getCompanyPlan } = await import("@/lib/plan-limits.server");
    const { featuresFor } = await import("@/lib/plan-features");
    const plan = await getCompanyPlan(cu.company_id);
    if (!featuresFor(plan.slug).googleCalendar) {
      return { ok: false as const, error: "Google Agenda não está liberado nesta conta." };
    }

    const origin = await buildOrigin();
    const redirectUri = `${origin}/api/public/google-callback`;
    const payload = Buffer.from(JSON.stringify({ companyId: cu.company_id, t: Date.now() })).toString("base64url");
    const { signState } = await import("@/lib/google.server");
    const state = signState(payload);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email");
    url.searchParams.set("state", state);
    return { ok: true as const, url: url.toString() };
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: cu } = await supabase
      .from("company_user").select("company_id,role").eq("user_id", userId).eq("ativo", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!cu || !["owner", "admin"].includes(cu.role)) return { ok: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("google_integration").upsert(
      { company_id: cu.company_id, conectado: false, access_token: null, refresh_token: null, expiry: null, email: null, calendar_id: null },
      { onConflict: "company_id" },
    );
    return { ok: true };
  });

export const createGoogleCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { titulo: string; inicio: string; fim: string; cardId?: string | null; descricao?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: cu } = await supabase
      .from("company_user").select("company_id").eq("user_id", userId).eq("ativo", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!cu) throw new Error("Sem empresa");
    const companyId = cu.company_id;

    // Tokens are not readable via authenticated RLS — use admin client server-side
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: gi } = await supabaseAdmin.from("google_integration").select("*").eq("company_id", companyId).maybeSingle();
    if (!gi?.conectado) throw new Error("Google Agenda não conectado");

    // Refresh if needed
    let accessToken = gi.access_token as string;
    if (gi.expiry && new Date(gi.expiry).getTime() < Date.now() + 60_000 && gi.refresh_token) {
      const tokRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: gi.refresh_token as string,
          grant_type: "refresh_token",
        }),
      });
      const tok = await tokRes.json();
      if (tok.access_token) {
        accessToken = tok.access_token;
        await supabaseAdmin.from("google_integration").update({
          access_token: accessToken,
          expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
        }).eq("company_id", companyId);
      }
    }

    const calendarId = gi.calendar_id || "primary";
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: data.titulo,
        description: data.descricao || "",
        start: { dateTime: data.inicio },
        end: { dateTime: data.fim },
      }),
    });
    if (!res.ok) throw new Error(`Google API: ${res.status}`);
    const ev = await res.json();

    await supabase.from("agendamento").insert({
      company_id: companyId,
      card_id: data.cardId ?? null,
      titulo: data.titulo,
      inicio: data.inicio,
      fim: data.fim,
      google_event_id: ev.id,
      status: "agendado",
    });
    return { ok: true, eventId: ev.id };
  });
