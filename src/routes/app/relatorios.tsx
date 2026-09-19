import { createFileRoute, redirect } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { brand } from "@/config/brand";
import { labelMotivoPerda } from "@/lib/motivos-perda";

function formatDuracao(ms: number): string {
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg}s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${min % 60 ? ` ${min % 60}min` : ""}` : `${Math.floor(h / 24)}d`;
}
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Bot, MessageCircle, Target, DollarSign, Download, Clock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/relatorios")({
  head: () => ({ meta: [{ title: `${brand.name} — Relatórios` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: RelatoriosPage,
});

type Period = "today" | "7d" | "30d" | "custom";

function rangeOf(p: Period, from?: string, to?: string) {
  const end = new Date();
  if (p === "today") { const s = new Date(); s.setHours(0, 0, 0, 0); return { start: s, end }; }
  if (p === "7d") return { start: new Date(Date.now() - 7 * 86400000), end };
  if (p === "30d") return { start: new Date(Date.now() - 30 * 86400000), end };
  return { start: from ? new Date(from) : new Date(Date.now() - 7 * 86400000), end: to ? new Date(to) : end };
}

function RelatoriosPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const [period, setPeriod] = useState<Period>("30d");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [msgs, setMsgs] = useState<{ created_at: string; direcao: string; autor: string; user_id: string | null }[]>([]);
  const [cards, setCards] = useState<{ status: string; stage_id: string | null; valor: number; owner_id: string | null; ultima_em: string }[]>([]);
  const [stages, setStages] = useState<{ id: string; nome: string; cor: string; tipo: string }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; nome: string | null; email: string | null }[]>([]);
  const [csat, setCsat] = useState<{ score: number | null; respondido_em: string | null }[]>([]);

  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const [{ data: m }, { data: c }, { data: st }, { data: cu }, { data: cs }] = await Promise.all([
        supabase.from("mensagens").select("created_at,direcao,autor,user_id,numero").eq("company_id", companyId).gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString()),
        // Filtrado pela data de entrada do lead: sem isso, "Conversão" e "Receita" ficavam
        // sempre acumuladas desde sempre, mesmo com o período em "Hoje".
        supabase.from("crm_cards").select("status,stage_id,valor,owner_id,ultima_em,created_at,motivo_perda").eq("company_id", companyId).gte("created_at", range.start.toISOString()).lte("created_at", range.end.toISOString()),
        supabase.from("crm_stage").select("id,nome,cor,tipo,ordem").eq("company_id", companyId).order("ordem", { ascending: true }),
        supabase.from("company_user").select("user_id,profiles(nome,email)").eq("company_id", companyId).eq("ativo", true),
        supabase.from("csat_response").select("score,respondido_em").eq("company_id", companyId).gte("enviado_em", range.start.toISOString()).lte("enviado_em", range.end.toISOString()),
      ]);
      setMsgs((m ?? []) as any);
      setCards((c ?? []) as any);
      setStages((st ?? []) as any);
      setCsat(((cs ?? []) as any).map((r: any) => ({ score: r.score, respondido_em: r.respondido_em })));
      setMembers(((cu ?? []) as any[]).map((r) => ({
        user_id: r.user_id, nome: r.profiles?.nome ?? null, email: r.profiles?.email ?? null,
      })));
    })();
  }, [companyId, range.start.getTime(), range.end.getTime()]);

  // Tempo de resposta, medido POR CONTATO e separando IA de humano.
  //
  // O cálculo antigo varria a lista global: a resposta mandada para o cliente B "fechava"
  // a pergunta do cliente A, e a IA (que responde em segundos) puxava a média para baixo
  // escondendo quanto a equipe realmente demora. O número não servia para decisão.
  //
  // Só conta a PRIMEIRA resposta a uma pergunta: respostas em rajada não contam de novo.
  const tempos = useMemo(() => {
    const porContato = new Map<string, any[]>();
    for (const m of msgs as any[]) {
      if (!m.numero) continue;
      (porContato.get(m.numero) ?? porContato.set(m.numero, []).get(m.numero)!).push(m);
    }
    const dIa: number[] = [], dHumano: number[] = [];
    porContato.forEach((lista) => {
      lista.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
      let aguardando: number | null = null;
      for (const m of lista) {
        if (m.direcao === "entrada") {
          if (aguardando === null) aguardando = +new Date(m.created_at);
          continue;
        }
        if (aguardando === null) continue;
        const delta = +new Date(m.created_at) - aguardando;
        (m.autor === "ia" ? dIa : dHumano).push(delta);
        aguardando = null;
      }
    });
    const media = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return { ia: media(dIa), humano: media(dHumano), nIa: dIa.length, nHumano: dHumano.length };
  }, [msgs]);

  const tempoMedioMs = tempos.humano || tempos.ia;

  const stageMap = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const totalMsgs = msgs.length;
  const respIa = msgs.filter((m) => m.autor === "ia").length;
  const ganho = cards.filter((c) => c.stage_id && stageMap.get(c.stage_id)?.tipo === "ganho");
  const receita = ganho.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const conversao = cards.length ? Math.round((ganho.length / cards.length) * 100) : 0;
  const csatRespondidos = csat.filter((c) => c.score != null);
  const csatMedia = csatRespondidos.length ? (csatRespondidos.reduce((s, c) => s + (c.score ?? 0), 0) / csatRespondidos.length) : 0;
  const csatTaxa = csat.length ? Math.round((csatRespondidos.length / csat.length) * 100) : 0;

  const perDay = useMemo(() => {
    const days = Math.min(30, Math.max(1, Math.ceil((+range.end - +range.start) / 86400000)));
    const map = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(range.end.getTime() - i * 86400000);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    msgs.forEach((m) => {
      const k = new Date(m.created_at).toISOString().slice(0, 10);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([d, v]) => ({ dia: d.slice(5), mensagens: v }));
  }, [msgs, range.start.getTime(), range.end.getTime()]);

  // Por que perdemos. É a leitura que o projeto comercial chama de mais valiosa:
  // saber se a matrícula escapou por preço, por horário ou por falta de vaga muda
  // decisões diferentes da direção. "Motivo não informado" fica visível de propósito,
  // porque é fila de trabalho — normalmente são as perdas que a IA fechou sozinha.
  const perdas = useMemo(() => {
    const perdidos = cards.filter((c: any) => {
      const st = stages.find((s) => s.id === c.stage_id);
      return (st as any)?.tipo === "perda";
    });
    const porMotivo = new Map<string, { qtd: number; valor: number }>();
    for (const c of perdidos as any[]) {
      const k = c.motivo_perda || "_sem";
      const cur = porMotivo.get(k) ?? { qtd: 0, valor: 0 };
      porMotivo.set(k, { qtd: cur.qtd + 1, valor: cur.valor + (Number(c.valor) || 0) });
    }
    const linhas = [...porMotivo.entries()]
      .map(([id, v]) => ({ id, label: id === "_sem" ? "Motivo não informado" : labelMotivoPerda(id), ...v }))
      .sort((a, b) => b.qtd - a.qtd);
    return { linhas, total: perdidos.length, receitaPerdida: linhas.reduce((s, l) => s + l.valor, 0) };
  }, [cards, stages]);

  const byStage = useMemo(() => {
    return stages.map((s) => {
      const v = cards.filter((c) => c.stage_id === s.id).length;
      return { name: s.nome, value: v, fill: s.cor };
    });
  }, [cards, stages]);

  const byAtendente = useMemo(() => {
    const map = new Map<string, { recebidas: number; respondidas: number; ganhos: number }>();
    members.forEach((m) => map.set(m.user_id, { recebidas: 0, respondidas: 0, ganhos: 0 }));
    msgs.forEach((m) => {
      if (!m.user_id) return;
      const cur = map.get(m.user_id) ?? { recebidas: 0, respondidas: 0, ganhos: 0 };
      if (m.direcao === "entrada") cur.recebidas += 1;
      if (m.direcao === "saida" && m.autor === "humano") cur.respondidas += 1;
      map.set(m.user_id, cur);
    });
    cards.forEach((c) => {
      if (c.owner_id && c.stage_id && stageMap.get(c.stage_id)?.tipo === "ganho") {
        const cur = map.get(c.owner_id) ?? { recebidas: 0, respondidas: 0, ganhos: 0 };
        cur.ganhos += 1; map.set(c.owner_id, cur);
      }
    });
    return members.map((m) => ({
      nome: (m.nome || m.email || m.user_id.slice(0, 6)) as string,
      ...(map.get(m.user_id) ?? { recebidas: 0, respondidas: 0, ganhos: 0 }),
    })).filter((r) => r.recebidas + r.respondidas + r.ganhos > 0);
  }, [msgs, cards, members, stageMap]);

  function exportCSV() {
    const lines: string[] = [];
    lines.push("Métrica;Valor");
    lines.push(`Período;${range.start.toLocaleDateString("pt-BR")} → ${range.end.toLocaleDateString("pt-BR")}`);
    lines.push(`Mensagens;${totalMsgs}`);
    lines.push(`Respondidas pela IA;${respIa}`);
    lines.push(`Cards totais;${cards.length}`);
    lines.push(`Ganhos;${ganho.length}`);
    lines.push(`Receita (R$);${receita.toFixed(2)}`);
    lines.push(`Conversão (%);${conversao}`);
    lines.push(`Tempo 1a resposta equipe (s);${Math.round(tempos.humano / 1000)}`);
    lines.push(`Tempo 1a resposta IA (s);${Math.round(tempos.ia / 1000)}`);
    lines.push(`CSAT médio (1-5);${csatMedia ? csatMedia.toFixed(2) : "-"}`);
    lines.push(`CSAT respostas;${csatRespondidos.length}/${csat.length}`);
    lines.push("");
    lines.push("Etapa;Cards");
    byStage.forEach((s) => lines.push(`${s.name};${s.value}`));
    lines.push("");
    lines.push("Atendente;Recebidas;Respondidas;Ganhos");
    byAtendente.forEach((a) => lines.push(`${a.nome};${a.recebidas};${a.respondidas};${a.ganhos}`));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio_${range.start.toISOString().slice(0, 10)}_${range.end.toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const tooltipStyle = {
    background: "var(--panel)", border: "1px solid var(--hairline)",
    borderRadius: 12, color: "var(--foreground)",
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight flex items-center gap-2">Relatórios <HelpTip text="Métricas de atendimento, conversão por etapa do CRM, tempo de resposta, performance por atendente e nota média de satisfação (CSAT)." /></h1>
          <p className="text-sm text-muted-foreground">{range.start.toLocaleDateString("pt-BR")} → {range.end.toLocaleDateString("pt-BR")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodTabs value={period} onChange={setPeriod} />
          {period === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-[color:var(--panel)] border border-[color:var(--hairline)] rounded-md px-2 py-1.5 text-[13px]" />
              <span className="text-muted-foreground">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-[color:var(--panel)] border border-[color:var(--hairline)] rounded-md px-2 py-1.5 text-[13px]" />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="size-4 mr-2" />Exportar CSV</Button>
        </div>
      </header>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <KpiCard accent icon={<MessageCircle className="size-4" />} label="Mensagens" value={totalMsgs} trend={`${respIa} pela IA`} />
        <KpiCard
          icon={<Clock className="size-4" />}
          label="Tempo de 1ª resposta"
          value={tempos.humano ? formatDuracao(tempos.humano) : tempos.ia ? formatDuracao(tempos.ia) : "—"}
          trend={
            tempos.humano && tempos.ia
              ? `equipe ${formatDuracao(tempos.humano)} · IA ${formatDuracao(tempos.ia)}`
              : tempos.humano ? `${tempos.nHumano} respostas da equipe`
              : tempos.ia ? `${tempos.nIa} respostas da IA` : "sem dados"
          }
        />
        <KpiCard icon={<Target className="size-4" />} label="Conversão" value={`${conversao}%`} trend={`${ganho.length} ganhos / ${cards.length} cards`} />
        <KpiCard icon={<DollarSign className="size-4" />} label="Receita" value={`R$ ${receita.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} trend="cards em etapas de ganho" />
        <KpiCard icon={<Star className="size-4" />} label="CSAT" value={csatMedia ? `${csatMedia.toFixed(1)} / 5` : "—"} trend={`${csatRespondidos.length}/${csat.length} resp. (${csatTaxa}%)`} />
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
          <h3 className="font-display text-[17px] font-semibold">Mensagens por dia</h3>
          <p className="text-xs text-muted-foreground mb-3">no período selecionado</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={perDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in oklab, currentColor 12%, transparent)" />
              <XAxis dataKey="dia" fontSize={11} stroke="currentColor" opacity={0.6} />
              <YAxis fontSize={11} allowDecimals={false} stroke="currentColor" opacity={0.6} />
              <Tooltip contentStyle={tooltipStyle as any} cursor={{ fill: "color-mix(in oklab, currentColor 6%, transparent)" }} />
              <Bar dataKey="mensagens" radius={[6, 6, 0, 0]} fill={brand.primary} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
          <h3 className="font-display text-[17px] font-semibold">Distribuição por etapa</h3>
          <p className="text-xs text-muted-foreground mb-3">cards no funil</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byStage} dataKey="value" nameKey="name" outerRadius={80} innerRadius={45} paddingAngle={2}>
                {byStage.map((e, i) => <Cell key={i} fill={e.fill} stroke="var(--panel)" strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle as any} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-2 space-y-1.5">
            {byStage.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-[13px]">
                <span className="size-2.5 rounded-full" style={{ background: s.fill }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto font-semibold">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {perdas.total > 0 && (
        <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h3 className="font-display text-[17px] font-semibold">Por que perdemos</h3>
              <p className="text-xs text-muted-foreground">{perdas.total} {perdas.total === 1 ? "lead perdido" : "leads perdidos"} no período</p>
            </div>
            {perdas.receitaPerdida > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Receita potencial perdida</p>
                <p className="font-display text-[19px] font-semibold text-red-500">
                  R$ {perdas.receitaPerdida.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                </p>
              </div>
            )}
          </div>
          <ul className="space-y-1.5">
            {perdas.linhas.map((l) => (
              <li key={l.id} className="flex items-center gap-3 text-[13px]">
                <span className={`min-w-[170px] ${l.id === "_sem" ? "text-amber-600 dark:text-amber-400" : ""}`}>{l.label}</span>
                <span className="flex-1 h-2 rounded-full bg-[color:var(--panel-2)] overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${l.id === "_sem" ? "bg-amber-500/60" : "bg-red-500/70"}`}
                    style={{ width: `${Math.round((l.qtd / perdas.total) * 100)}%` }}
                  />
                </span>
                <span className="font-semibold tabular-nums w-8 text-right">{l.qtd}</span>
                {l.valor > 0 && (
                  <span className="text-muted-foreground tabular-nums w-24 text-right">
                    R$ {l.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-display text-[17px] font-semibold">Conversão por atendente</h3>
            <p className="text-xs text-muted-foreground">recebidas, respondidas e ganhos no período</p>
          </div>
          <Bot className="size-4 text-muted-foreground" />
        </div>
        {byAtendente.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem atividade humana no período.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, byAtendente.length * 50)}>
            <BarChart data={byAtendente} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in oklab, currentColor 12%, transparent)" />
              <XAxis type="number" fontSize={11} stroke="currentColor" opacity={0.6} />
              <YAxis type="category" dataKey="nome" width={120} fontSize={12} stroke="currentColor" opacity={0.8} />
              <Tooltip contentStyle={tooltipStyle as any} />
              <Bar dataKey="recebidas" fill="#8AA89A" radius={[0, 6, 6, 0]} />
              <Bar dataKey="respondidas" fill={brand.primary} radius={[0, 6, 6, 0]} />
              <Bar dataKey="ganhos" fill="#22B85F" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[color:var(--hairline)] bg-[color:var(--panel)] p-1">
      {(["today", "7d", "30d", "custom"] as Period[]).map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${
            value === p ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-text)]" : "text-muted-foreground hover:text-foreground"
          }`}>
          {p === "today" ? "Hoje" : p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : "Personalizado"}
        </button>
      ))}
    </div>
  );
}
