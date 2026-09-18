import { createFileRoute } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brand } from "@/config/brand";
import { Bot, MessageCircle, AlertTriangle, Clock, UserPlus, DollarSign, Hand, CalendarCheck, TrendingDown, Trophy } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MessageTimeline, type TimelineItem } from "@/components/dashboard/message-timeline";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { labelMotivoPerda } from "@/lib/motivos-perda";

export const Route = createFileRoute("/app/dashboard")({
  head: () => ({ meta: [{ title: `${brand.name} — Dashboard` }] }),
  component: Dashboard,
});

type Period = "today" | "7d" | "30d" | "custom";
type Stage = { id: string; nome: string; tipo: string; ordem: number; cor: string | null };
type Pendencia = { id: string; numero: string; nome: string | null; detalhe: string; urgencia: number };

function periodRange(p: Period, from?: string, to?: string): { start: Date; end: Date; days: number } {
  const end = new Date();
  if (p === "today") {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    return { start: s, end, days: 1 };
  }
  if (p === "7d") return { start: new Date(Date.now() - 7 * 86400000), end, days: 7 };
  if (p === "30d") return { start: new Date(Date.now() - 30 * 86400000), end, days: 30 };
  const s = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
  const e = to ? new Date(to) : end;
  return { start: s, end: e, days: Math.max(1, Math.ceil((+e - +s) / 86400000)) };
}

function Dashboard() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [period, setPeriod] = useState<Period>("7d");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [stages, setStages] = useState<Stage[]>([]);
  const [porEtapa, setPorEtapa] = useState<Record<string, number>>({});
  const [periodo, setPeriodo] = useState({ leadsNovos: 0, matriculas: 0, receita: 0, perdidos: 0, receitaPerdida: 0, motivoTop: "" });
  const [respondidasIa, setRespondidasIa] = useState(0);
  const [recebidas, setRecebidas] = useState(0);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [aguardando, setAguardando] = useState<Pendencia[]>([]);
  const [paradas, setParadas] = useState<Pendencia[]>([]);
  const [followups, setFollowups] = useState<Pendencia[]>([]);
  const [iaModelo, setIaModelo] = useState<string>("Gemini 2.5 Flash");
  const [creditos, setCreditos] = useState<number | null>(null);

  const range = useMemo(() => periodRange(period, from, to), [period, from, to]);

  useEffect(() => { if (companyId) void load(companyId, range); }, [companyId, range.start.getTime(), range.end.getTime()]);

  async function load(cid: string, r: { start: Date; end: Date; days: number }) {
    const startISO = r.start.toISOString();
    const endISO = r.end.toISOString();
    // As últimas 48h são consultadas à parte de propósito: uma conversa parada desde ontem
    // precisa aparecer mesmo com o filtro em "Hoje". Pendência não obedece a recorte de relatório.
    const desde48h = new Date(Date.now() - 48 * 3600_000).toISOString();

    const [{ data: inst }, { data: cards }, { data: st }, { data: msgs }, { data: last }, { data: msgs48 }, { data: comp }, { data: agentCfg }] =
      await Promise.all([
        supabase.from("whatsapp_instances").select("status").eq("company_id", cid).maybeSingle(),
        supabase.from("crm_cards").select("id,status,stage_id,valor,nome,numero,created_at,follow_up,motivo_perda").eq("company_id", cid),
        supabase.from("crm_stage").select("id,nome,tipo,ordem,cor").eq("company_id", cid).order("ordem", { ascending: true }),
        supabase.from("mensagens").select("direcao,autor,created_at").eq("company_id", cid).gte("created_at", startISO).lte("created_at", endISO),
        supabase.from("mensagens").select("id,numero,contato_nome,direcao,autor,texto,created_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(8),
        supabase.from("mensagens").select("numero,contato_nome,direcao,created_at").eq("company_id", cid).gte("created_at", desde48h).order("created_at", { ascending: true }),
        (supabase as any).from("company").select("creditos_saldo").eq("id", cid).maybeSingle(),
        (supabase as any).from("agent_config").select("ai_model").eq("company_id", cid).maybeSingle(),
      ]);

    setStatus(((inst?.status as any) || "disconnected"));
    setIaModelo(prettyModel((agentCfg as any)?.ai_model));
    setCreditos(typeof (comp as any)?.creditos_saldo === "number" ? (comp as any).creditos_saldo : null);

    const etapas = ((st ?? []) as any[]).map((s) => ({ id: s.id, nome: s.nome, tipo: s.tipo, ordem: s.ordem, cor: s.cor })) as Stage[];
    setStages(etapas);
    const tipoDe = new Map(etapas.map((s) => [s.id, s.tipo]));

    // Quantos leads estão parados em cada etapa agora. É o que o gestor precisa na
    // reunião diária: onde está cada família, não quantas mensagens trocamos.
    const contagem: Record<string, number> = {};
    const noPeriodo = (iso: string | null) => !!iso && iso >= startISO && iso <= endISO;
    let leadsNovos = 0, matriculas = 0, receita = 0, perdidos = 0, receitaPerdida = 0;
    const motivos = new Map<string, number>();

    for (const c of (cards ?? []) as any[]) {
      if (c.stage_id) contagem[c.stage_id] = (contagem[c.stage_id] ?? 0) + 1;
      if (noPeriodo(c.created_at)) leadsNovos += 1;
      const tipo = c.stage_id ? tipoDe.get(c.stage_id) : null;
      if (tipo === "ganho") { matriculas += 1; receita += Number(c.valor) || 0; }
      if (tipo === "perda") {
        perdidos += 1;
        receitaPerdida += Number(c.valor) || 0;
        const k = c.motivo_perda || "_sem";
        motivos.set(k, (motivos.get(k) ?? 0) + 1);
      }
    }
    setPorEtapa(contagem);
    const topMotivo = [...motivos.entries()].sort((a, b) => b[1] - a[1])[0];
    setPeriodo({
      leadsNovos, matriculas, receita, perdidos, receitaPerdida,
      motivoTop: topMotivo ? (topMotivo[0] === "_sem" ? "motivo não informado" : labelMotivoPerda(topMotivo[0])) : "",
    });

    let ia = 0, rec = 0;
    for (const m of (msgs ?? []) as any[]) {
      if (m.direcao === "entrada") rec += 1;
      if (m.autor === "ia") ia += 1;
    }
    setRespondidasIa(ia);
    setRecebidas(rec);

    setTimeline(((last ?? []) as any[]).map((m) => ({
      id: m.id, nome: m.contato_nome || m.numero, autor: m.autor, texto: m.texto, quando: new Date(m.created_at),
    })));

    // Fila de espera humana: a IA transferiu e ninguém assumiu. É a pendência mais cara
    // que existe — tem alguém do outro lado esperando uma pessoa responder agora.
    const { data: fila } = await (supabase as any)
      .from("crm_cards")
      .select("id,nome,numero,aguardando_desde,transferencia_motivo")
      .eq("company_id", cid)
      .eq("aguardando_humano", true)
      .order("aguardando_desde", { ascending: true });
    setAguardando(((fila ?? []) as any[]).map((c) => ({
      id: c.id, numero: c.numero, nome: c.nome,
      detalhe: c.transferencia_motivo || "aguardando atendimento",
      urgencia: c.aguardando_desde ? Math.round((Date.now() - +new Date(c.aguardando_desde)) / 60000) : 0,
    })));

    // Conversas cujo último recado é do cliente e ficou sem resposta há mais de 1h.
    const ultimaDe = new Map<string, any>();
    for (const m of (msgs48 ?? []) as any[]) ultimaDe.set(m.numero, m);
    const umaHora = Date.now() - 3600_000;
    const par: Pendencia[] = [];
    ultimaDe.forEach((m, numero) => {
      if (m.direcao === "entrada" && +new Date(m.created_at) < umaHora) {
        const min = Math.round((Date.now() - +new Date(m.created_at)) / 60000);
        par.push({ id: numero, numero, nome: m.contato_nome, detalhe: "sem resposta", urgencia: min });
      }
    });
    setParadas(par.sort((a, b) => b.urgencia - a.urgencia));

    // Follow-up: inclui os VENCIDOS. Antes só listava os de hoje, então o que passou
    // simplesmente sumia da tela — justamente o que mais precisa de cobrança.
    const fimDoDia = new Date(); fimDoDia.setHours(23, 59, 59, 999);
    const atrasadosEHoje = ((cards ?? []) as any[])
      .filter((c) => c.follow_up && new Date(c.follow_up) <= fimDoDia)
      .map((c) => {
        const d = new Date(c.follow_up);
        const hoje = d.toDateString() === new Date().toDateString();
        const diasAtraso = Math.floor((Date.now() - +d) / 86400000);
        return {
          id: c.id, numero: c.numero, nome: c.nome,
          detalhe: hoje ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : `${diasAtraso}d atrasado`,
          urgencia: hoje ? 0 : diasAtraso,
        };
      })
      .sort((a, b) => b.urgencia - a.urgencia);
    setFollowups(atrasadosEHoje);
  }

  const taxaIa = recebidas ? Math.round((respondidasIa / recebidas) * 100) : 0;
  const conversao = periodo.leadsNovos ? Math.round((periodo.matriculas / periodo.leadsNovos) * 100) : 0;
  const etapasFunil = stages.filter((s) => s.tipo === "normal");
  const totalPendencias = aguardando.length + paradas.length + followups.length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-extrabold tracking-tight flex items-center gap-2">
            Dashboard
            <HelpTip text="A tela da reunião diária: primeiro o que precisa de ação agora, depois onde está cada lead no funil e o resultado do período." />
          </h1>
          <p className="text-sm text-muted-foreground">Visão geral · {labelPeriod(period, range)}</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} from={from} to={to} setFrom={setFrom} setTo={setTo} status={status} />
      </header>

      {/* 1. O que trava agora — não obedece ao filtro de período, de propósito */}
      <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className={`size-4 ${totalPendencias ? "text-amber-500" : "text-muted-foreground"}`} />
          <h3 className="font-display text-[17px] font-semibold">Precisa de ação agora</h3>
          <span className="text-[11.5px] text-muted-foreground">independe do período</span>
        </div>
        {totalPendencias === 0 ? (
          <p className="text-[13px] text-muted-foreground py-6 text-center">Nenhuma pendência. Tudo respondido. 🎉</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-4 mt-3">
            <ListaPendencia
              titulo="Aguardando humano"
              icone={<Hand className="size-3.5" />}
              cor="text-amber-600 dark:text-amber-400"
              itens={aguardando}
              sufixo={(p) => (p.urgencia ? `${formatMin(p.urgencia)}` : "")}
              vazio="Ninguém na fila"
              para="/app/conversas"
            />
            <ListaPendencia
              titulo="Sem resposta +1h"
              icone={<Clock className="size-3.5" />}
              cor="text-red-500"
              itens={paradas}
              sufixo={(p) => formatMin(p.urgencia)}
              vazio="Nenhuma parada"
              para="/app/conversas"
            />
            <ListaPendencia
              titulo="Follow-up hoje e atrasado"
              icone={<CalendarCheck className="size-3.5" />}
              cor="text-[color:var(--brand-text)]"
              itens={followups}
              sufixo={(p) => p.detalhe}
              vazio="Nada agendado"
              para="/app/planilha"
            />
          </div>
        )}
      </div>

      {/* 2. Onde está cada lead */}
      {etapasFunil.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-5">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h3 className="font-display text-[17px] font-semibold">Onde estão os leads</h3>
              <p className="text-xs text-muted-foreground">quantos aguardam em cada etapa agora</p>
            </div>
            <Button asChild variant="outline" size="sm"><Link to="/app/crm">Abrir funil →</Link></Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {etapasFunil.map((s) => (
              <Link
                key={s.id}
                to="/app/crm"
                className="min-w-[116px] flex-1 rounded-xl border border-[color:var(--hairline)] px-3 py-2.5 hover:bg-[color:var(--panel-2)] transition"
                style={{ borderTopColor: s.cor ?? undefined, borderTopWidth: 3 }}
              >
                <span className="block text-[11px] text-muted-foreground leading-tight truncate" title={s.nome}>{s.nome}</span>
                <span className="block text-[22px] font-bold tabular-nums">{porEtapa[s.id] ?? 0}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 3. Resultado do período */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard accent icon={<UserPlus className="size-4" />} label="Leads novos" value={periodo.leadsNovos} trend={`${recebidas} mensagens recebidas`} />
        <KpiCard icon={<Trophy className="size-4" />} label="Matrículas" value={periodo.matriculas} trend={periodo.leadsNovos ? `${conversao}% dos leads novos` : "—"} />
        <KpiCard icon={<DollarSign className="size-4" />} label="Receita contratada" value={`R$ ${periodo.receita.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} trend={`${periodo.matriculas} fechadas`} />
        <KpiCard
          icon={<TrendingDown className="size-4" />}
          label="Perdidos"
          value={periodo.perdidos}
          trend={periodo.motivoTop ? `mais comum: ${periodo.motivoTop}` : "nenhuma perda"}
        />
      </div>

      {periodo.receitaPerdida > 0 && (
        <Link
          to="/app/relatorios"
          className="flex items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 px-5 py-3 hover:bg-red-500/10 transition"
        >
          <TrendingDown className="size-4 text-red-500 shrink-0" />
          <span className="text-[13px]">
            <strong className="text-red-500">R$ {periodo.receitaPerdida.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</strong> em receita potencial perdida
            {periodo.motivoTop && <> — a razão mais frequente é <strong>{periodo.motivoTop}</strong></>}
          </span>
          <span className="ml-auto text-[12px] text-muted-foreground whitespace-nowrap">ver motivos →</span>
        </Link>
      )}

      <div className="grid lg:grid-cols-[1fr_1fr] gap-5">
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-display text-[17px] font-semibold">Últimas mensagens</h3>
              <p className="text-xs text-muted-foreground">atividade recente</p>
            </div>
            <MessageCircle className="size-4 text-muted-foreground" />
          </div>
          <MessageTimeline items={timeline} empty="Conecte o WhatsApp para começar a ver conversas." />
        </div>

        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="size-4 text-[color:var(--brand)]" />
            <h3 className="font-display text-[17px] font-semibold">Uso da IA</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">no período selecionado</p>
          <div className="grid grid-cols-2 gap-3">
            <IaStat label="Modelo" value={iaModelo} />
            <IaStat label="Respostas da IA" value={String(respondidasIa)} />
            <IaStat label="Resolvido no automático" value={`${taxaIa}%`} />
            {creditos != null && creditos < 1_000_000 && (
              <IaStat label="Créditos restantes" value={creditos.toLocaleString("pt-BR")} />
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground mt-auto pt-4">
            Cada resposta consome 1 crédito interno. A cota real de uso é a da sua conta Google (Gemini).
          </p>
        </div>
      </div>
    </div>
  );
}

function ListaPendencia({ titulo, icone, cor, itens, sufixo, vazio, para }: {
  titulo: string; icone: any; cor: string;
  itens: Pendencia[]; sufixo: (p: Pendencia) => string; vazio: string; para: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--hairline)] bg-[color:var(--panel-2)] p-3">
      <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold ${cor}`}>
        {icone} {titulo}
        <span className="ml-auto text-[15px] font-bold tabular-nums">{itens.length}</span>
      </div>
      <div className="mt-2 space-y-1">
        {itens.length === 0 && <p className="text-[12px] text-muted-foreground py-2">{vazio}</p>}
        {itens.slice(0, 4).map((p) => (
          <Link
            key={p.id}
            to={para}
            search={para === "/app/conversas" ? ({ numero: p.numero } as any) : undefined}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[color:var(--panel)] text-[12.5px]"
          >
            <span className="truncate flex-1">{p.nome || p.numero}</span>
            <span className="text-muted-foreground text-[11px] whitespace-nowrap">{sufixo(p)}</span>
          </Link>
        ))}
        {itens.length > 4 && (
          <Link to={para} className="block px-2 py-1 text-[11.5px] text-muted-foreground hover:underline">
            +{itens.length - 4} {itens.length - 4 === 1 ? "outro" : "outros"} →
          </Link>
        )}
      </div>
    </div>
  );
}

function formatMin(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function prettyModel(m?: string | null): string {
  if (!m) return "Gemini 2.5 Flash";
  const s = String(m).replace(/^(google|openai|anthropic)\//, "");
  if (s.includes("flash-lite")) return "Gemini 2.5 Flash Lite";
  if (s.includes("2.5-flash")) return "Gemini 2.5 Flash";
  if (s.includes("gemini")) return "Gemini";
  if (s.includes("gpt")) return s.toUpperCase();
  if (s.includes("claude")) return "Claude";
  return s;
}

function IaStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[15px] font-bold mt-0.5">{value}</div>
    </div>
  );
}

function labelPeriod(p: Period, r: { start: Date; end: Date }) {
  if (p === "today") return "hoje";
  if (p === "7d") return "últimos 7 dias";
  if (p === "30d") return "últimos 30 dias";
  return `${r.start.toLocaleDateString("pt-BR")} → ${r.end.toLocaleDateString("pt-BR")}`;
}

function PeriodPicker({ value, onChange, from, to, setFrom, setTo, status }: {
  value: Period; onChange: (p: Period) => void;
  from: string; to: string; setFrom: (s: string) => void; setTo: (s: string) => void;
  status: "connected" | "connecting" | "disconnected";
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex rounded-lg border border-[color:var(--hairline)] bg-[color:var(--panel)] p-1">
        {(["today", "7d", "30d", "custom"] as Period[]).map((p) => (
          <button key={p} onClick={() => onChange(p)}
            className={`px-2.5 py-1 text-[12.5px] rounded-md font-medium transition ${
              value === p ? "bg-[color:var(--brand)] text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {p === "today" ? "Hoje" : p === "7d" ? "7d" : p === "30d" ? "30d" : "Período"}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-8 rounded-md border border-[color:var(--hairline)] bg-[color:var(--panel)] px-2 text-[12.5px]" />
          <span className="text-muted-foreground text-xs">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-8 rounded-md border border-[color:var(--hairline)] bg-[color:var(--panel)] px-2 text-[12.5px]" />
        </div>
      )}
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({ status }: { status: "connected" | "connecting" | "disconnected" }) {
  const cfg = status === "connected"
    ? { txt: "Agente conectado", cls: "text-[color:var(--brand-text)] border-[color:var(--brand-soft-strong)] bg-[color:var(--brand-soft)]", dot: "var(--brand)" }
    : status === "connecting"
    ? { txt: "Conectando…", cls: "text-amber-600 dark:text-amber-300 border-amber-500/30 bg-amber-500/10", dot: "rgb(245 158 11)" }
    : { txt: "Desconectado", cls: "text-red-600 dark:text-red-300 border-red-500/30 bg-red-500/10", dot: "rgb(239 68 68)" };
  return (
    <div className={`flex items-center gap-2 ${cfg.cls} border text-[12.5px] font-semibold px-3 py-1.5 rounded-full`}>
      <span className="size-2 rounded-full" style={{ background: cfg.dot }} />
      {cfg.txt}
    </div>
  );
}
