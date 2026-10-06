import { createHmac } from "node:crypto";

export function signState(payload: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
  const sig = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 16);
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { companyId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
  const expected = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 16);
  if (sig !== expected) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!obj.companyId) return null;
    return { companyId: obj.companyId as string };
  } catch {
    return null;
  }
}

// Access token válido da empresa, renovando pelo refresh_token se estiver vencendo.
async function tokenDeAcesso(admin: any, gi: any): Promise<string> {
  let accessToken = gi.access_token as string;
  if (gi.expiry && new Date(gi.expiry).getTime() < Date.now() + 60_000 && gi.refresh_token) {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: gi.refresh_token as string,
        grant_type: "refresh_token",
      }),
    });
    const tok = await tokRes.json();
    if (tok.access_token) {
      accessToken = tok.access_token;
      await admin.from("google_integration").update({
        access_token: accessToken,
        expiry: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      }).eq("company_id", gi.company_id);
    }
  }
  return accessToken;
}

/**
 * Intervalos já ocupados na agenda da empresa entre duas datas (freeBusy do Google).
 * É o que impede a IA de oferecer, e o sistema de marcar, horário em cima de outro.
 */
export async function listarOcupados(
  admin: any,
  companyId: string,
  inicioIso: string,
  fimIso: string,
): Promise<Array<{ inicio: string; fim: string }>> {
  const { data: gi } = await admin.from("google_integration").select("*").eq("company_id", companyId).maybeSingle();
  if (!gi?.conectado) return [];
  const accessToken = await tokenDeAcesso(admin, gi);
  const calendarId = gi.calendar_id || "primary";
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: inicioIso, timeMax: fimIso, timeZone: "America/Sao_Paulo", items: [{ id: calendarId }] }),
  });
  if (!res.ok) throw new Error(`Google freeBusy: ${res.status}`);
  const json = await res.json();
  const calendars: Record<string, { busy?: Array<{ start: string; end: string }> }> = json?.calendars ?? {};
  const busy = calendars[calendarId]?.busy ?? Object.values(calendars)[0]?.busy ?? [];
  return busy.map((b) => ({ inicio: b.start, fim: b.end }));
}

/** Altera horário/título de um evento já criado por nós. Lança se a Google recusar. */
export async function atualizarEventoGoogle(
  admin: any,
  companyId: string,
  eventId: string,
  data: { titulo: string; inicio: string; fim: string },
) {
  const { data: gi } = await admin.from("google_integration").select("*").eq("company_id", companyId).maybeSingle();
  if (!gi?.conectado) throw new Error("Google Agenda não conectado");
  const accessToken = await tokenDeAcesso(admin, gi);
  const calendarId = gi.calendar_id || "primary";
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ summary: data.titulo, start: { dateTime: data.inicio }, end: { dateTime: data.fim } }),
    },
  );
  if (!res.ok) throw new Error(`Google API: ${res.status}`);
}

/** Remove um evento criado por nós. 404/410 (já não existe) conta como sucesso. */
export async function excluirEventoGoogle(admin: any, companyId: string, eventId: string) {
  const { data: gi } = await admin.from("google_integration").select("*").eq("company_id", companyId).maybeSingle();
  if (!gi?.conectado) throw new Error("Google Agenda não conectado");
  const accessToken = await tokenDeAcesso(admin, gi);
  const calendarId = gi.calendar_id || "primary";
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google API: ${res.status}`);
}

// Cria evento no Google Agenda usando os tokens armazenados da empresa.
// Refresca o access_token se expirou. Insere também na tabela agendamento.
export async function createCalendarEventForCompany(
  admin: any,
  companyId: string,
  data: { titulo: string; inicio: string; fim: string; descricao?: string; cardId?: string | null },
) {
  const { data: gi } = await admin.from("google_integration").select("*").eq("company_id", companyId).maybeSingle();
  if (!gi?.conectado) throw new Error("Google Agenda não conectado");
  const accessToken = await tokenDeAcesso(admin, gi);

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

  await admin.from("agendamento").insert({
    company_id: companyId,
    card_id: data.cardId ?? null,
    titulo: data.titulo,
    inicio: data.inicio,
    fim: data.fim,
    google_event_id: ev.id,
    status: "agendado",
  });
  return { eventId: ev.id };
}
