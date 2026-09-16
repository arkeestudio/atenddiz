import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Save, Trash2, Send, Sparkles, Hand } from "lucide-react";
import { generateLeadFollowup, sendLeadFollowup } from "@/lib/sales-recovery.functions";
import { FichaAtendimento, type FichaCard } from "@/components/ficha/ficha-atendimento";

export interface LeadCard extends FichaCard {
  id: string; numero: string; nome: string | null;
  nome_whatsapp?: string | null; foto_url?: string | null;
  status: string; stage_id: string | null;
  ultima_mensagem: string | null; ultima_em: string;
  observacao: string | null; valor: number | null;
  origem: string | null; owner_id: string | null;
  tags: string[]; proxima_acao: string | null; follow_up: string | null;
}
export interface Stage { id: string; nome: string; cor: string; }
export interface Member { user_id: string; email?: string | null; nome?: string | null; }

export function LeadDrawer({
  card, stages, members, companyId, onClose, onChanged,
}: {
  card: LeadCard | null; stages: Stage[]; members: Member[];
  companyId: string; onClose: () => void; onChanged: () => void;
}) {
  const [local, setLocal] = useState<LeadCard | null>(card);
  const [tab, setTab] = useState("ficha");
  useEffect(() => { setLocal(card); setTab("ficha"); }, [card?.id]);

  if (!card || !local) return null;

  function set<K extends keyof LeadCard>(k: K, v: LeadCard[K]) {
    setLocal((p) => (p ? { ...p, [k]: v } : p));
  }

  async function save() {
    if (!local) return;
    const stage = stages.find((s) => s.id === local.stage_id);
    const { error } = await supabase.from("crm_cards").update({
      nome: local.nome, valor: local.valor ?? 0, stage_id: local.stage_id,
      status: stage?.nome ?? local.status, origem: local.origem, owner_id: local.owner_id,
      tags: local.tags, proxima_acao: local.proxima_acao, follow_up: local.follow_up,
      observacao: local.observacao,
    }).eq("id", local.id);
    if (error) return toast.error(error.message);
    await supabase.from("lead_evento").insert({
      company_id: companyId, card_id: local.id, tipo: "atualizacao", descricao: "Dados atualizados",
    });
    toast.success("Lead atualizado");
    onChanged();
  }

  return (
    <Sheet open={!!card} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-[var(--panel)] border-l border-[var(--border)]">
        <SheetHeader className="pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={local.nome || local.nome_whatsapp || local.numero} size={48} src={local.foto_url} />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base">{local.nome || local.numero}</SheetTitle>
              <div className="text-xs text-muted-foreground font-mono">{local.numero}</div>
            </div>
            {local.aguardando_humano && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-1 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 shrink-0">
                <Hand className="size-3" /> Aguardando humano
              </span>
            )}
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="ficha">Ficha</TabsTrigger>
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="conversa">Conversa</TabsTrigger>
            <TabsTrigger value="followup" className="text-amber-500 font-medium flex items-center gap-1">
              <Sparkles className="size-3" /> Follow-up
            </TabsTrigger>
            <TabsTrigger value="notas">Notas</TabsTrigger>
            <TabsTrigger value="hist">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="ficha" className="mt-4">
            <FichaAtendimento companyId={companyId} card={card} onChanged={onChanged} />
          </TabsContent>

          <TabsContent value="dados" className="space-y-3 mt-4">
            <Field label="Nome" value={local.nome ?? ""} onChange={(v) => set("nome", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor (R$)" type="number" value={String(local.valor ?? 0)} onChange={(v) => set("valor", Number(v) || 0)} />
              <Field label="Origem" value={local.origem ?? ""} onChange={(v) => set("origem", v)} />
            </div>
            <div className="space-y-1.5">
              <Label>Etapa</Label>
              <Select value={local.stage_id ?? ""} onValueChange={(v) => set("stage_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: s.cor }} />{s.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Dono</Label>
              <Select value={local.owner_id ?? "_none"} onValueChange={(v) => set("owner_id", v === "_none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Sem dono" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sem dono</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.nome || m.email || m.user_id.slice(0,8)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label="Tags (separadas por vírgula)" value={(local.tags ?? []).join(", ")}
              onChange={(v) => set("tags", v.split(",").map(s => s.trim()).filter(Boolean))} />
            <Field label="Próxima ação" value={local.proxima_acao ?? ""} onChange={(v) => set("proxima_acao", v)} />
            <Field label="Follow-up (data/hora ISO)" value={local.follow_up ?? ""} onChange={(v) => set("follow_up", v || null as any)} />
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea value={local.observacao ?? ""} onChange={(e) => set("observacao", e.target.value)} rows={3} />
            </div>
            <Button onClick={save} className="w-full"><Save className="size-4 mr-2" />Salvar</Button>
          </TabsContent>

          <TabsContent value="conversa" className="mt-4">
            <ConversaTab numero={local.numero} companyId={companyId} />
          </TabsContent>

          <TabsContent value="followup" className="mt-4">
            <FollowupTab card={local} stageName={stages.find((s) => s.id === local.stage_id)?.nome} onChanged={onChanged} />
          </TabsContent>

          <TabsContent value="notas" className="mt-4">
            <NotasTab cardId={local.id} companyId={companyId} />
          </TabsContent>

          <TabsContent value="hist" className="mt-4">
            <HistTab cardId={local.id} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, onChange, type }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ConversaTab({ numero, companyId }: { numero: string; companyId: string }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("mensagens").select("*")
        .eq("company_id", companyId).eq("numero", numero)
        .order("created_at", { ascending: true }).limit(200);
      setMsgs(data ?? []);
    })();
  }, [numero, companyId]);
  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto p-2">
      {msgs.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">Sem mensagens.</div>}
      {msgs.map((m) => (
        <div key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direcao === "saida" ? "bg-[var(--brand)]/15 text-foreground" : "bg-[var(--panel-2)]"}`}>
            <div className="text-[10px] uppercase opacity-60 mb-0.5">{m.autor}</div>
            {m.texto}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotasTab({ cardId, companyId }: { cardId: string; companyId: string }) {
  const [notas, setNotas] = useState<any[]>([]);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  async function reload() {
    const { data } = await supabase.from("lead_nota").select("*").eq("card_id", cardId).order("created_at", { ascending: false });
    setNotas(data ?? []);
  }
  useEffect(() => { void reload(); }, [cardId]);
  async function add() {
    if (!texto.trim()) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("lead_nota").insert({
      company_id: companyId, card_id: cardId, autor_id: u.user?.id ?? null, texto: texto.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setTexto(""); reload();
  }
  async function del(id: string) {
    await supabase.from("lead_nota").delete().eq("id", id);
    reload();
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Adicionar nota interna…" />
        <Button onClick={add} disabled={busy}><Send className="size-4" /></Button>
      </div>
      <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
        {notas.map((n) => (
          <li key={n.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-sm">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
              <span>{new Date(n.created_at).toLocaleString("pt-BR")}</span>
              <button onClick={() => del(n.id)} className="hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </div>
            <div className="whitespace-pre-wrap">{n.texto}</div>
          </li>
        ))}
        {notas.length === 0 && <li className="text-sm text-muted-foreground text-center py-4">Sem notas.</li>}
      </ul>
    </div>
  );
}

function HistTab({ cardId }: { cardId: string }) {
  const [evs, setEvs] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("lead_evento").select("*").eq("card_id", cardId).order("created_at", { ascending: false });
      setEvs(data ?? []);
    })();
  }, [cardId]);
  return (
    <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
      {evs.length === 0 && <li className="text-sm text-muted-foreground text-center py-6">Sem eventos.</li>}
      {evs.map((e) => (
        <li key={e.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-sm">
          <div className="text-[11px] text-muted-foreground mb-1">{new Date(e.created_at).toLocaleString("pt-BR")}</div>
          <div><b className="text-[var(--brand-text)]">{e.tipo}</b> — {e.descricao}</div>
        </li>
      ))}
    </ul>
  );
}

function FollowupTab({ card, stageName, onChanged }: { card: LeadCard; stageName?: string; onChanged: () => void }) {
  const [suggestion, setSuggestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const gen = useServerFn(generateLeadFollowup);
  const snd = useServerFn(sendLeadFollowup);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await gen({
        data: {
          numero: card.numero,
          cardId: card.id,
          contactName: card.nome ?? undefined,
          stageName,
        },
      });
      setSuggestion(res.suggestion || "");
      toast.success("Mensagem de follow-up gerada com IA!");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao gerar follow-up com IA");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!suggestion.trim()) return toast.error("Escreva ou gere uma mensagem antes de enviar.");
    setSending(true);
    try {
      await snd({
        data: {
          numero: card.numero,
          text: suggestion.trim(),
          cardId: card.id,
        },
      });
      toast.success("Follow-up enviado pelo WhatsApp com sucesso!");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar follow-up");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4 py-2">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 space-y-2">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-xs">
          <Sparkles className="size-4" /> Reativação Inteligente de Vendas
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          A IA analisa todo o histórico de conversas com este contato, identifica o que foi ofertado (ou se ficou pendente o PIX/pagamento) e cria uma mensagem persuasiva e humana para reatar a venda.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Mensagem de Follow-up (Editável)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            className="h-7 text-xs border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
          >
            {generating ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
            {suggestion ? "Regerar com IA" : "Gerar com IA"}
          </Button>
        </div>

        <Textarea
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
          rows={4}
          placeholder="Clique em 'Gerar com IA' ou digite uma mensagem personalizada de reativação para este cliente..."
          className="text-xs leading-relaxed"
        />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSend}
          disabled={sending || !suggestion.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9"
        >
          {sending ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Send className="size-3.5 mr-1.5" />}
          Enviar no WhatsApp Agora
        </Button>
      </div>
    </div>
  );
}
