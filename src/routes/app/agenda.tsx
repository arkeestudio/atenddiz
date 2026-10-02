import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brand } from "@/config/brand";
import { HelpTip } from "@/components/help-tip";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, XCircle, MessageSquareText, RefreshCw, RotateCcw } from "lucide-react";

// Visitas marcadas pela IA (ou pela equipe) num lugar só. A IA marca, avisa na conversa e
// no painel — mas quem precisa olhar "o que tem amanhã?" não pode depender de ter visto o
// alerta na hora. Lista por dia, com Hoje/Amanhã em destaque, status e atalho para a conversa.
export const Route = createFileRoute("/app/agenda")({
  head: () => ({ meta: [{ title: `${brand.name} — Agenda` }] }),
  component: AgendaPage,
});

type Visita = {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  status: string;
  google_event_id: string | null;
  nome: string | null;
  numero: string | null;
};
type Aba = "proximas" | "passadas";

const TZ = "America/Sao_Paulo";
const DIA_MS = 86_400_000;

// "YYYY-MM-DD" no fuso de Brasília: é a chave de agrupamento, não depende do fuso do navegador.
function chaveDia(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function rotuloDia(chave: string): string {
  const hoje = chaveDia(new Date());
  const amanha = chaveDia(new Date(Date.now() + DIA_MS));
  if (chave === hoje) return "Hoje";
  if (chave === amanha) return "Amanhã";
  const [a, m, d] = chave.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" })
    .format(new Date(Date.UTC(a, m - 1, d, 12)));
}
function hora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const STATUS: Record<string, { rotulo: string; classe: string }> = {
  agendado: { rotulo: "Agendada", classe: "bg-[color:var(--brand-soft)] text-[color:var(--brand-text)] border-[color:var(--brand-soft-strong)]" },
  realizado: { rotulo: "Realizada", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" },
  cancelado: { rotulo: "Cancelada", classe: "bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/30" },
};

function AgendaPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const [aba, setAba] = useState<Aba>("proximas");
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!companyId) return;
    setCarregando(true);
    const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
    const de = aba === "proximas" ? inicioHoje : new Date(inicioHoje.getTime() - 30 * DIA_MS);
    const ate = aba === "proximas" ? new Date(inicioHoje.getTime() + 90 * DIA_MS) : inicioHoje;
    const { data, error } = await (supabase as any)
      .from("agendamento")
      .select("id, titulo, inicio, fim, status, google_event_id, crm_cards(nome, nome_whatsapp, numero)")
      .eq("company_id", companyId)
      .gte("inicio", de.toISOString())
      .lt("inicio", ate.toISOString())
      .order("inicio", { ascending: aba === "proximas" });
    if (error) toast.error(error.message);
    setVisitas(((data ?? []) as any[]).map((r) => ({
      id: r.id, titulo: r.titulo, inicio: r.inicio, fim: r.fim, status: r.status, google_event_id: r.google_event_id,
      nome: r.crm_cards?.nome || r.crm_cards?.nome_whatsapp || null,
      numero: r.crm_cards?.numero || null,
    })));
    setCarregando(false);
  }, [companyId, aba]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Visita nova marcada pela IA aparece sem recarregar a página.
  useEffect(() => {
    if (!companyId) return;
    const ch = supabase
      .channel(`tenant:${companyId}:agenda`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agendamento", filter: `company_id=eq.${companyId}` }, () => { void carregar(); })
      .subscribe();
    const aoVoltar = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { supabase.removeChannel(ch); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [companyId, carregar]);

  async function mudarStatus(v: Visita, status: "agendado" | "realizado" | "cancelado") {
    const { error } = await (supabase as any).from("agendamento").update({ status }).eq("id", v.id);
    if (error) return toast.error(error.message);
    setVisitas((prev) => prev.map((x) => (x.id === v.id ? { ...x, status } : x)));
    if (status === "cancelado" && v.google_event_id) {
      toast.message("Cancelada aqui. No Google Agenda o evento continua — remova lá se precisar.");
    } else {
      toast.success(status === "realizado" ? "Visita marcada como realizada" : status === "cancelado" ? "Visita cancelada" : "Visita reaberta");
    }
  }

  const porDia = useMemo(() => {
    const grupos = new Map<string, Visita[]>();
    for (const v of visitas) {
      const k = chaveDia(new Date(v.inicio));
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k)!.push(v);
    }
    return Array.from(grupos.entries());
  }, [visitas]);

  const resumo = useMemo(() => {
    const hoje = chaveDia(new Date());
    const em7 = Date.now() + 7 * DIA_MS;
    const ativas = visitas.filter((v) => v.status === "agendado");
    return {
      hoje: ativas.filter((v) => chaveDia(new Date(v.inicio)) === hoje).length,
      semana: ativas.filter((v) => +new Date(v.inicio) <= em7).length,
    };
  }, [visitas]);

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight leading-none">
          Agenda
          <HelpTip text="Visitas marcadas pela IA no WhatsApp (e pela equipe). A IA avisa na conversa e aqui fica o quadro geral: o que tem hoje, amanhã e nos próximos dias. Marque como realizada ou cancele." />
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[color:var(--hairline)] bg-[color:var(--panel)] p-1 gap-0.5">
            {([["proximas", "Próximas"], ["passadas", "Passadas"]] as const).map(([v, rotulo]) => (
              <button
                key={v}
                onClick={() => setAba(v)}
                className={`px-3 py-1.5 text-[12.5px] font-semibold rounded-md transition-colors ${
                  aba === v ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-text)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void carregar()} title="Atualizar">
            <RefreshCw className={`size-3.5 ${carregando ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      {aba === "proximas" && (
        <div className="flex gap-2 flex-wrap">
          <Resumo rotulo="Hoje" valor={resumo.hoje} destaque={resumo.hoje > 0} />
          <Resumo rotulo="Próximos 7 dias" valor={resumo.semana} />
          <Resumo rotulo="Agendadas" valor={visitas.filter((v) => v.status === "agendado").length} />
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] divide-y divide-[color:var(--hairline)]">
        {!carregando && porDia.length === 0 && (
          <div className="py-14 text-center text-muted-foreground">
            <CalendarDays className="mx-auto mb-2 size-7 opacity-60" />
            <p className="text-sm">{aba === "proximas" ? "Nenhuma visita marcada nos próximos 90 dias." : "Nenhuma visita nos últimos 30 dias."}</p>
            {aba === "proximas" && <p className="text-xs mt-1">Quando a IA marcar uma, ela aparece aqui e avisa no painel.</p>}
          </div>
        )}
        {porDia.map(([dia, lista]) => {
          const rotulo = rotuloDia(dia);
          const destaque = rotulo === "Hoje";
          return (
            <section key={dia} className="px-4 py-3">
              <div className="flex items-baseline gap-2 mb-2">
                <h2 className={`text-[13px] font-bold uppercase tracking-wider ${destaque ? "text-[color:var(--brand-text)]" : "text-muted-foreground"}`}>{rotulo}</h2>
                {(rotulo === "Hoje" || rotulo === "Amanhã") && (
                  <span className="text-[11px] text-muted-foreground">
                    {new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(lista[0].inicio))}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">{lista.length} {lista.length === 1 ? "visita" : "visitas"}</span>
              </div>
              <ul className="space-y-1.5">
                {lista.map((v) => {
                  const st = STATUS[v.status] ?? { rotulo: v.status, classe: "bg-[color:var(--panel-2)] text-muted-foreground border-[color:var(--hairline)]" };
                  const passada = +new Date(v.fim) < Date.now();
                  return (
                    <li
                      key={v.id}
                      className={`flex items-center gap-3 rounded-xl border border-[color:var(--hairline)] px-3 py-2.5 ${
                        v.status === "cancelado" ? "opacity-60" : "bg-[color:var(--panel-2)]/40"
                      }`}
                    >
                      <div className="text-center shrink-0 w-[52px]">
                        <div className="text-[15px] font-bold tabular-nums leading-none">{hora(v.inicio)}</div>
                        <div className="text-[10.5px] text-muted-foreground tabular-nums mt-0.5">até {hora(v.fim)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-[13.5px] truncate">{v.nome || v.numero || "Contato"}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${st.classe}`}>{st.rotulo}</span>
                          {v.google_event_id && <span className="text-[10px] text-muted-foreground shrink-0" title="Sincronizada com o Google Agenda">· Google</span>}
                        </div>
                        <div className="text-[12px] text-muted-foreground truncate">{v.titulo}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {v.numero && (
                          <Button asChild variant="ghost" size="sm" className="h-8 px-2" title="Abrir conversa">
                            <Link to="/app/conversas" search={{ numero: v.numero } as any}><MessageSquareText className="size-4" /></Link>
                          </Button>
                        )}
                        {v.status === "agendado" && (
                          <>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-700 dark:text-emerald-300" title={passada ? "Marcar como realizada" : "Marcar como realizada (antes da hora)"} onClick={() => void mudarStatus(v, "realizado")}>
                              <CheckCircle2 className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600 dark:text-red-300" title="Cancelar visita" onClick={() => void mudarStatus(v, "cancelado")}>
                              <XCircle className="size-4" />
                            </Button>
                          </>
                        )}
                        {v.status !== "agendado" && (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" title="Reabrir como agendada" onClick={() => void mudarStatus(v, "agendado")}>
                            <RotateCcw className="size-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 min-w-[120px] ${destaque ? "border-[color:var(--brand-soft-strong)] bg-[color:var(--brand-soft)]" : "border-[color:var(--hairline)] bg-[color:var(--panel)]"}`}>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">{rotulo}</div>
      <div className={`text-[20px] font-bold tabular-nums leading-tight ${destaque ? "text-[color:var(--brand-text)]" : ""}`}>{valor}</div>
    </div>
  );
}
