// Pausas da equipe (almoço) em que não se marca visita. A IA lê a lista no prompt e o
// guarda-corpo da agenda confere de novo na hora de marcar — a escola tinha instruído a IA a
// "nunca recusar horário", e só texto não segura. Horas comparadas no fuso de Brasília.
import type { BusinessHours, PausaVisita } from "./business-hours";

const TZ = "America/Sao_Paulo";

function minutosDoDia(d: Date, tz = TZ): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function hhmm(s: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

const normaliza = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pausas válidas (com hora de início e fim legíveis). */
export function pausasDe(h: Pick<BusinessHours, "visitas"> | null | undefined): PausaVisita[] {
  return (h?.visitas?.pausas ?? []).filter((p) => p && hhmm(p.de) != null && hhmm(p.ate) != null && hhmm(p.ate)! > hhmm(p.de)!);
}

/**
 * A pausa que a visita [inicio, fim) invade, ou null. `contexto` é o texto que diz a unidade
 * (título do marcador + ficha). Pausa de uma unidade só vale se o contexto citar essa unidade;
 * se ele não citar unidade nenhuma, todas valem — na dúvida, protege o almoço.
 */
export function pausaInvadida(
  inicio: Date,
  fim: Date,
  h: Pick<BusinessHours, "visitas"> | null | undefined,
  contexto = "",
): PausaVisita | null {
  const pausas = pausasDe(h);
  if (!pausas.length) return null;
  const ctx = normaliza(contexto);
  const unidades = pausas.map((p) => p.unidade?.trim()).filter(Boolean) as string[];
  const citaAlguma = unidades.some((u) => ctx.includes(normaliza(u)));
  const i = minutosDoDia(inicio);
  const f = minutosDoDia(fim);
  const fimMin = f > i ? f : 24 * 60;
  for (const p of pausas) {
    const unidade = p.unidade?.trim();
    if (unidade && citaAlguma && !ctx.includes(normaliza(unidade))) continue;
    if (i < hhmm(p.ate)! && fimMin > hhmm(p.de)!) return p;
  }
  return null;
}

/** "entre 12:00 e 13:00 a equipe está em pausa para almoço na unidade Centro" */
export function descreverPausa(p: PausaVisita): string {
  const motivo = p.motivo?.trim();
  const unidade = p.unidade?.trim();
  return `entre ${p.de} e ${p.ate} a equipe está em pausa${motivo ? ` para ${motivo.toLowerCase()}` : ""}${unidade ? ` na unidade ${unidade}` : ""}`;
}
