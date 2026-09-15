import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { Bot, Loader2, Save, Send, Sparkles, Plus, Trash2, Calendar, CheckCircle2, AlertCircle, LinkIcon } from "lucide-react";
import { brand } from "@/config/brand";
import { buildSystemPrompt } from "@/lib/ai-prompt";
import { testAiReply } from "@/lib/evolution.functions";
import { startGoogleOAuth, disconnectGoogle } from "@/lib/google.functions";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { usePlanFeatures } from "@/hooks/use-plan-features";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/app/agente/avancado")({
  head: () => ({ meta: [{ title: `${brand.name} — Agente IA` }] }),
  beforeLoad: ({ context }: any) => {
    const r = context?.membership?.role;
    if (r === "atendente") throw redirect({ to: "/app/dashboard" });
  },
  component: AgentePage,
});

const DEFAULTS: any = {
  ai_provider: "gemini", ai_model: "google/gemini-2.5-flash",
  openai_api_key: "", anthropic_api_key: "",
  nome_agente: "Atendente Virtual", nome_empresa: "",
  papel_objetivo: "Atender clientes, descobrir o que precisam, recomendar com sentido e ajudar a fechar a venda.",
  estilo_comunicacao: "Humano, simpático, consultivo e direto.",
  sobre_empresa: "", produtos_servicos: "", pode_fazer: "",
  nao_pode_fazer: "Inventar preço, prazo ou política que não está no prompt.",
  telefone_transferencia: "", palavra_pausar: "/pausar", palavra_despausar: "/despausar",
  segundos_buffer: 8, responder_em_partes: true,
  segmento: "", descricao_negocio: "", diferenciais: "", publico_alvo: "", regiao_horario: "",
  ofertas: "", cupom: "", como_vender: "", objecoes: "", formas_pagamento: "", ticket_medio: "",
  faq: "", politicas: "", posvenda_msg: "", pedir_avaliacao: false, reativar_cliente: false,
  tom: 70, formalidade: 40, usar_emojis: true, tamanho_resposta: "curtas", apresentacao: "",
  personalidade: "padrao", foco_atendimento: "ambos", emoji_intensidade: "pouco",
  usar_girias: false, chamar_por_nome: true, perguntar_uma_por_vez: true,
  pode_brincar: false, assinar_mensagens: false, proatividade: 50,
  velocidade_resposta: "humana", evitar_palavras: "", idioma: "pt-BR",
  agendamento_ativo: false, servicos_agendaveis: "", duracao_padrao: "30 min",
  horarios_disponiveis: "", antecedencia_min: "2 horas",
};


const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  gemini: [
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (rápido — grátis)" },
    { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (econômico)" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (mais inteligente)" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini (rápido e barato)" },
    { value: "gpt-4o", label: "GPT-4o (premium)" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
  anthropic: [
    { value: "claude-opus-5", label: "Claude Opus 5 (mais inteligente)" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5 (equilíbrio)" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (mais rápido e barato)" },
  ],
};

const BUFFER_PRESETS = [3, 5, 10, 20, 30];

interface PersonalidadePreset {
  value: string;
  label: string;
  emoji: string;
  desc: string;
  tom: number;
  formalidade: number;
  emoji_intensidade: string;
  usar_girias: boolean;
  pode_brincar: boolean;
  proatividade: number;
}

const PERSONALIDADE_PRESETS: PersonalidadePreset[] = [
  { value: "padrao",       label: "Padrão",       emoji: "🤝", desc: "Equilibrado — simpático e profissional.",      tom: 65, formalidade: 45, emoji_intensidade: "pouco",    usar_girias: false, pode_brincar: false, proatividade: 50 },
  { value: "extrovertido", label: "Extrovertido", emoji: "🎉", desc: "Animado, vibrante, transmite energia.",          tom: 90, formalidade: 25, emoji_intensidade: "moderado", usar_girias: true,  pode_brincar: true,  proatividade: 75 },
  { value: "serio",        label: "Sério",        emoji: "🎩", desc: "Profissional, objetivo, direto ao ponto.",       tom: 25, formalidade: 75, emoji_intensidade: "nenhum",   usar_girias: false, pode_brincar: false, proatividade: 40 },
  { value: "divertido",    label: "Divertido",    emoji: "😄", desc: "Leve, bem-humorado, brincalhão sem perder foco.",tom: 85, formalidade: 20, emoji_intensidade: "muito",    usar_girias: true,  pode_brincar: true,  proatividade: 65 },
  { value: "consultivo",   label: "Consultivo",   emoji: "🧠", desc: "Especialista, recomenda com fundamento.",         tom: 55, formalidade: 60, emoji_intensidade: "pouco",    usar_girias: false, pode_brincar: false, proatividade: 70 },
  { value: "amigavel",     label: "Amigável",     emoji: "🫶", desc: "Acolhedor, próximo, como um amigo prestativo.",   tom: 80, formalidade: 30, emoji_intensidade: "moderado", usar_girias: false, pode_brincar: false, proatividade: 55 },
];

function applyPreset(p: PersonalidadePreset, cfg: any, setCfg: (fn: any) => void) {
  setCfg({
    ...cfg,
    personalidade: p.value,
    tom: p.tom,
    formalidade: p.formalidade,
    emoji_intensidade: p.emoji_intensidade,
    usar_emojis: p.emoji_intensidade !== "nenhum",
    usar_girias: p.usar_girias,
    pode_brincar: p.pode_brincar,
    proatividade: p.proatividade,
  });
}


interface Produto { id: string; nome: string; preco: number; descricao: string | null; ativo: boolean; ordem: number; imagem_url?: string | null; }

function AgentePage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const test = useServerFn(testAiReply);
  const gStart = useServerFn(startGoogleOAuth);
  const gDisc = useServerFn(disconnectGoogle);
  const plan = usePlanFeatures();
  const allowOpenAI = plan.features.providersIA.includes("openai");
  const allowAnthropic = plan.features.providersIA.includes("anthropic");
  const allowGoogleCal = plan.features.googleCalendar;
  const [cfg, setCfg] = useState<any>(DEFAULTS);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [google, setGoogle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testMsg, setTestMsg] = useState("Oi, vocês entregam aqui?");
  const [testReply, setTestReply] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);

  async function reload() {
    if (!companyId) return;
    const [{ data: c }, { data: p }, { data: g }] = await Promise.all([
      supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      supabase.from("produto").select("*").eq("company_id", companyId).order("ordem", { ascending: true }),
      supabase.from("google_integration").select("company_id,email,conectado,calendar_id,expiry,updated_at").eq("company_id", companyId).maybeSingle(),
    ]);
    if (c) {
      const formatField = (val: any) => {
        if (!val) return "";
        if (typeof val === "string") return val;
        if (Array.isArray(val)) {
          return val
            .map((item: any) => {
              if (typeof item === "string") return item;
              if (item.objecao && item.resposta) return `• ${item.objecao}: ${item.resposta}`;
              if (item.pergunta && item.resposta) return `• P: ${item.pergunta}\n  R: ${item.resposta}`;
              return JSON.stringify(item);
            })
            .join("\n\n");
        }
        return typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      };
      setCfg({
        ...DEFAULTS,
        ...c,
        objecoes: formatField(c.objecoes),
        faq: formatField(c.faq),
        politicas: formatField(c.politicas),
      });
    }
    setProdutos((p ?? []) as Produto[]);
    setGoogle(g);
    setLoading(false);
  }

  useEffect(() => { void reload(); }, [companyId]);

  function up(k: string, v: any) { setCfg((p: any) => ({ ...p, [k]: v })); }

  async function save() {
    if (!companyId) return;
    setSaving(true);
    const { user_id: _u, company_id: _c, updated_at: _ua, ...payload } = cfg;
    const { error } = await supabase.from("agent_config").upsert(
      { company_id: companyId, user_id: ctx.user.id, ...payload }, { onConflict: "company_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Configuração salva");
  }

  async function runTest() {
    setTesting(true); setTestReply([]);
    try {
      const r = await test({ data: { message: testMsg } });
      setTestReply(r.parts);
    } catch (e: any) { toast.error(e?.message || "Falha"); }
    finally { setTesting(false); }
  }

  // Produtos CRUD
  async function addProduto() {
    if (!companyId) return;
    const { error } = await supabase.from("produto").insert({
      company_id: companyId, nome: "Novo produto", preco: 0, ordem: produtos.length,
    });
    if (error) return toast.error(error.message);
    reload();
  }
  async function updProduto(id: string, patch: Partial<Produto>) {
    setProdutos((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } : p));
    await (supabase.from("produto") as any).update(patch).eq("id", id);
  }
  async function delProduto(id: string) {
    await supabase.from("produto").delete().eq("id", id);
    reload();
  }

  async function connectGoogle() {
    try {
      const r: any = await gStart({});
      if (!r.ok) return toast.error(r.error);
      window.location.href = r.url;
    } catch (e: any) { toast.error(e?.message || "Falha"); }
  }
  async function disconnectG() {
    await gDisc({}); toast.success("Google desconectado"); reload();
  }

  if (loading) return <div className="grid place-items-center h-40 text-muted-foreground"><Loader2 className="animate-spin" /></div>;

  const promptPreview = buildSystemPrompt(cfg, {
    responderEmPartes: cfg.responder_em_partes,
    produtos: produtos.filter((p) => p.ativo).map((p) => ({ nome: p.nome, preco: p.preco, descricao: p.descricao, imagem_url: p.imagem_url })),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1>Agente IA</h1>
          <p className="text-sm text-muted-foreground">Configure como sua IA conversa e vende.</p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />} Salvar
        </Button>
      </header>

      <div className="grid lg:grid-cols-[1fr_minmax(380px,440px)] gap-6">
        <div>
          <Tabs defaultValue="modelo">
            <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
              {[["modelo","Modelo IA"],["negocio","Negócio"],["produtos","Produtos"],["ofertas","Ofertas"],["vendas","Vendas"],
                ["suporte","Suporte"],["posvenda","Pós-venda"],["personalidade","Personalidade"],
                ["agendamento","Agendamento"],["regras","Regras"]].map(([k,l]) => (
                <TabsTrigger key={k} value={k} className="text-sm">{l}</TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="modelo" className="space-y-3">
              <Section title="Cérebro da IA" icon={<Sparkles className="size-3.5" />}>
                <div className="space-y-1.5">
                  <Label>Provedor</Label>
                  <Select value={cfg.ai_provider} onValueChange={(v) => { up("ai_provider", v); up("ai_model", PROVIDER_MODELS[v]?.[0]?.value || ""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Google Gemini — incluso, sem custo extra</SelectItem>
                      <SelectItem value="openai" disabled={!allowOpenAI}>
                        OpenAI (GPT) — sua chave{!allowOpenAI ? " · Pro/Business" : ""}
                      </SelectItem>
                      <SelectItem value="anthropic" disabled={!allowAnthropic}>
                        Anthropic (Claude){!allowAnthropic ? " · Pro/Business" : ""}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Gemini é o padrão e já vem incluso. {(!allowOpenAI || !allowAnthropic) && (
                      <>GPT e Claude exigem o plano Pro. <Link to="/app/checkout" className="underline">Fazer upgrade</Link>.</>
                    )}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Modelo</Label>
                  <Select value={cfg.ai_model} onValueChange={(v) => up("ai_model", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(PROVIDER_MODELS[cfg.ai_provider] || PROVIDER_MODELS.gemini).map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {cfg.ai_provider === "openai" && (
                  <div className="space-y-1.5">
                    <Label>Chave OpenAI (sk-...)</Label>
                    <Input type="password" value={cfg.openai_api_key} onChange={(e) => up("openai_api_key", e.target.value)} placeholder="sk-..." />
                    <p className="text-xs text-muted-foreground">Pegue em platform.openai.com → API Keys. A chave fica salva apenas para sua empresa.</p>
                  </div>
                )}
                {cfg.ai_provider === "anthropic" && (
                  <div className="space-y-1.5">
                    <Label>Chave Anthropic própria (opcional)</Label>
                    <Input type="password" value={cfg.anthropic_api_key} onChange={(e) => up("anthropic_api_key", e.target.value)} placeholder="Vazio = usa a chave do sistema" />
                    <p className="text-xs text-muted-foreground">Deixe vazio para usar a chave configurada no servidor (ANTHROPIC_API_KEY). Para usar uma chave só desta empresa, pegue em console.anthropic.com → API Keys.</p>
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  <Label>Tempo de espera antes de responder</Label>
                  <p className="text-xs text-muted-foreground">A IA aguarda esse tempo para juntar mensagens enviadas em sequência e responder de uma vez só — parece mais humano.</p>
                  <div className="flex flex-wrap gap-2">
                    {BUFFER_PRESETS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => up("segundos_buffer", s)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition ${cfg.segundos_buffer === s ? "bg-[var(--brand)] text-white border-transparent" : "bg-[var(--panel-2)] border-[var(--border)] hover:border-[var(--brand)]"}`}
                      >{s}s</button>
                    ))}
                  </div>
                  <Slider value={[cfg.segundos_buffer]} max={30} step={1} onValueChange={([x]) => up("segundos_buffer", x)} />
                  <div className="text-xs text-muted-foreground font-mono text-right">{cfg.segundos_buffer}s</div>
                </div>
              </Section>
            </TabsContent>


            <TabsContent value="negocio" className="space-y-3">
              <Section>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Nome do agente" value={cfg.nome_agente} onChange={(v) => up("nome_agente", v)} />
                  <Field label="Nome da empresa" value={cfg.nome_empresa} onChange={(v) => up("nome_empresa", v)} />
                  <Field label="Segmento" value={cfg.segmento} onChange={(v) => up("segmento", v)} />
                  <Field label="Região / horário de atendimento" value={cfg.regiao_horario} onChange={(v) => up("regiao_horario", v)} />
                </div>
                <Area label="Descrição do negócio" value={cfg.descricao_negocio} onChange={(v) => up("descricao_negocio", v)} rows={3} />
                <Area label="Diferenciais" value={cfg.diferenciais} onChange={(v) => up("diferenciais", v)} rows={2} />
                <Area label="Público-alvo" value={cfg.publico_alvo} onChange={(v) => up("publico_alvo", v)} rows={2} />
                <Area label="Sobre a empresa (texto livre)" value={cfg.sobre_empresa} onChange={(v) => up("sobre_empresa", v)} rows={3} />
              </Section>
            </TabsContent>

            <TabsContent value="produtos" className="space-y-3">
              <Section>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Catálogo real usado pela IA.</p>
                  <Button size="sm" onClick={addProduto}><Plus className="size-4 mr-1" />Novo produto</Button>
                </div>
                <div className="space-y-2">
                  {produtos.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">Nenhum produto cadastrado.</div>}
                  {produtos.map((p) => (
                    <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 grid sm:grid-cols-[1fr_120px_auto_auto] gap-2 items-center">
                      <Input value={p.nome} onChange={(e) => updProduto(p.id, { nome: e.target.value })} placeholder="Nome do produto ou serviço" />
                      <Input type="number" value={p.preco} onChange={(e) => updProduto(p.id, { preco: Number(e.target.value) || 0 })} placeholder="Preço (R$)" />
                      <Switch checked={p.ativo} onCheckedChange={(v) => updProduto(p.id, { ativo: v })} />
                      <button onClick={() => delProduto(p.id)} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="size-4" /></button>
                      <Input className="sm:col-span-4" value={p.imagem_url ?? ""} onChange={(e) => updProduto(p.id, { imagem_url: e.target.value })} placeholder="URL da foto/imagem do produto (opcional - a IA enviará no WhatsApp ao apresentar)" />
                      <Textarea className="sm:col-span-4" rows={2} value={p.descricao ?? ""} onChange={(e) => updProduto(p.id, { descricao: e.target.value })} placeholder="Descrição detalhada e diferenciais" />
                    </div>
                  ))}
                </div>
                <Area label="Produtos/serviços (texto livre — fallback)" value={cfg.produtos_servicos} onChange={(v) => up("produtos_servicos", v)} rows={3} />
              </Section>
            </TabsContent>

            <TabsContent value="ofertas" className="space-y-3">
              <Section>
                <Area label="Ofertas ativas" value={cfg.ofertas} onChange={(v) => up("ofertas", v)} rows={4} />
                <Field label="Cupom" value={cfg.cupom} onChange={(v) => up("cupom", v)} />
              </Section>
            </TabsContent>

            <TabsContent value="vendas" className="space-y-3">
              <Section>
                <Area label="Como vender (passo a passo)" value={cfg.como_vender} onChange={(v) => up("como_vender", v)} rows={4} />
                <Area label="Objeções comuns e respostas" value={cfg.objecoes} onChange={(v) => up("objecoes", v)} rows={4} />
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Formas de pagamento" value={cfg.formas_pagamento} onChange={(v) => up("formas_pagamento", v)} />
                  <Field label="Ticket médio" value={cfg.ticket_medio} onChange={(v) => up("ticket_medio", v)} />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Chave PIX (Telefone, CNPJ, CPF, Email ou Aleatória)" value={cfg.chave_pix} onChange={(v) => up("chave_pix", v)} />
                  <Field label="Nome do Titular da Conta / Razão Social" value={cfg.titular_pix} onChange={(v) => up("titular_pix", v)} />
                </div>
                <Area label="Instruções de Pagamento / Entrega" value={cfg.instrucoes_pagamento} onChange={(v) => up("instrucoes_pagamento", v)} rows={2} />
              </Section>
            </TabsContent>

            <TabsContent value="suporte" className="space-y-3">
              <Section>
                <Area label="FAQ" value={cfg.faq} onChange={(v) => up("faq", v)} rows={5} />
                <Area label="Políticas (troca/cancelamento/garantia)" value={cfg.politicas} onChange={(v) => up("politicas", v)} rows={4} />
              </Section>
            </TabsContent>

            <TabsContent value="posvenda" className="space-y-3">
              <Section>
                <Area label="Mensagem de pós-venda" value={cfg.posvenda_msg} onChange={(v) => up("posvenda_msg", v)} rows={3} />
                <Toggle label="Pedir avaliação após venda" v={cfg.pedir_avaliacao} on={(v) => up("pedir_avaliacao", v)} />
                <Toggle label="Reativar clientes inativos" v={cfg.reativar_cliente} on={(v) => up("reativar_cliente", v)} />
              </Section>
            </TabsContent>

            <TabsContent value="personalidade" className="space-y-3">
              <Section title="Preset de personalidade" icon={<Sparkles className="size-3.5" />}>
                <p className="text-xs text-muted-foreground">Escolha um perfil base. Você refina os detalhes abaixo.</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  {PERSONALIDADE_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => applyPreset(p, cfg, setCfg)}
                      className={`text-left rounded-xl border p-3 transition ${cfg.personalidade === p.value ? "border-[var(--brand)] bg-[var(--brand)]/10" : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--brand)]/60"}`}
                    >
                      <div className="text-lg">{p.emoji}</div>
                      <div className="font-semibold text-sm mt-1">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Foco do atendimento" icon={<Bot className="size-3.5" />}>
                <p className="text-xs text-muted-foreground">Define a missão principal da IA em cada conversa.</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  {[
                    { v: "vendas", l: "🎯 Vendas", d: "Qualifica, gera interesse e conduz pro fechamento." },
                    { v: "suporte", l: "🛟 Suporte", d: "Resolve dúvidas e problemas com clareza." },
                    { v: "ambos", l: "🔀 Híbrido", d: "Identifica intenção e atua nos dois sentidos." },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => up("foco_atendimento", o.v)}
                      className={`text-left rounded-xl border p-3 transition ${cfg.foco_atendimento === o.v ? "border-[var(--brand)] bg-[var(--brand)]/10" : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--brand)]/60"}`}
                    >
                      <div className="font-semibold text-sm">{o.l}</div>
                      <div className="text-[11px] text-muted-foreground">{o.d}</div>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Ajustes finos de estilo">
                <SliderRow label="Tom (sério → caloroso)" v={cfg.tom} on={(v) => up("tom", v)} />
                <SliderRow label="Formalidade (informal → formal)" v={cfg.formalidade} on={(v) => up("formalidade", v)} />
                <SliderRow label="Proatividade (reativo → vendedor)" v={cfg.proatividade ?? 50} on={(v) => up("proatividade", v)} />

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Tamanho das respostas</Label>
                    <Select value={cfg.tamanho_resposta} onValueChange={(v) => up("tamanho_resposta", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="curtas">Curtas (WhatsApp)</SelectItem>
                        <SelectItem value="medias">Médias</SelectItem>
                        <SelectItem value="longas">Longas (explicativas)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Uso de emojis</Label>
                    <Select value={cfg.emoji_intensidade ?? "pouco"} onValueChange={(v) => { up("emoji_intensidade", v); up("usar_emojis", v !== "nenhum"); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhum">Nenhum</SelectItem>
                        <SelectItem value="pouco">Pouco (raro)</SelectItem>
                        <SelectItem value="moderado">Moderado (1 por msg)</SelectItem>
                        <SelectItem value="muito">Muito (vivo)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Velocidade de resposta</Label>
                    <Select value={cfg.velocidade_resposta ?? "humana"} onValueChange={(v) => up("velocidade_resposta", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="imediata">Imediata (rápido)</SelectItem>
                        <SelectItem value="humana">Humana (natural)</SelectItem>
                        <SelectItem value="pausada">Pausada (pensativa)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Idioma</Label>
                    <Select value={cfg.idioma ?? "pt-BR"} onValueChange={(v) => up("idioma", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pt-BR">Português (BR)</SelectItem>
                        <SelectItem value="pt-PT">Português (PT)</SelectItem>
                        <SelectItem value="es">Espanhol</SelectItem>
                        <SelectItem value="en">Inglês</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Section>

              <Section title="Tempo de espera (entender contexto)">
                <p className="text-xs text-muted-foreground">
                  A IA aguarda esse tempo antes de responder. Se o cliente mandar várias mensagens em sequência, ela junta tudo e responde uma vez só — entendendo o contexto completo da conversa, como faz uma pessoa de verdade.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { s: 3,  l: "Instantâneo", d: "3s" },
                    { s: 5,  l: "Rápido",      d: "5s" },
                    { s: 10, l: "Humano",      d: "10s" },
                    { s: 20, l: "Pensativo",   d: "20s" },
                    { s: 30, l: "Calmo",       d: "30s" },
                  ].map((o) => (
                    <button
                      key={o.s}
                      type="button"
                      onClick={() => up("segundos_buffer", o.s)}
                      className={`rounded-xl border p-3 text-center transition ${cfg.segundos_buffer === o.s ? "border-[var(--brand)] bg-[var(--brand)]/10" : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--brand)]/60"}`}
                    >
                      <div className="font-display text-lg font-semibold">{o.d}</div>
                      <div className="text-[11px] text-muted-foreground">{o.l}</div>
                    </button>
                  ))}
                </div>
                <Slider value={[cfg.segundos_buffer]} max={60} step={1} onValueChange={([x]) => up("segundos_buffer", x)} />
                <div className="text-xs text-muted-foreground font-mono text-right">{cfg.segundos_buffer}s antes de responder</div>
              </Section>

              <Section title="Comportamento">

                <Toggle label="Responder em partes (1-3 bolhas separadas)" v={cfg.responder_em_partes} on={(v) => up("responder_em_partes", v)} />
                <Toggle label="Chamar cliente pelo nome quando souber" v={cfg.chamar_por_nome ?? true} on={(v) => up("chamar_por_nome", v)} />
                <Toggle label="Fazer uma pergunta por vez" v={cfg.perguntar_uma_por_vez ?? true} on={(v) => up("perguntar_uma_por_vez", v)} />
                <Toggle label="Pode usar gírias do cotidiano (BR)" v={cfg.usar_girias ?? false} on={(v) => up("usar_girias", v)} />
                <Toggle label="Pode fazer brincadeiras leves" v={cfg.pode_brincar ?? false} on={(v) => up("pode_brincar", v)} />
                <Toggle label="Assinar mensagens com o nome do agente" v={cfg.assinar_mensagens ?? false} on={(v) => up("assinar_mensagens", v)} />
              </Section>

              <Section title="Identidade da conversa">
                <Area label="Como se apresenta (1ª mensagem)" value={cfg.apresentacao} onChange={(v) => up("apresentacao", v)} rows={2} />
                <Area label="Estilo de comunicação (instruções extras)" value={cfg.estilo_comunicacao} onChange={(v) => up("estilo_comunicacao", v)} rows={2} />
                <Area label="Palavras / expressões PROIBIDAS (a IA nunca usa)" value={cfg.evitar_palavras ?? ""} onChange={(v) => up("evitar_palavras", v)} rows={2} />
              </Section>
            </TabsContent>


            <TabsContent value="agendamento" className="space-y-3">
              <Section>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Calendar className="size-5 text-[var(--brand-text)] mt-0.5" />
                    <div className="flex-1">
                      <div className="font-semibold flex items-center gap-2">
                        Google Agenda
                        {google?.conectado && <span className="text-[10px] bg-[var(--brand)]/15 text-[var(--brand-text)] px-1.5 py-0.5 rounded-full flex items-center gap-1"><CheckCircle2 className="size-3" />Conectado</span>}
                      </div>
                      {google?.email && <div className="text-xs text-muted-foreground">{google.email}</div>}
                      <p className="text-xs text-muted-foreground mt-1">Permite que a IA marque eventos automaticamente.</p>
                    </div>
                    {!allowGoogleCal ? (
                      <Link to="/app/checkout" className="text-xs underline text-muted-foreground">Disponível no Pro</Link>
                    ) : google?.conectado
                      ? <Button size="sm" variant="outline" onClick={disconnectG}>Desconectar</Button>
                      : <Button size="sm" onClick={connectGoogle}><LinkIcon className="size-3.5 mr-1" />Conectar</Button>}
                  </div>
                </div>
                <Toggle label="Agendamento ativo" v={cfg.agendamento_ativo} on={(v) => up("agendamento_ativo", v)} />
                <Area label="Serviços agendáveis" value={cfg.servicos_agendaveis} onChange={(v) => up("servicos_agendaveis", v)} rows={2} />
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Duração padrão" value={cfg.duracao_padrao} onChange={(v) => up("duracao_padrao", v)} />
                  <Field label="Antecedência mínima" value={cfg.antecedencia_min} onChange={(v) => up("antecedencia_min", v)} />
                </div>
                <Area label="Horários disponíveis" value={cfg.horarios_disponiveis} onChange={(v) => up("horarios_disponiveis", v)} rows={2} />
              </Section>
            </TabsContent>

            <TabsContent value="regras" className="space-y-3">
              <Section>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Area label="O que PODE fazer" value={cfg.pode_fazer} onChange={(v) => up("pode_fazer", v)} rows={4} />
                  <Area label="O que NÃO pode fazer" value={cfg.nao_pode_fazer} onChange={(v) => up("nao_pode_fazer", v)} rows={4} />
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Telefone p/ transferência" value={cfg.telefone_transferencia} onChange={(v) => up("telefone_transferencia", v)} />
                  <Field label="Palavra para pausar" value={cfg.palavra_pausar} onChange={(v) => up("palavra_pausar", v)} />
                  <Field label="Palavra para despausar" value={cfg.palavra_despausar} onChange={(v) => up("palavra_despausar", v)} />
                </div>
                <SliderRow label="Esperar antes de responder (segundos)" v={cfg.segundos_buffer} max={20} on={(v) => up("segundos_buffer", v)} unit="s" />
                <Toggle label="Responder em partes (1-3 bolhas)" v={cfg.responder_em_partes} on={(v) => up("responder_em_partes", v)} />
              </Section>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <Section title="Prompt gerado" icon={<Bot className="size-3.5" />}>
            <pre className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 font-mono text-[12px] leading-relaxed text-[var(--brand-text)] whitespace-pre-wrap max-h-[360px] overflow-auto">
{promptPreview}
            </pre>
          </Section>
          <Section title="Testar resposta" icon={<Sparkles className="size-3.5" />}>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 space-y-2 min-h-[140px]">
              <div className="flex justify-end">
                <div className="max-w-[78%] bg-[var(--panel)] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px]">{testMsg}</div>
              </div>
              {testReply.map((p, i) => (
                <div key={i} className="flex justify-start gap-2 items-end">
                  <InitialsAvatar name="IA" size={24} />
                  <div className="max-w-[78%] bg-[var(--brand)]/15 text-foreground rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px]">
                    {p}
                  </div>
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
          </Section>
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
function Field({ label, value, onChange, type }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} /></div>;
}
function Area({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={rows} /></div>;
}
function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={!!v} onCheckedChange={on} />
    </div>
  );
}
function SliderRow({ label, v, on, max = 100, unit = "" }: { label: string; v: number; on: (v: number) => void; max?: number; unit?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground font-mono">{v}{unit}</span>
      </div>
      <Slider value={[v]} max={max} step={1} onValueChange={([x]) => on(x)} />
    </div>
  );
}
