// Pure helper: decide if a given Date is inside the company's business hours.
// Shape stored at agent_config.horarios_atendimento:
// { enabled: boolean, timezone: string, dias: { "0": null | {abre:"HH:MM",fecha:"HH:MM"}, ... "6": ... } }

export type DaySchedule = { abre: string; fecha: string } | null;
export type BusinessHours = {
  enabled: boolean;
  timezone: string;
  dias: Record<string, DaySchedule>;
  // O que acontece fora do horário:
  // - "bloquear" (padrão): manda a mensagem de ausência e a IA não responde.
  // - "atender": a IA continua atendendo e coletando a ficha, não marca nada para "agora"
  //   e, quando o assunto depende da equipe, combina o retorno para a próxima abertura.
  modo_fora?: "bloquear" | "atender";
};

// Deslocamento do fuso naquele instante, ex.: "-03:00". Sem biblioteca de datas.
function offsetDe(tz: string, date: Date): string {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(date);
    const o = (p.find((x) => x.type === "timeZoneName")?.value ?? "GMT").replace("GMT", "");
    return o === "" ? "+00:00" : o.length === 3 ? `${o}:00` : o;
  } catch {
    return "-03:00";
  }
}

/** Próximo instante em que a empresa abre (a partir de `now`), ou null se não houver horário. */
export function proximaAbertura(h: BusinessHours | null | undefined, now: Date = new Date()): Date | null {
  if (!h?.enabled) return null;
  const tz = h.timezone || "America/Sao_Paulo";
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  for (let i = 0; i < 8; i++) {
    const dia = new Date(now.getTime() + i * 86_400_000);
    const sched = h.dias?.[String(getZonedParts(dia, tz).dow)];
    if (!sched || hhmmToMinutes(sched.abre) == null) continue;
    const abertura = new Date(`${ymd.format(dia)}T${sched.abre.padStart(5, "0")}:00${offsetDe(tz, dia)}`);
    if (abertura.getTime() > now.getTime()) return abertura;
  }
  return null;
}

/** "amanhã às 08:00" / "segunda-feira, 06/10 às 08:00" — como a IA deve dizer ao cliente. */
export function descreverAbertura(abertura: Date, tz = "America/Sao_Paulo", now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(abertura);
  const hoje = ymd.format(now);
  const amanha = ymd.format(new Date(now.getTime() + 86_400_000));
  const dia = ymd.format(abertura);
  if (dia === hoje) return `hoje às ${hora}`;
  if (dia === amanha) return `amanhã às ${hora}`;
  const extenso = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "2-digit", month: "2-digit" }).format(abertura);
  return `${extenso} às ${hora}`;
}

export function defaultHours(): BusinessHours {
  return {
    enabled: false,
    timezone: "America/Sao_Paulo",
    dias: {
      "0": null,
      "1": { abre: "09:00", fecha: "18:00" },
      "2": { abre: "09:00", fecha: "18:00" },
      "3": { abre: "09:00", fecha: "18:00" },
      "4": { abre: "09:00", fecha: "18:00" },
      "5": { abre: "09:00", fecha: "18:00" },
      "6": null,
    },
  };
}

function getZonedParts(date: Date, tz: string): { dow: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: map[wd] ?? 0, minutes: hh * 60 + mm };
}

function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

export function isWithinBusinessHours(h: BusinessHours | null | undefined, now: Date = new Date()): boolean {
  if (!h || !h.enabled) return true; // disabled = sempre dentro
  const tz = h.timezone || "America/Sao_Paulo";
  let parts;
  try {
    parts = getZonedParts(now, tz);
  } catch {
    parts = getZonedParts(now, "America/Sao_Paulo");
  }
  const day = h.dias?.[String(parts.dow)] ?? null;
  if (!day) return false;
  const open = hhmmToMinutes(day.abre);
  const close = hhmmToMinutes(day.fecha);
  if (open == null || close == null) return false;
  // Suporta janela cruzando meia-noite (ex: 22:00 → 02:00)
  if (close > open) return parts.minutes >= open && parts.minutes < close;
  return parts.minutes >= open || parts.minutes < close;
}

export const DIA_LABEL: Record<string, string> = {
  "0": "Domingo",
  "1": "Segunda",
  "2": "Terça",
  "3": "Quarta",
  "4": "Quinta",
  "5": "Sexta",
  "6": "Sábado",
};
