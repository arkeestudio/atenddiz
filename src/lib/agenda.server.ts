// SERVER ONLY. Guarda-corpo entre o que a IA escreve no marcador [AGENDAR: ...] e o que
// vira evento na agenda da empresa.
//
// Antes, o marcador ia direto para o Google Agenda: a IA podia marcar em cima de outra
// visita, numa data que já passou ou duas vezes a mesma. Quem decide se um horário vale
// é o código, lendo a agenda — a IA só propõe.
import type { AgendarBrief } from "./ai-prompt";

const TZ = "America/Sao_Paulo";
// Antes disso é agenda cheia demais para prometer; depois disso é erro de digitação da IA.
const MAX_DIAS_FRENTE = 90;
const MAX_DURACAO_MS = 8 * 60 * 60_000;
// Quantos dias de ocupação vão para o prompt. Mais que isso vira parede de texto.
export const DIAS_OCUPADOS_NO_PROMPT = 14;

export type Validado =
  | { ok: true; inicio: Date; fim: Date }
  | { ok: false; motivo: string };

// "2026-02-31" não existe, mas new Date() aceita e vira 3 de março sem reclamar. Confere o
// dia escrito contra o calendário antes de qualquer outra coisa.
function diaExiste(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const [, a, mes, d] = m.map(Number);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

export function validarAgendamento(a: AgendarBrief, agora = new Date()): Validado {
  if (!diaExiste(a.inicio)) return { ok: false, motivo: "essa data não existe no calendário" };
  const inicio = new Date(a.inicio);
  const fim = new Date(a.fim);
  if (Number.isNaN(+inicio) || Number.isNaN(+fim)) return { ok: false, motivo: "a data não foi entendida" };
  if (fim <= inicio) return { ok: false, motivo: "o horário de término vem antes do início" };
  if (fim.getTime() - inicio.getTime() > MAX_DURACAO_MS) return { ok: false, motivo: "a duração passou de 8 horas" };
  // 5 min de folga: o cliente confirma "agora às 10h" quando já são 10h02.
  if (inicio.getTime() < agora.getTime() - 5 * 60_000) return { ok: false, motivo: "esse horário já passou" };
  if (inicio.getTime() > agora.getTime() + MAX_DIAS_FRENTE * 86_400_000) {
    return { ok: false, motivo: `só marcamos até ${MAX_DIAS_FRENTE} dias à frente` };
  }
  return { ok: true, inicio, fim };
}

export function conflita(
  ocupados: Array<{ inicio: string; fim: string }>,
  inicio: Date,
  fim: Date,
): boolean {
  return ocupados.some((o) => new Date(o.inicio) < fim && new Date(o.fim) > inicio);
}

const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Uma linha por intervalo ocupado, no fuso de Brasília, do jeito que a IA consegue ler. */
export function descreverOcupados(ocupados: Array<{ inicio: string; fim: string }>): string[] {
  return ocupados
    .slice()
    .sort((a, b) => +new Date(a.inicio) - +new Date(b.inicio))
    .map((o) => {
      const i = new Date(o.inicio), f = new Date(o.fim);
      return `${fmtDia.format(i)} ${fmtHora.format(i)}–${fmtHora.format(f)}`;
    });
}

export function descreverHorario(d: Date): string {
  return `${fmtDia.format(d)} às ${fmtHora.format(d)}`;
}

/** Já existe agendamento deste contato no mesmo horário? (a IA às vezes repete o marcador) */
export async function jaAgendado(admin: any, companyId: string, cardId: string | null, inicio: Date): Promise<boolean> {
  if (!cardId) return false;
  const { data } = await admin
    .from("agendamento")
    .select("id")
    .eq("company_id", companyId)
    .eq("card_id", cardId)
    .eq("inicio", inicio.toISOString())
    .neq("status", "cancelado")
    .limit(1);
  return !!data?.length;
}
