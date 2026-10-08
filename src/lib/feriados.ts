// Feriados: os nacionais, calculados aqui (fixos e os que dependem da Páscoa), mais as datas
// que a empresa cadastra em Agente > Horários (recesso, feriado municipal, emenda). Servem para
// a agenda (a IA não marca visita), para o horário de atendimento (feriado = fechado o dia
// inteiro) e para a tela da Agenda. Datas em "AAAA-MM-DD", sem biblioteca de datas.
import type { BusinessHours } from "./business-hours";

export type Feriado = { data: string; nome: string; nacional: boolean };
export type FeriadoInfo = { nome: string; nacional: boolean };
type Calendario = Pick<BusinessHours, "feriados" | "feriados_nacionais"> | null | undefined;

const TZ = "America/Sao_Paulo";

function ymd(a: number, m: number, d: number) {
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function maisDias(d: Date, n: number): string {
  const x = new Date(d.getTime() + n * 86_400_000);
  return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

/**
 * Feriados nacionais do ano. Carnaval (segunda e terça) e Corpus Christi são ponto
 * facultativo, mas escola e comércio fecham — entram como feriado.
 */
export function feriadosNacionais(ano: number): Feriado[] {
  const p = pascoa(ano);
  const lista: Array<Omit<Feriado, "nacional">> = [
    { data: ymd(ano, 1, 1), nome: "Confraternização Universal" },
    { data: maisDias(p, -48), nome: "Carnaval" },
    { data: maisDias(p, -47), nome: "Carnaval" },
    { data: maisDias(p, -2), nome: "Sexta-feira Santa" },
    { data: ymd(ano, 4, 21), nome: "Tiradentes" },
    { data: ymd(ano, 5, 1), nome: "Dia do Trabalho" },
    { data: maisDias(p, 60), nome: "Corpus Christi" },
    { data: ymd(ano, 9, 7), nome: "Independência do Brasil" },
    { data: ymd(ano, 10, 12), nome: "Nossa Senhora Aparecida" },
    { data: ymd(ano, 11, 2), nome: "Finados" },
    { data: ymd(ano, 11, 15), nome: "Proclamação da República" },
    { data: ymd(ano, 11, 20), nome: "Dia da Consciência Negra" },
    { data: ymd(ano, 12, 25), nome: "Natal" },
  ];
  return lista.map((f) => ({ ...f, nacional: true })).sort((a, b) => a.data.localeCompare(b.data));
}

/** "AAAA-MM-DD" de um instante, no fuso pedido (Brasília por padrão). */
export function diaDe(d: Date, tz: string = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** O que fecha a empresa nesse dia, ou null. As datas da empresa valem antes das nacionais. */
export function feriadoEm(dia: string, h?: Calendario): FeriadoInfo | null {
  for (const f of h?.feriados ?? []) {
    if (!f?.de) continue;
    const ate = f.ate && f.ate >= f.de ? f.ate : f.de;
    if (dia >= f.de && dia <= ate) return { nome: f.motivo?.trim() || "dia sem atendimento", nacional: false };
  }
  if (h?.feriados_nacionais === false) return null;
  const nome = feriadosNacionais(Number(dia.slice(0, 4))).find((f) => f.data === dia)?.nome;
  return nome ? { nome, nacional: true } : null;
}

/** Feriados e recessos entre dois dias (inclusive), um por dia, em ordem. */
export function feriadosEntre(de: string, ate: string, h?: Calendario): Feriado[] {
  const out: Feriado[] = [];
  let d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  if (Number.isNaN(+d) || Number.isNaN(+fim)) return out;
  for (let passos = 0; d <= fim && passos < 400; passos++) {
    const dia = diaDe(d, "UTC");
    const f = feriadoEm(dia, h);
    if (f) out.push({ data: dia, ...f });
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

/** "seg., 12/10" a partir de "AAAA-MM-DD". */
export function rotuloCurto(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" })
    .format(new Date(Date.UTC(a, m - 1, d, 12)));
}
