import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Loader2, Plus, Pencil, Trash2, Check, Undo2, Wallet, Sparkles, Lock, Download } from "lucide-react";
import { toast } from "sonner";
import { HelpTip } from "@/components/help-tip";
import { brand } from "@/config/brand";
import {
  finKpis, listLancamentos, listCategorias, upsertLancamento, marcarPago,
  deleteLancamento, upsertCategoria, deleteCategoria, finStatus, enableFinanceiro,
} from "@/lib/financeiro.functions";
import { LancamentoDrawer, type LancamentoForm } from "@/components/financeiro/lancamento-drawer";
import { FinKpiGrid, fmtBRL } from "@/components/financeiro/fin-kpis";

export const Route = createFileRoute("/app/financeiro")({
  head: () => ({ meta: [{ title: `${brand.name} — Financeiro` }] }),
  beforeLoad: ({ context }: any) => {
    if (context?.membership?.role === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: FinanceiroPage,
});

function FinanceiroPage() {
  const fetchStatus = useServerFn(finStatus);
  const [status, setStatus] = useState<{ ativo: boolean; planoPermite: boolean; diasVencimento: number; planSlug: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try { setStatus(await fetchStatus()); }
    catch { setStatus({ ativo: false, planoPermite: false, diasVencimento: 7, planSlug: "starter" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  if (loading) {
    return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!status?.planoPermite) {
    return <PlanGate />;
  }

  if (!status.ativo) {
    return <EnableGate onEnabled={load} />;
  }

  return <FinanceiroContent diasVenc={status.diasVencimento} />;
}

function PlanGate() {
  return (
    <div className="max-w-2xl mx-auto py-10">
      <Card className="p-8 text-center space-y-4">
        <div className="size-14 rounded-2xl bg-[color:var(--brand-soft)] grid place-items-center mx-auto">
          <Lock className="size-6 text-[color:var(--brand-text)]" />
        </div>
        <h1 className="text-2xl font-bold">Módulo Financeiro</h1>
        <p className="text-muted-foreground">
          Não foi possível carregar o módulo agora. Recarregue a página.
        </p>
        <Button size="lg" onClick={() => window.location.reload()}>Recarregar</Button>
      </Card>
    </div>
  );
}

function EnableGate({ onEnabled }: { onEnabled: () => void }) {
  const enable = useServerFn(enableFinanceiro);
  const [dias, setDias] = useState(7);
  const [saving, setSaving] = useState(false);
  async function ativar() {
    setSaving(true);
    try {
      await enable({ data: { enable: true, diasVencimentoPadrao: dias } });
      toast.success("Módulo financeiro ativado");
      onEnabled();
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    finally { setSaving(false); }
  }
  return (
    <div className="max-w-2xl mx-auto py-10">
      <Card className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl bg-[color:var(--brand-soft)] grid place-items-center">
            <Wallet className="size-5 text-[color:var(--brand-text)]" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Ativar módulo financeiro</h1>
            <p className="text-sm text-muted-foreground">Você pode desativar a qualquer momento em Configurações.</p>
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 p-4 text-sm space-y-2">
          <div className="flex items-start gap-2"><Sparkles className="size-4 mt-0.5 text-[color:var(--brand)]" />
            <span>Toda vez que um lead for movido para o estágio <b>Ganho</b> no CRM, uma receita pendente será criada automaticamente.</span>
          </div>
          <div>Você também pode lançar receitas e despesas manualmente.</div>
        </div>
        <div className="max-w-xs">
          <label className="text-sm font-medium">Vencimento padrão das receitas do CRM</label>
          <div className="flex items-center gap-2 mt-1">
            <Input type="number" min={0} max={60} value={dias} onChange={(e) => setDias(Number(e.target.value))} />
            <span className="text-sm text-muted-foreground whitespace-nowrap">dias após o ganho</span>
          </div>
        </div>
        <Button onClick={ativar} disabled={saving} size="lg">
          {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />} Ativar agora
        </Button>
      </Card>
    </div>
  );
}

function FinanceiroContent({ diasVenc: _diasVenc }: { diasVenc: number }) {
  const fetchKpis = useServerFn(finKpis);
  const fetchLanc = useServerFn(listLancamentos);
  const fetchCats = useServerFn(listCategorias);
  const save = useServerFn(upsertLancamento);
  const togglePay = useServerFn(marcarPago);
  const del = useServerFn(deleteLancamento);

  const [kpi, setKpi] = useState<any>(null);
  const [lanc, setLanc] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [tab, setTab] = useState("visao");
  const [filterStatus, setFilterStatus] = useState("todos");
  const [q, setQ] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<LancamentoForm> & { tipo: "receita" | "despesa" }>({ tipo: "receita" });
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    try {
      const [k, l, c] = await Promise.all([fetchKpis(), fetchLanc({ data: {} }), fetchCats()]);
      setKpi(k); setLanc(l as any[]); setCats(c as any[]);
    } catch (e: any) { toast.error(e?.message ?? "Erro ao carregar"); }
  }
  useEffect(() => { void loadAll(); }, []);

  const receitas = useMemo(() => lanc.filter((l) => l.tipo === "receita"), [lanc]);
  const despesas = useMemo(() => lanc.filter((l) => l.tipo === "despesa"), [lanc]);

  function openNew(tipo: "receita" | "despesa") {
    setEditing({ tipo });
    setDrawerOpen(true);
  }
  function openEdit(l: any) {
    setEditing({
      id: l.id, tipo: l.tipo,
      descricao: l.descricao,
      valor_reais: (Number(l.valor_cents) / 100).toFixed(2),
      categoria_id: l.categoria_id, forma_pagamento: l.forma_pagamento,
      status: l.status, vencimento: l.vencimento, pago_em: l.pago_em, competencia: l.competencia,
      observacao: l.observacao,
    });
    setDrawerOpen(true);
  }
  async function onSave(f: LancamentoForm) {
    setSaving(true);
    try {
      await save({ data: f as any });
      toast.success("Lançamento salvo");
      setDrawerOpen(false);
      void loadAll();
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    finally { setSaving(false); }
  }
  async function onPay(l: any) {
    try { await togglePay({ data: { id: l.id, pago: l.status !== "pago" } }); void loadAll(); }
    catch (e: any) { toast.error(e?.message ?? "Erro"); }
  }
  async function onDel(l: any) {
    if (!confirm(`Excluir "${l.descricao}"?`)) return;
    try { await del({ data: { id: l.id } }); toast.success("Excluído"); void loadAll(); }
    catch (e: any) { toast.error(e?.message ?? "Erro"); }
  }

  function exportCsv() {
    const rows = [["Tipo", "Descrição", "Valor", "Status", "Vencimento", "Pago em", "Categoria"]];
    for (const l of lanc) {
      rows.push([
        l.tipo, l.descricao, (Number(l.valor_cents) / 100).toFixed(2),
        l.status, l.vencimento, l.pago_em ?? "", l.categoria?.nome ?? "",
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `financeiro-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const lancFiltradas = (rows: any[]) => rows.filter((l) =>
    (filterStatus === "todos" || l.status === filterStatus) &&
    (!q || l.descricao.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Financeiro
            <HelpTip text="Controle de contas a pagar e a receber, com automação a partir do CRM. Vendas marcadas como Ganho viram receita pendente automaticamente." />
          </h1>
          <p className="text-sm text-muted-foreground">Fluxo de caixa, lançamentos e categorias.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}><Download className="size-4 mr-1.5" /> CSV</Button>
          <Button onClick={() => openNew("despesa")} variant="outline"><Plus className="size-4 mr-1.5" /> Despesa</Button>
          <Button onClick={() => openNew("receita")}><Plus className="size-4 mr-1.5" /> Receita</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="receber">A receber ({receitas.length})</TabsTrigger>
          <TabsTrigger value="pagar">A pagar ({despesas.length})</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="space-y-4">
          {kpi && (
            <>
              <FinKpiGrid
                receita={kpi.receitaMes} despesa={kpi.despesaMes} saldo={kpi.saldoMes}
                aReceber={kpi.aReceber} aPagar={kpi.aPagar} atrasados={kpi.atrasados}
              />
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold">Fluxo de caixa (últimos 6 meses)</h2>
                  <HelpTip text="Receitas e despesas efetivamente pagas no mês de competência." />
                </div>
                <div className="h-64">
                  <ResponsiveContainer>
                    <AreaChart data={kpi.series}>
                      <defs>
                        <linearGradient id="rec" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22B85F" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#22B85F" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="desp" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FF5A5A" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#FF5A5A" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="mes" fontSize={12} />
                      <YAxis fontSize={12} tickFormatter={(v) => fmtBRL(v)} width={80} />
                      <Tooltip formatter={(v: any) => fmtBRL(v)} />
                      <Area type="monotone" dataKey="receita" stroke="#22B85F" fill="url(#rec)" name="Receita" />
                      <Area type="monotone" dataKey="despesa" stroke="#FF5A5A" fill="url(#desp)" name="Despesa" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <h2 className="font-semibold mb-2">Próximos vencimentos</h2>
                  {kpi.proximos.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nada nos próximos 7 dias 🎉</div>
                  ) : (
                    <div className="divide-y">
                      {kpi.proximos.map((p: any) => (
                        <div key={p.id} className="py-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{p.descricao}</div>
                            <div className="text-xs text-muted-foreground">{new Date(p.vencimento).toLocaleDateString("pt-BR")}</div>
                          </div>
                          <div className={`text-sm font-semibold ${p.tipo === "receita" ? "text-emerald-600" : "text-rose-600"}`}>
                            {p.tipo === "receita" ? "+" : "−"}{fmtBRL(p.valor_cents)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
                <Card className="p-4">
                  <h2 className="font-semibold mb-2">Top despesas por categoria</h2>
                  {kpi.topCategorias.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Sem despesas registradas.</div>
                  ) : (
                    <div className="space-y-2">
                      {kpi.topCategorias.map((c: any) => {
                        const max = kpi.topCategorias[0].valor || 1;
                        return (
                          <div key={c.nome}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="truncate">{c.nome}</span>
                              <span className="font-medium">{fmtBRL(c.valor)}</span>
                            </div>
                            <div className="h-1.5 rounded bg-muted mt-1 overflow-hidden">
                              <div className="h-full" style={{ width: `${(c.valor / max) * 100}%`, background: c.cor }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="receber">
          <FiltersBar q={q} setQ={setQ} status={filterStatus} setStatus={setFilterStatus} />
          <LancamentoList items={lancFiltradas(receitas)} onEdit={openEdit} onPay={onPay} onDel={onDel} />
        </TabsContent>

        <TabsContent value="pagar">
          <FiltersBar q={q} setQ={setQ} status={filterStatus} setStatus={setFilterStatus} />
          <LancamentoList items={lancFiltradas(despesas)} onEdit={openEdit} onPay={onPay} onDel={onDel} />
        </TabsContent>

        <TabsContent value="categorias">
          <CategoriasTab cats={cats} reload={loadAll} />
        </TabsContent>
      </Tabs>

      <LancamentoDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        initial={editing}
        categorias={cats}
        onSave={onSave}
        saving={saving}
      />
    </div>
  );
}

function FiltersBar({ q, setQ, status, setStatus }: any) {
  return (
    <div className="flex gap-2 flex-wrap mb-3">
      <Input placeholder="Buscar descrição…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos</SelectItem>
          <SelectItem value="pendente">Pendentes</SelectItem>
          <SelectItem value="pago">Pagos</SelectItem>
          <SelectItem value="atrasado">Atrasados</SelectItem>
          <SelectItem value="cancelado">Cancelados</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function LancamentoList({ items, onEdit, onPay, onDel }: any) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (items.length === 0) {
    return <Card className="p-8 text-center text-muted-foreground text-sm">Nenhum lançamento.</Card>;
  }
  return (
    <Card className="divide-y">
      {items.map((l: any) => {
        const atrasado = l.status === "pendente" && l.vencimento < hoje;
        const statusColor =
          l.status === "pago" ? "bg-emerald-600" :
          atrasado || l.status === "atrasado" ? "bg-rose-600" :
          l.status === "cancelado" ? "bg-muted-foreground" : "bg-amber-500";
        return (
          <div key={l.id} className="p-3 flex items-center gap-3 flex-wrap">
            <div className={`size-2 rounded-full shrink-0 ${statusColor}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{l.descricao}</span>
                {l.categoria && (
                  <Badge variant="secondary" style={{ background: l.categoria.cor + "22", color: l.categoria.cor }}>
                    {l.categoria.nome}
                  </Badge>
                )}
                {l.crm_card_id && <Badge variant="outline">do CRM</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Vence em {new Date(l.vencimento).toLocaleDateString("pt-BR")}
                {l.pago_em && ` · Pago em ${new Date(l.pago_em).toLocaleDateString("pt-BR")}`}
                {l.forma_pagamento && ` · ${l.forma_pagamento}`}
              </div>
            </div>
            <div className={`font-semibold ${l.tipo === "receita" ? "text-emerald-600" : "text-rose-600"}`}>
              {l.tipo === "receita" ? "+" : "−"}{fmtBRL(l.valor_cents)}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onPay(l)} title={l.status === "pago" ? "Desmarcar pago" : "Marcar pago"}>
                {l.status === "pago" ? <Undo2 className="size-4" /> : <Check className="size-4" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(l)}><Pencil className="size-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => onDel(l)} className="text-rose-600 hover:text-rose-700"><Trash2 className="size-4" /></Button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function CategoriasTab({ cats, reload }: { cats: any[]; reload: () => void }) {
  const save = useServerFn(upsertCategoria);
  const del = useServerFn(deleteCategoria);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"receita" | "despesa">("despesa");
  const [cor, setCor] = useState("#8AA89A");

  async function add() {
    if (nome.trim().length < 2) return toast.error("Nome muito curto");
    try { await save({ data: { nome, tipo, cor } }); setNome(""); reload(); toast.success("Categoria criada"); }
    catch (e: any) { toast.error(e?.message ?? "Erro"); }
  }
  async function remove(id: string) {
    if (!confirm("Excluir categoria?")) return;
    try { await del({ data: { id } }); reload(); }
    catch (e: any) { toast.error(e?.message ?? "Erro"); }
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">Nova categoria</h2>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} className="flex-1 min-w-40" />
          <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="receita">Receita</SelectItem>
              <SelectItem value="despesa">Despesa</SelectItem>
            </SelectContent>
          </Select>
          <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-10 w-14 rounded border" />
          <Button onClick={add}><Plus className="size-4 mr-1.5" /> Criar</Button>
        </div>
      </Card>
      <div className="grid md:grid-cols-2 gap-3">
        {["receita", "despesa"].map((t) => (
          <Card key={t} className="p-4">
            <h3 className="font-semibold mb-2 capitalize">{t === "receita" ? "Receitas" : "Despesas"}</h3>
            <div className="divide-y">
              {cats.filter((c) => c.tipo === t).map((c) => (
                <div key={c.id} className="py-2 flex items-center gap-2">
                  <div className="size-3 rounded-full" style={{ background: c.cor }} />
                  <span className="flex-1 text-sm">{c.nome}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)} className="text-rose-600"><Trash2 className="size-4" /></Button>
                </div>
              ))}
              {cats.filter((c) => c.tipo === t).length === 0 && (
                <div className="text-xs text-muted-foreground py-2">Nenhuma categoria.</div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
