import { createFileRoute, Link } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { toast } from "sonner";
import { Search, MessageSquareText, Loader2, Sparkles, X, ArrowUpDown } from "lucide-react";
import { brand } from "@/config/brand";
import { normalizeFichaCampos, type FichaCampo } from "@/lib/ficha-campos";
import { salvarFicha } from "@/lib/ficha.functions";

export const Route = createFileRoute("/app/planilha")({
  head: () => ({ meta: [{ title: `${brand.name} — Planilha de Leads` }] }),
  component: PlanilhaPage,
});

type Stage = { id: string; nome: string; cor: string | null; ordem: number };
type Card = {
  id: string;
  numero: string;
  nome: string | null;
  nome_whatsapp: string | null;
  foto_url: string | null;
  stage_id: string | null;
  ultima_em: string | null;
  ultima_mensagem: string | null;
  aguardando_humano: boolean | null;
  ficha: Record<string, string> | null;
  ficha_resumo: string | null;
  ficha_proximo_passo: string | null;
};

const COL_CONTATO = "__contato";
const COL_ETAPA = "__etapa";
const COL_MOV = "__mov";

function PlanilhaPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id ?? "";

  const [campos, setCampos] = useState<FichaCampo[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [etapaFiltro, setEtapaFiltro] = useState("");
  const [soAguardando, setSoAguardando] = useState(false);
  const [ordem, setOrdem] = useState<{ col: string; asc: boolean }>({ col: COL_MOV, asc: false });
  const [editando, setEditando] = useState<{ cardId: string; campo: string } | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const salvarFichaFn = useServerFn(salvarFicha);

  async function carregar(cid: string) {
    const [{ data: cfg }, { data: st }, { data: cd }] = await Promise.all([
      supabase.from("agent_config").select("ficha_campos").eq("company_id", cid).maybeSingle(),
      supabase.from("crm_stage").select("id, nome, cor, ordem").eq("company_id", cid).order("ordem", { ascending: true }),
      supabase
        .from("crm_cards")
        .select("id, numero, nome, nome_whatsapp, foto_url, stage_id, ultima_em, ultima_mensagem, aguardando_humano, ficha, ficha_resumo, ficha_proximo_passo")
        .eq("company_id", cid)
        .order("ultima_em", { ascending: false }),
    ]);
    setCampos(normalizeFichaCampos((cfg as any)?.ficha_campos));
    setStages((st ?? []) as Stage[]);
    // Os tipos gerados do Supabase ainda não têm as colunas da migration de nome/foto.
    setCards((cd ?? []) as unknown as Card[]);
    setCarregando(false);
  }

  useEffect(() => {
    if (!companyId) return;
    void carregar(companyId);
    const ch = supabase
      .channel(`tenant:${companyId}:planilha`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_cards", filter: `company_id=eq.${companyId}` },
        () => void carregar(companyId),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [companyId]);

  useEffect(() => { if (editando) inputRef.current?.focus(); }, [editando]);

  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);
  const nomeDe = (c: Card) => c.nome || c.nome_whatsapp || c.numero;

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    let out = cards.filter((c) => {
      if (soAguardando && !c.aguardando_humano) return false;
      if (etapaFiltro && c.stage_id !== etapaFiltro) return false;
      if (!termo) return true;
      if (nomeDe(c).toLowerCase().includes(termo) || c.numero.includes(termo)) return true;
      return Object.values(c.ficha ?? {}).some((v) => String(v).toLowerCase().includes(termo));
    });
    const valor = (c: Card, col: string) => {
      if (col === COL_CONTATO) return nomeDe(c).toLowerCase();
      if (col === COL_ETAPA) return stageById[c.stage_id ?? ""]?.ordem ?? 999;
      if (col === COL_MOV) return c.ultima_em ? +new Date(c.ultima_em) : 0;
      return String(c.ficha?.[col] ?? "").toLowerCase();
    };
    out = [...out].sort((a, b) => {
      const va = valor(a, ordem.col), vb = valor(b, ordem.col);
      // Célula vazia sempre no fim: quem está preenchendo a planilha quer ver o que já tem.
      if (va === "" && vb !== "") return 1;
      if (vb === "" && va !== "") return -1;
      if (va < vb) return ordem.asc ? -1 : 1;
      if (va > vb) return ordem.asc ? 1 : -1;
      return 0;
    });
    return out;
  }, [cards, busca, etapaFiltro, soAguardando, ordem, stageById]);

  function abrirEdicao(c: Card, campo: string) {
    setEditando({ cardId: c.id, campo });
    setRascunho(c.ficha?.[campo] ?? "");
  }

  async function confirmar(c: Card, campo: string) {
    const novo = rascunho.trim();
    setEditando(null);
    if (novo === (c.ficha?.[campo] ?? "").trim()) return;
    const ficha = { ...(c.ficha ?? {}), [campo]: novo };
    // Pinta na hora e desfaz se o servidor recusar: digitar numa planilha tem que ser instantâneo.
    setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, ficha } : x)));
    setSalvando(`${c.id}:${campo}`);
    try {
      await salvarFichaFn({
        data: { numero: c.numero, ficha, resumo: c.ficha_resumo ?? "", proximoPasso: c.ficha_proximo_passo ?? "" },
      });
    } catch (e: any) {
      setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, ficha: c.ficha } : x)));
      toast.error(e?.message ?? "Não deu para salvar.");
    } finally {
      setSalvando(null);
    }
  }

  function ordenarPor(col: string) {
    setOrdem((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: true }));
  }

  const colunas: Array<{ id: string; label: string; largura: string; somenteEquipe?: boolean }> = [
    { id: COL_CONTATO, label: "Contato", largura: "min-w-[190px]" },
    { id: COL_ETAPA, label: "Etapa", largura: "min-w-[120px]" },
    ...campos.map((c) => ({ id: c.id, label: c.label, largura: "min-w-[150px]", somenteEquipe: c.somenteEquipe })),
    { id: COL_MOV, label: "Última movimentação", largura: "min-w-[150px]" },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Planilha de Leads
            <HelpTip text="Cada linha é um lead e cada coluna é um campo da ficha. A IA preenche o que descobre na conversa; você clica na célula para corrigir ou completar. As colunas saem dos campos definidos em Agente IA." />
          </h1>
          <p className="text-sm text-muted-foreground">
            Tudo o que a IA já apurou, numa tabela só — clique na célula para editar
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar em qualquer campo..."
              className="pl-8 w-56 h-9"
            />
          </div>
          <select
            value={etapaFiltro}
            onChange={(e) => setEtapaFiltro(e.target.value)}
            className="h-9 rounded-md border border-[color:var(--hairline)] bg-[color:var(--panel)] px-2 text-sm"
          >
            <option value="">Todas as etapas</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <Button
            variant={soAguardando ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => setSoAguardando((v) => !v)}
          >
            Aguardando humano
          </Button>
        </div>
      </header>

      <div className="border border-[color:var(--hairline)] rounded-2xl overflow-hidden bg-[color:var(--panel)]">
        <div className="overflow-auto max-h-[calc(100vh-230px)]">
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 z-20 bg-[color:var(--panel-2)]">
              <tr>
                {colunas.map((col, i) => (
                  <th
                    key={col.id}
                    onClick={() => ordenarPor(col.id)}
                    className={`${col.largura} text-left font-semibold px-3 py-2.5 whitespace-nowrap cursor-pointer select-none border-b border-[color:var(--hairline)] hover:bg-[color:var(--brand-soft)] ${
                      i === 0 ? "sticky left-0 z-30 bg-[color:var(--panel-2)]" : ""
                    }`}
                    title={col.somenteEquipe ? "Só a equipe preenche — a IA não mexe neste campo" : "Clique para ordenar"}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.somenteEquipe && <span className="text-[9px] uppercase tracking-wider opacity-60">equipe</span>}
                      {ordem.col === col.id && <ArrowUpDown className="size-3 opacity-70" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={colunas.length} className="px-3 py-10 text-center text-muted-foreground">
                  <Loader2 className="size-4 animate-spin inline mr-2" /> carregando…
                </td></tr>
              )}
              {!carregando && !linhas.length && (
                <tr><td colSpan={colunas.length} className="px-3 py-12 text-center text-muted-foreground">
                  <Sparkles className="size-5 mx-auto mb-2 opacity-50" />
                  {cards.length ? "Nenhum lead com esses filtros." : "Ainda não há leads. Assim que chegarem conversas, eles aparecem aqui."}
                </td></tr>
              )}
              {linhas.map((c) => {
                const stage = stageById[c.stage_id ?? ""];
                return (
                  <tr key={c.id} className="border-b border-[color:var(--hairline)] last:border-0 hover:bg-[color:var(--panel-2)]/60">
                    <td className="sticky left-0 z-10 bg-[color:var(--panel)] px-3 py-2">
                      <Link
                        to="/app/conversas"
                        search={{ numero: c.numero }}
                        className="flex items-center gap-2 group"
                        title="Abrir a conversa"
                      >
                        <InitialsAvatar name={nomeDe(c)} src={c.foto_url ?? undefined} className="size-7 text-[10px] shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium group-hover:underline">{nomeDe(c)}</span>
                          <span className="block text-[11px] text-muted-foreground">{c.numero}</span>
                        </span>
                        {c.aguardando_humano && (
                          <span className="ml-1 size-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="Aguardando humano" />
                        )}
                        <MessageSquareText className="size-3.5 opacity-0 group-hover:opacity-60 shrink-0" />
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {stage ? (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                          style={{ background: `${stage.cor ?? "#8AA89A"}22`, color: stage.cor ?? undefined }}
                        >
                          {stage.nome}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    {campos.map((campo) => {
                      const edit = editando?.cardId === c.id && editando.campo === campo.id;
                      const valor = c.ficha?.[campo.id] ?? "";
                      return (
                        <td
                          key={campo.id}
                          onClick={() => !edit && abrirEdicao(c, campo.id)}
                          className="px-3 py-2 align-top cursor-text hover:bg-[color:var(--brand-soft)]/40"
                        >
                          {edit ? (
                            <input
                              ref={inputRef}
                              value={rascunho}
                              onChange={(e) => setRascunho(e.target.value)}
                              onBlur={() => void confirmar(c, campo.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); void confirmar(c, campo.id); }
                                if (e.key === "Escape") setEditando(null);
                              }}
                              className="w-full bg-transparent outline-none border-b border-[color:var(--brand)] text-[13px]"
                            />
                          ) : (
                            <span className={valor ? "" : "text-muted-foreground/40"}>
                              {valor || "—"}
                              {salvando === `${c.id}:${campo.id}` && <Loader2 className="size-3 animate-spin inline ml-1.5" />}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground text-[12px]">
                      {c.ultima_em
                        ? new Date(c.ultima_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11.5px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
        <Sparkles className="size-3" />
        {linhas.length} {linhas.length === 1 ? "lead" : "leads"}
        {(busca || etapaFiltro || soAguardando) && (
          <button onClick={() => { setBusca(""); setEtapaFiltro(""); setSoAguardando(false); }} className="inline-flex items-center gap-1 underline">
            <X className="size-3" /> limpar filtros
          </button>
        )}
        · as colunas vêm dos campos da ficha, editáveis em Agente IA
      </p>
    </div>
  );
}
