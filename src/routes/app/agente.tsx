import { createFileRoute, redirect, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Bot, Loader2, Save, Send, Sparkles, Wand2, ChevronDown, Settings2, RefreshCcw, HelpCircle, ArrowLeft, CheckCircle2, BookOpen, Clock, CreditCard, ShoppingBag, Headphones, ArrowRightLeft, PhoneForwarded } from "lucide-react";
import { brand } from "@/config/brand";
import { buildSystemPrompt } from "@/lib/ai-prompt";
import { testAiReply } from "@/lib/evolution.functions";
import { testForwardSummary } from "@/lib/chat-copilot.functions";
import { generateAgentConfig, analyzeBusinessBrief, type BriefQuestion } from "@/lib/agent-ai.functions";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { defaultHours, DIA_LABEL, type BusinessHours } from "@/lib/business-hours";

export const Route = createFileRoute("/app/agente")({
  head: () => ({ meta: [{ title: `${brand.name} — Agente IA` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: AgenteRouteComponent,
});

function AgenteRouteComponent() {
  const state = useRouterState();
  if (state.location.pathname.startsWith("/app/agente/")) {
    return <Outlet />;
  }
  return <AgentePage />;
}

const PLACEHOLDER = `Ex: Tenho uma padaria artesanal na Vila Mariana, em São Paulo, aberta de seg a sáb das 6h às 20h. Vendo pães de fermentação natural, doces, bolos sob encomenda e cestas de café da manhã. Entrego em até 5km via Loggi. Quero que a IA atenda no WhatsApp: cumprimente, descubra o que o cliente quer, sugira combos, confirme endereço e mande o link de pagamento. Pode oferecer o cupom PADARIA10 quando fizer sentido.`;

function AgentePage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const generate = useServerFn(generateAgentConfig);
  const analyze = useServerFn(analyzeBusinessBrief);
  const test = useServerFn(testAiReply);

  const [loading, setLoading] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);
  const [cfg, setCfg] = useState<any>(null);
  const [descricao, setDescricao] = useState("");
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [promptPreview, setPromptPreview] = useState("");

  // PRD interview flow
  type Step = "descrever" | "entrevista" | "pronto";
  const [step, setStep] = useState<Step>("descrever");
  const [perguntas, setPerguntas] = useState<BriefQuestion[]>([]);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [resumoIA, setResumoIA] = useState("");
  const [cobertura, setCobertura] = useState(0);

  // Ajustes finos
  const [tamanhoResposta, setTamanhoResposta] = useState<"curtas" | "medias" | "longas">("curtas");
  const [telefone, setTelefone] = useState("");
  const [palavraPausar, setPalavraPausar] = useState("/pausar");
  const [palavraDespausar, setPalavraDespausar] = useState("/despausar");
  const [responderEmPartes, setResponderEmPartes] = useState(true);
  const [baseConhecimento, setBaseConhecimento] = useState("");
  const [horarios, setHorarios] = useState<BusinessHours>(defaultHours());
  const [msgFora, setMsgFora] = useState("Olá! No momento estamos fora do horário de atendimento. Retornamos em breve.");
  const [chavePix, setChavePix] = useState("");
  const [titularPix, setTitularPix] = useState("");
  const [instrucoesPagamento, setInstrucoesPagamento] = useState("");

  const [testMsg, setTestMsg] = useState("Oi, vocês entregam aqui?");
  const [testReply, setTestReply] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [focoAtendimento, setFocoAtendimento] = useState<"vendas" | "suporte" | "ambos">("vendas");
  const [testingForward, setTestingForward] = useState(false);
  const testForwardFn = useServerFn(testForwardSummary);

  async function reload() {
    if (!companyId) return;
    const { data } = await supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle();
    if (data && data.nome_agente && data.nome_agente.trim() && data.sobre_empresa) {
      setHasConfig(true);
      setCfg(data);
      setFocoAtendimento((data.foco_atendimento as any) || "vendas");
      setTamanhoResposta((data.tamanho_resposta as any) || "curtas");
      setTelefone(data.telefone_transferencia || "");
      setPalavraPausar(data.palavra_pausar || "/pausar");
      setPalavraDespausar(data.palavra_despausar || "/despausar");
      setResponderEmPartes(data.responder_em_partes ?? true);
      setBaseConhecimento((data as any).base_conhecimento || "");
      setHorarios((data as any).horarios_atendimento || defaultHours());
      setMsgFora((data as any).mensagem_fora_horario || "Olá! No momento estamos fora do horário de atendimento. Retornamos em breve.");
      setChavePix((data as any).chave_pix || "");
      setTitularPix((data as any).titular_pix || "");
      setInstrucoesPagamento((data as any).instrucoes_pagamento || "");
      setPromptPreview(buildSystemPrompt({ ...data, foco_atendimento: data.foco_atendimento || "vendas" } as any, { responderEmPartes: data.responder_em_partes ?? true, produtos: [] }));
    } else if (data) {
      setCfg(data);
      setFocoAtendimento((data.foco_atendimento as any) || "vendas");
      setBaseConhecimento((data as any).base_conhecimento || "");
      setHorarios((data as any).horarios_atendimento || defaultHours());
      setMsgFora((data as any).mensagem_fora_horario || "Olá! No momento estamos fora do horário de atendimento. Retornamos em breve.");
      setChavePix((data as any).chave_pix || "");
      setTitularPix((data as any).titular_pix || "");
      setInstrucoesPagamento((data as any).instrucoes_pagamento || "");
    }
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [companyId]);

  async function handleTestForward() {
    if (!telefone.trim()) {
      return toast.error("Informe um número de WhatsApp com DDD para testar o envio de resumo.");
    }
    setTestingForward(true);
    try {
      await testForwardFn({ data: { destinationNumber: telefone } });
      toast.success(`Mensagem de teste de resumo enviada com sucesso para o WhatsApp ${telefone}!`);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar teste de encaminhamento.");
    } finally {
      setTestingForward(false);
    }
  }

  async function runAnalyze() {
    if (descricao.trim().length < 20) {
      return toast.error("Conte um pouco mais sobre o negócio (mínimo ~20 caracteres).");
    }
    setAnalyzing(true);
    try {
      const a: any = await analyze({ data: { descricao, respostas: {} } });
      setResumoIA(a.resumo || "");
      setCobertura(a.cobertura || 0);
      setPerguntas(a.perguntas || []);
      if (a.pronto || !a.perguntas?.length) {
        // já dá pra gerar direto
        await runGenerate({});
      } else {
        setStep("entrevista");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao analisar");
    } finally {
      setAnalyzing(false);
    }
  }

  async function runGenerate(extraRespostas: Record<string, string>) {
    setGenerating(true);
    try {
      const merged = { ...respostas, ...extraRespostas };
      const r: any = await generate({ data: { descricao, respostas: merged } });
      setCfg((prev: any) => ({ ...(prev || {}), ...r.config }));
      setPromptPreview(r.promptPreview);
      setHasConfig(true);
      setStep("pronto");
      toast.success("Pronto! Sua IA foi montada com base no seu negócio.");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao gerar configuração");
    } finally {
      setGenerating(false);
    }
  }

  async function submitEntrevista() {
    // valida obrigatórias
    const faltando = perguntas.filter((q) => q.obrigatoria && !(respostas[q.id] || "").trim());
    if (faltando.length) {
      return toast.error(`Faltou responder: ${faltando[0].pergunta}`);
    }
    await runGenerate(respostas);
  }


  async function save() {
    if (!companyId || !cfg) return;
    setSaving(true);
    const payload = {
      ...cfg,
      foco_atendimento: focoAtendimento,
      tamanho_resposta: tamanhoResposta,
      telefone_transferencia: telefone,
      palavra_pausar: palavraPausar,
      palavra_despausar: palavraDespausar,
      responder_em_partes: responderEmPartes,
      base_conhecimento: baseConhecimento,
      horarios_atendimento: horarios,
      mensagem_fora_horario: msgFora,
      chave_pix: chavePix,
      titular_pix: titularPix,
      instrucoes_pagamento: instrucoesPagamento,
    };
    const { user_id: _u, company_id: _c, updated_at: _ua, ...rest } = payload;
    const { error } = await supabase.from("agent_config").upsert(
      { company_id: companyId, user_id: ctx.user.id, ...rest },
      { onConflict: "company_id" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Configuração salva");
    setPromptPreview(buildSystemPrompt(payload as any, { responderEmPartes, produtos: [] }));
  }

  async function runTest() {
    setTesting(true); setTestReply([]);
    try {
      const r = await test({ data: { message: testMsg } });
      setTestReply(r.parts);
    } catch (e: any) { toast.error(e?.message || "Falha"); }
    finally { setTesting(false); }
  }

  if (loading) return <div className="grid place-items-center h-40 text-muted-foreground"><Loader2 className="animate-spin" /></div>;

  // ---------- Tela inicial: descrição livre → análise PRD ----------
  if (!hasConfig) {
    if (step === "entrevista") {
      return (
        <div className="space-y-6 max-w-2xl mx-auto">
          <header className="space-y-2 pt-2">
            <button
              onClick={() => setStep("descrever")}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="size-3" /> Voltar e reescrever
            </button>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--brand-text)]">
              <HelpCircle className="size-3.5" /> Faltam alguns detalhes
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold">
              Pra IA não responder torto, me ajuda com isso
            </h1>
            {resumoIA && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Entendi até aqui:</span> {resumoIA}
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <div className="h-1.5 flex-1 rounded-full bg-[var(--panel-2)] overflow-hidden">
                <div
                  className="h-full bg-[var(--brand)] transition-all"
                  style={{ width: `${Math.max(15, cobertura)}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">{cobertura}%</span>
            </div>
          </header>

          <div className="space-y-3">
            {perguntas.map((q) => (
              <div
                key={q.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <Label className="text-sm font-medium leading-snug">
                    {q.pergunta}
                    {q.obrigatoria && <span className="text-[var(--brand-text)] ml-1">*</span>}
                  </Label>
                </div>
                {q.porque && (
                  <p className="text-[11.5px] text-muted-foreground">
                    <span className="font-medium">Por que importa:</span> {q.porque}
                  </p>
                )}
                <Textarea
                  value={respostas[q.id] || ""}
                  onChange={(e) => setRespostas((r) => ({ ...r, [q.id]: e.target.value }))}
                  placeholder={q.exemplo ? `Ex: ${q.exemplo}` : ""}
                  rows={2}
                  className="text-sm"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
            <button
              onClick={() => runGenerate(respostas)}
              disabled={generating}
              className="text-xs text-muted-foreground underline disabled:opacity-50"
            >
              Pular e gerar com o que tenho
            </button>
            <Button onClick={submitEntrevista} disabled={generating} size="lg">
              {generating ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Wand2 className="size-4 mr-2" />}
              Gerar atendimento da IA
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <header className="space-y-2 text-center pt-4">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--brand-text)]">
            <Sparkles className="size-3.5" /> Agente IA
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Conte sobre o seu negócio</h1>
          <p className="text-sm text-muted-foreground">
            Escreva do seu jeito. A IA vai ler, ver o que falta e te perguntar antes de montar — pra não responder torto depois.
          </p>
        </header>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
          <Label className="text-sm font-medium">
            Descreva seu negócio, como você atende e o que a IA deve fazer
          </Label>
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={10}
            className="text-sm leading-relaxed"
          />
          <div className="grid sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground">
            <Hint icon={<CheckCircle2 className="size-3" />} text="O que vende e preço" />
            <Hint icon={<CheckCircle2 className="size-3" />} text="Região e horário" />
            <Hint icon={<CheckCircle2 className="size-3" />} text="Como atende (entrega/agenda)" />
            <Hint icon={<CheckCircle2 className="size-3" />} text="Formas de pagamento" />
          </div>
          <div className="flex items-center justify-end gap-3 flex-wrap pt-1">
            <Button onClick={runAnalyze} disabled={analyzing || generating} size="lg">
              {analyzing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Wand2 className="size-4 mr-2" />}
              Analisar e treinar IA
            </Button>
          </div>
        </div>

        <div className="text-center">
          <Link to="/app/agente/avancado" className="text-xs text-muted-foreground underline">
            Prefiro preencher tudo manualmente (edição avançada)
          </Link>
        </div>
      </div>
    );
  }


  // ---------- Tela com config: resumo + ajustes finos + teste ----------
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold flex items-center gap-2">
            <HelpTip text="Configure o agente IA: nome, personalidade, papel, sobre a empresa, instruções e regras. É aqui que você 'treina' como ele responde." />
            <Bot className="size-5 text-[var(--brand-text)]" /> {cfg?.nome_agente || "Sua IA"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {cfg?.papel_objetivo || "Atendente virtual da sua empresa."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setHasConfig(false); setDescricao(""); setStep("descrever"); setPerguntas([]); setRespostas({}); setResumoIA(""); setCobertura(0); }}>
            <RefreshCcw className="size-3.5 mr-1.5" /> Refazer
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
            Salvar
          </Button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_minmax(340px,400px)] gap-6">
        <div className="space-y-4">
          <Section title="Modo de Atuação da IA (Vendedor vs Assistente)" icon={<ShoppingBag className="size-3.5" />}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Defina como a sua IA deve se comportar no WhatsApp: fechar vendas ativamente ou focar em atendimento e suporte cordial.
            </p>
            <div className="grid sm:grid-cols-3 gap-2.5 pt-1">
              {[
                {
                  id: "vendas",
                  label: "Vendedor Ativo",
                  badge: "Mais Vendas",
                  icon: <ShoppingBag className="size-4 text-emerald-500" />,
                  desc: "Postura ativa de fechamento. Quebra objeções, recomenda itens, sugere combos e envia PIX Copia e Cola para fechar pedidos na hora.",
                  color: "border-emerald-500/50 bg-emerald-500/10",
                },
                {
                  id: "suporte",
                  label: "Assistente de Atendimento",
                  badge: "Suporte",
                  icon: <Headphones className="size-4 text-sky-500" />,
                  desc: "Postura acolhedora e informativa. Esclarece dúvidas, tira dúvidas de horários, produtos e regras sem forçar compras nem insistir em pagamentos.",
                  color: "border-sky-500/50 bg-sky-500/10",
                },
                {
                  id: "ambos",
                  label: "Modo Híbrido",
                  badge: "Equilibrado",
                  icon: <ArrowRightLeft className="size-4 text-purple-500" />,
                  desc: "Equilíbrio inteligente: resolve dúvidas primeiro com atenção e conduz para a venda caso o cliente demonstre interesse de compra.",
                  color: "border-purple-500/50 bg-purple-500/10",
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFocoAtendimento(opt.id as any)}
                  className={`text-left rounded-xl border p-3.5 transition flex flex-col justify-between ${
                    focoAtendimento === opt.id
                      ? `${opt.color} ring-1 ring-[var(--brand)] shadow-sm`
                      : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--brand)]/50 opacity-80 hover:opacity-100"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                        {opt.icon}
                        {opt.label}
                      </span>
                      {focoAtendimento === opt.id && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--brand)] text-primary-foreground">
                          Ativo
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="O que a IA aprendeu" icon={<Sparkles className="size-3.5" />}>
            <SummaryRow label="Empresa" value={cfg?.nome_empresa} />
            <SummaryRow label="Segmento" value={cfg?.segmento} />
            <SummaryRow label="Região / horário" value={cfg?.regiao_horario} />
            <SummaryRow label="Sobre" value={cfg?.sobre_empresa} multiline />
            <SummaryRow label="Produtos / serviços" value={cfg?.produtos_servicos} multiline />
            <SummaryRow label="Como vende" value={cfg?.como_vender} multiline />
            <SummaryRow label="Pode fazer" value={cfg?.pode_fazer} multiline />
            <SummaryRow label="Não pode fazer" value={cfg?.nao_pode_fazer} multiline />
          </Section>

          <Section title="Base de Conhecimento & FAQ (RAG)" icon={<BookOpen className="size-3.5" />}>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Perguntas frequentes, tabelas de preços, normas ou procedimentos para a IA consultar ao responder clientes.
              </Label>
              <Textarea
                value={baseConhecimento}
                onChange={(e) => setBaseConhecimento(e.target.value)}
                rows={5}
                placeholder="Exemplo:&#10;Q: Qual o valor da taxa de entrega?&#10;R: A taxa de entrega é R$ 8,00 para até 5km.&#10;&#10;Q: Aceitam PIX?&#10;R: Sim, aceitamos PIX e todos os cartões de crédito."
                className="bg-[var(--panel-2)] text-xs font-mono"
              />
            </div>
          </Section>

          <Section title="Horário de Atendimento & Mensagem de Ausência" icon={<Clock className="size-3.5" />}>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                <div>
                  <div className="text-sm font-medium">Controle de Horário Ativo</div>
                  <div className="text-xs text-muted-foreground">Fora destes horários, o sistema enviará a mensagem de ausência e não chamará a IA.</div>
                </div>
                <Switch checked={horarios.enabled} onCheckedChange={(v) => setHorarios((prev) => ({ ...prev, enabled: v }))} />
              </div>

              {horarios.enabled && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Horários por dia da semana</Label>
                    <div className="grid gap-2">
                      {["1", "2", "3", "4", "5", "6", "0"].map((d) => {
                        const daySched = horarios.dias[d];
                        const isOpen = !!daySched;
                        return (
                          <div key={d} className="flex items-center justify-between gap-3 text-xs bg-[var(--panel-2)] p-2.5 rounded-lg border border-[var(--border)]">
                            <div className="w-24 font-medium">{DIA_LABEL[d]}</div>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isOpen}
                                  onChange={(e) => {
                                    const nextDias = { ...horarios.dias };
                                    if (e.target.checked) {
                                      nextDias[d] = { abre: "09:00", fecha: "18:00" };
                                    } else {
                                      nextDias[d] = null;
                                    }
                                    setHorarios({ ...horarios, dias: nextDias });
                                  }}
                                  className="rounded"
                                />
                                <span>{isOpen ? "Aberto" : "Fechado"}</span>
                              </label>
                              {isOpen && (
                                <div className="flex items-center gap-1.5 ml-2">
                                  <Input
                                    type="time"
                                    value={daySched.abre}
                                    onChange={(e) => {
                                      const nextDias = { ...horarios.dias };
                                      nextDias[d] = { ...daySched, abre: e.target.value };
                                      setHorarios({ ...horarios, dias: nextDias });
                                    }}
                                    className="h-7 w-24 text-xs py-0 px-1"
                                  />
                                  <span>às</span>
                                  <Input
                                    type="time"
                                    value={daySched.fecha}
                                    onChange={(e) => {
                                      const nextDias = { ...horarios.dias };
                                      nextDias[d] = { ...daySched, fecha: e.target.value };
                                      setHorarios({ ...horarios, dias: nextDias });
                                    }}
                                    className="h-7 w-24 text-xs py-0 px-1"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label className="text-xs font-semibold">Mensagem automática fora do expediente</Label>
                    <Textarea
                      value={msgFora}
                      onChange={(e) => setMsgFora(e.target.value)}
                      rows={2}
                      placeholder="Olá! No momento estamos fora do horário de atendimento. Retornamos em breve."
                      className="bg-[var(--panel-2)] text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section title="Vendas & Pagamento Instantâneo (PIX)" icon={<CreditCard className="size-3.5" />}>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Configure os dados oficiais para que a IA feche pedidos, passe a chave PIX de forma limpa e oriente o cliente a enviar o comprovante.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Chave PIX (Telefone, CNPJ, CPF, Email ou Chave Aleatória)</Label>
                  <Input
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                    placeholder="Ex: 11999998888 ou pix@empresa.com"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Nome do Titular / Razão Social</Label>
                  <Input
                    value={titularPix}
                    onChange={(e) => setTitularPix(e.target.value)}
                    placeholder="Ex: Espaço Cinthia França LTDA"
                    className="text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Instruções de Pagamento / Entrega</Label>
                <Textarea
                  value={instrucoesPagamento}
                  onChange={(e) => setInstrucoesPagamento(e.target.value)}
                  rows={2}
                  placeholder="Ex: Envie o comprovante aqui para liberarmos imediatamente. Entrega via motoboy em até 2h ou envio pelos Correios."
                  className="bg-[var(--panel-2)] text-xs"
                />
              </div>
            </div>
          </Section>

          <Section title="Encaminhamento & Transbordo com Resumo Inteligente" icon={<PhoneForwarded className="size-3.5" />}>
            <div className="space-y-3.5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Quando um cliente pedir atendimento humano ou precisar de um atendente, a IA gera automaticamente um <b>resumo executivo</b> com o perfil, interesse e pontos discutidos e encaminha para o WhatsApp abaixo com o link para você assumir a conversa.
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">WhatsApp de Destino para Receber os Resumos (com DDD)</Label>
                <div className="flex gap-2">
                  <Input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="Ex: 11999990000 ou +55 11 99999-0000"
                    className="text-xs font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTestForward()}
                    disabled={testingForward || !telefone.trim()}
                    className="shrink-0 text-xs gap-1.5 border-[var(--brand)]/40 hover:bg-[var(--brand)]/10"
                  >
                    {testingForward ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    Testar Envio
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1">
                <div className="font-semibold text-foreground flex items-center gap-1">
                  💡 <span>Como a IA encaminha:</span>
                </div>
                <p>
                  A IA pausa as respostas automáticas para não atrapalhar o humano (e volta sozinha após 30 minutos sem resposta de um atendente) e envia uma mensagem formatada contendo: <b>Nome do cliente, WhatsApp, etapa no CRM e o resumo inteligente do que ele precisa</b> com link direto para abrir no WhatsApp.
                </p>
              </div>
            </div>
          </Section>

          <Collapsible>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
              <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-[var(--panel-2)] transition">
                <span className="font-display text-[12px] font-semibold uppercase tracking-wider text-[var(--brand-text)] flex items-center gap-1.5">
                  <Settings2 className="size-3.5" /> Ajustes finos
                </span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-5 pb-5 space-y-4 border-t border-[var(--border)] pt-4">
                <div className="space-y-1.5">
                  <Label>Tom das respostas</Label>
                  <Select value={tamanhoResposta} onValueChange={(v) => setTamanhoResposta(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="curtas">Curtas (estilo WhatsApp)</SelectItem>
                      <SelectItem value="medias">Médias</SelectItem>
                      <SelectItem value="longas">Longas (explicativas)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Palavra para pausar IA</Label>
                    <Input value={palavraPausar} onChange={(e) => setPalavraPausar(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Palavra para despausar</Label>
                    <Input value={palavraDespausar} onChange={(e) => setPalavraDespausar(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                  <span className="text-sm font-medium">Responder em partes (1-3 bolhas)</span>
                  <Switch checked={responderEmPartes} onCheckedChange={setResponderEmPartes} />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <div className="text-center">
            <Link to="/app/agente/avancado" className="text-xs text-muted-foreground underline">
              Edição avançada (todos os campos)
            </Link>
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <Section title="Testar resposta" icon={<Sparkles className="size-3.5" />}>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 space-y-2 min-h-[140px]">
              <div className="flex justify-end">
                <div className="max-w-[78%] bg-[var(--panel)] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px]">{testMsg}</div>
              </div>
              {testReply.map((p, i) => (
                <div key={i} className="flex justify-start gap-2 items-end">
                  <InitialsAvatar name="IA" size={24} />
                  <div className="max-w-[78%] bg-[var(--brand)]/15 text-foreground rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px]">{p}</div>
                </div>
              ))}
              {testing && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="size-3 animate-spin" />pensando…</div>}
            </div>
            <div className="flex gap-2 mt-3">
              <Input value={testMsg} onChange={(e) => setTestMsg(e.target.value)} placeholder="Mensagem do cliente…" />
              <Button onClick={runTest} disabled={testing} size="icon">
                {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Salve a configuração antes de testar para usar as últimas alterações.
            </p>
          </Section>

          <Collapsible>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
              <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-[var(--panel-2)] transition">
                <span className="font-display text-[12px] font-semibold uppercase tracking-wider text-[var(--brand-text)] flex items-center gap-1.5">
                  <Bot className="size-3.5" /> Ver prompt gerado
                </span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="font-mono text-[11px] leading-relaxed text-[var(--brand-text)] whitespace-pre-wrap max-h-[360px] overflow-auto p-4 border-t border-[var(--border)]">
{promptPreview}
                </pre>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
      {title && (
        <h3 className="font-display text-[12px] font-semibold uppercase tracking-wider text-[var(--brand-text)] flex items-center gap-1.5">
          {icon}{title}
        </h3>
      )}
      {children}
    </div>
  );
}

function SummaryRow({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm ${multiline ? "whitespace-pre-wrap leading-relaxed" : ""}`}>{value}</div>
    </div>
  );
}

function Hint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-[var(--panel-2)] px-2 py-1.5">
      <span className="text-[var(--brand-text)]">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  );
}

