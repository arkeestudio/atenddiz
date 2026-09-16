import { createFileRoute } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useDroppable, useDraggable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { toast } from "sonner";
import { Plus, MoreVertical, Sparkles, Pencil, Trash2, Palette, Send, Zap, Loader2, Search, Layers, X } from "lucide-react";
import { brand } from "@/config/brand";
import { LeadDrawer, type LeadCard, type Stage, type Member } from "@/components/crm/lead-drawer";
import { runBatchSalesRecovery } from "@/lib/sales-recovery.functions";

export const Route = createFileRoute("/app/crm")({
  head: () => ({ meta: [{ title: `${brand.name} — CRM Kanban` }] }),
  component: KanbanPage,
});

const STAGE_COLORS = ["#8AA89A", "#FFB020", "#22B85F", "#FF5A5A", "#3FD27C", "#60A5FA", "#A78BFA", "#F472B6"];

function KanbanPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id ?? "";
  const userId = ctx.user.id;
  const [stages, setStages] = useState<Stage[]>([]);
  const [cards, setCards] = useState<LeadCard[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<LeadCard | null>(null);
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [adding, setAdding] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [searchQuery, setSearchQuery] = useState("");

  async function loadAll(cid: string) {
    let [{ data: st }, { data: cd }, { data: mem }] = await Promise.all([
      supabase.from("crm_stage").select("*").eq("company_id", cid).order("ordem", { ascending: true }),
      supabase.from("crm_cards").select("*").eq("company_id", cid).order("ultima_em", { ascending: false }),
      supabase.from("company_user").select("user_id, profiles:user_id(email)").eq("company_id", cid).eq("ativo", true),
    ]);

    if (!st || st.length === 0) {
      const defaults = [
        { company_id: cid, nome: "Conversas", cor: "#8AA89A", ordem: 0, tipo: "normal" as const },
        { company_id: cid, nome: "Negociando", cor: "#FFB020", ordem: 1, tipo: "normal" as const },
        { company_id: cid, nome: "Ganho", cor: "#22B85F", ordem: 2, tipo: "ganho" as const },
        { company_id: cid, nome: "Perda", cor: "#FF5A5A", ordem: 3, tipo: "perda" as const },
      ];
      const { data: inserted } = await supabase.from("crm_stage").insert(defaults).select("*");
      if (inserted && inserted.length > 0) st = inserted;
    }

    // Deduplicação defensiva por nome normalizado para garantir que nunca duplique na UI
    const seenNames = new Set<string>();
    const uniqueStages: Stage[] = [];
    for (const s of (st ?? []) as Stage[]) {
      const key = s.nome.trim().toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        uniqueStages.push(s);
      }
    }

    setStages(uniqueStages);
    setCards((cd ?? []) as LeadCard[]);
    setMembers(((mem ?? []) as any[]).map((m) => ({ user_id: m.user_id, email: m.profiles?.email ?? null })));
  }

  useEffect(() => {
    if (!companyId) return;
    void loadAll(companyId);
    const ch = supabase.channel(`tenant:${companyId}:crm`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_cards", filter: `company_id=eq.${companyId}` },
        () => loadAll(companyId))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_stage", filter: `company_id=eq.${companyId}` },
        () => loadAll(companyId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [companyId]);

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return cards;
    const term = searchQuery.toLowerCase().trim();
    return cards.filter((c) => {
      const nomeMatch = c.nome?.toLowerCase().includes(term);
      const numeroMatch = c.numero?.toLowerCase().includes(term);
      const tagMatch = c.tags?.some((t) => t.toLowerCase().includes(term));
      const msgMatch = c.ultima_mensagem?.toLowerCase().includes(term);
      return nomeMatch || numeroMatch || tagMatch || msgMatch;
    });
  }, [cards, searchQuery]);

  const byStage = useMemo(() => {
    const m: Record<string, LeadCard[]> = {};
    stages.forEach((s) => (m[s.id] = []));
    filteredCards.forEach((c) => {
      const sid = c.stage_id && m[c.stage_id] ? c.stage_id : stages[0]?.id;
      if (sid) (m[sid] ||= []).push(c);
    });
    return m;
  }, [filteredCards, stages]);

  const totalPipelineValue = useMemo(
    () => cards.reduce((acc, c) => acc + (Number(c.valor) || 0), 0),
    [cards]
  );

  async function moveCard(id: string, stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage_id: stageId, status: stage.nome } : c)));
    const { error } = await supabase.from("crm_cards").update({ stage_id: stageId, status: stage.nome }).eq("id", id);
    if (error) { setCards(prev); return toast.error(error.message); }
    await supabase.from("lead_evento").insert({
      company_id: companyId, card_id: id, tipo: "mudanca_etapa", descricao: `Movido para ${stage.nome}`,
    });
  }

  async function createStage(nome: string, cor: string) {
    const ordem = stages.length;
    const { error } = await supabase.from("crm_stage").insert({ company_id: companyId, nome, cor, ordem, tipo: "normal" });
    if (error) toast.error(error.message); else toast.success("Etapa criada");
  }
  async function updateStage(id: string, patch: Partial<Stage>) {
    const { error } = await supabase.from("crm_stage").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }
  async function deleteStage(id: string) {
    if (stages.length <= 1) return toast.error("Mantenha ao menos uma etapa");
    const first = stages.find((s) => s.id !== id);
    if (!first) return;
    await supabase.from("crm_cards").update({ stage_id: first.id, status: first.nome }).eq("stage_id", id);
    const { error } = await supabase.from("crm_stage").delete().eq("id", id);
    if (error) toast.error(error.message); else toast.success("Etapa removida");
  }
  async function reorderStages(orderedIds: string[]) {
    await Promise.all(orderedIds.map((sid, i) => supabase.from("crm_stage").update({ ordem: i }).eq("id", sid)));
  }

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const aId = String(active.id);
    const oId = String(over.id);
    // stage reorder
    if (aId.startsWith("stage:") && oId.startsWith("stage:")) {
      const from = aId.replace("stage:", ""); const to = oId.replace("stage:", "");
      if (from === to) return;
      const ids = stages.map((s) => s.id);
      const fi = ids.indexOf(from), ti = ids.indexOf(to);
      ids.splice(fi, 1); ids.splice(ti, 0, from);
      setStages((ss) => ids.map((id, i) => ({ ...(ss.find((s) => s.id === id)!), ordem: i })));
      void reorderStages(ids);
      return;
    }
    // card drop on stage
    const stageId = oId.startsWith("col:") ? oId.replace("col:", "") : null;
    if (!stageId) return;
    const card = cards.find((c) => c.id === aId);
    if (!card || card.stage_id === stageId) return;
    void moveCard(aId, stageId);
  }

  const activeCard = activeId ? cards.find((c) => c.id === activeId) : null;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            CRM Kanban
            <HelpTip text="Funil visual de vendas. Arraste cards entre etapas (Novo lead → Qualificado → Proposta → Fechado) para acompanhar a evolução de cada contato." />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Arraste cards entre etapas. A IA também move automaticamente.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setRecoveryOpen(true)}
            className="border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 font-medium"
          >
            <Sparkles className="size-4 mr-1.5" />
            Recuperar Vendas (IA)
          </Button>
          <Button variant="outline" onClick={() => setNewStageOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            Nova etapa
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4 mr-1.5" />
            Adicionar do WhatsApp
          </Button>
        </div>
      </header>

      {/* Barra de Filtro e Métricas Rápidas */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-[var(--panel)] border border-[var(--border)] p-3 rounded-xl shadow-xs">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar lead por nome, telefone ou tag..."
            className="pl-9 pr-8 h-9 text-sm bg-[var(--panel-2)] border-[var(--border)]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="font-semibold text-foreground text-sm">{cards.length}</span> {cards.length === 1 ? "lead total" : "leads totais"}
          </div>
          {totalPipelineValue > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground pl-3 border-l border-[var(--border)]">
              <span>Pipeline:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                R$ {totalPipelineValue.toLocaleString("pt-BR")}
              </span>
            </div>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 pb-4 overflow-x-auto min-h-[580px] select-none scrollbar-thin">
          {stages.map((col) => {
            const stageCards = byStage[col.id] ?? [];
            return (
              <div key={col.id} className="w-[310px] min-w-[280px] shrink-0">
                <Column stage={col} cards={stageCards}
                  onEdit={() => setEditingStage(col)} onDelete={() => deleteStage(col.id)}>
                  {stageCards.map((c) => (
                    <KCard key={c.id} card={c} onClick={() => setSelected(c)} />
                  ))}
                  {stageCards.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center py-10 px-4 text-center rounded-xl border border-dashed border-[var(--border)]/70 bg-[var(--panel-2)]/30 min-h-[160px]">
                      <div className="size-8 rounded-full bg-[var(--panel)] border border-[var(--border)] flex items-center justify-center mb-2 shadow-xs">
                        <Layers className="size-4 text-muted-foreground/60" />
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {searchQuery ? "Nenhum lead com este filtro" : "Nenhum contato nesta etapa"}
                      </p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">Arraste cards para cá</p>
                    </div>
                  )}
                </Column>
              </div>
            );
          })}
        </div>
        <DragOverlay>{activeCard ? <CardBody card={activeCard} dragging /> : null}</DragOverlay>
      </DndContext>

      <StageDialog open={newStageOpen} onClose={() => setNewStageOpen(false)}
        onSave={(n, c) => { createStage(n, c); setNewStageOpen(false); }} />
      <StageDialog open={!!editingStage} onClose={() => setEditingStage(null)}
        initial={editingStage ?? undefined}
        onSave={(n, c) => { if (editingStage) updateStage(editingStage.id, { nome: n, cor: c }); setEditingStage(null); }} />

      <LeadDrawer card={selected} stages={stages} members={members} companyId={companyId}
        onClose={() => setSelected(null)} onChanged={() => loadAll(companyId)} />

      <AddFromWhatsappDialog open={adding} onClose={() => setAdding(false)}
        companyId={companyId} userId={userId} firstStageId={stages[0]?.id ?? null}
        firstStageNome={stages[0]?.nome ?? "Conversas"}
        onAdded={() => loadAll(companyId)}
        existingNumbers={new Set(cards.map((c) => c.numero))} />

      <LeadRecoveryDialog
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        cards={cards}
        stages={stages}
        onSelectCard={(c) => {
          setRecoveryOpen(false);
          setSelected(c);
        }}
      />
    </div>
  );
}

function Column({ stage, cards, children, onEdit, onDelete }:
  { stage: Stage; cards: LeadCard[]; children: React.ReactNode; onEdit: () => void; onDelete: () => void }) {
  const { setNodeRef: setColRef, isOver } = useDroppable({ id: `col:${stage.id}` });
  const { attributes, listeners, setNodeRef: setHandleRef } = useDraggable({ id: `stage:${stage.id}` });
  const count = cards.length;
  const totalVal = useMemo(() => cards.reduce((acc, c) => acc + (Number(c.valor) || 0), 0), [cards]);

  return (
    <div ref={setColRef}
      className={`rounded-2xl border bg-[var(--panel)] p-4 min-h-[520px] flex flex-col transition-all duration-200 ${
        isOver ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20 bg-[var(--brand)]/[0.02]" : "border-[var(--border)] shadow-sm"
      }`}>
      <div ref={setHandleRef} {...attributes} {...listeners}
        className="flex items-center gap-2 mb-3 pb-3 border-b border-[var(--border)] cursor-grab active:cursor-grabbing select-none group">
        <span className="size-2.5 rounded-full shrink-0 transition-transform group-hover:scale-125" style={{ background: stage.cor, boxShadow: `0 0 8px ${stage.cor}80` }} />
        <b className="font-display text-[15px] font-semibold truncate text-foreground">{stage.nome}</b>
        <span className="ml-1 text-[11px] font-medium text-muted-foreground bg-[var(--panel-2)] px-2 py-0.5 rounded-full border border-[var(--border)]/50">
          {count}
        </span>
        {totalVal > 0 && (
          <span className="ml-auto mr-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            R$ {totalVal.toLocaleString("pt-BR")}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`${totalVal > 0 ? "" : "ml-auto"} text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-[var(--panel-2)] transition-colors`} onPointerDown={(e) => e.stopPropagation()}>
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil className="size-3.5 mr-2" />Renomear / cor</DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive"><Trash2 className="size-3.5 mr-2" />Excluir etapa</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-3 flex-1 flex flex-col">{children}</div>
    </div>
  );
}

function KCard({ card, onClick }: { card: LeadCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={{ opacity: isDragging ? 0.3 : 1, cursor: "grab" }}
      onClick={onClick}>
      <CardBody card={card} />
    </div>
  );
}

function CardBody({ card, dragging }: { card: LeadCard; dragging?: boolean }) {
  const time = new Date(card.ultima_em);
  return (
    <div className={`rounded-xl border bg-[var(--panel-2)] p-3.5 transition-all duration-150 ${
      dragging
        ? "shadow-2xl ring-2 ring-[var(--brand)]/50 rotate-1 border-[var(--brand)]/60 scale-[1.02]"
        : "border-[var(--border)] shadow-xs hover:border-[var(--brand)]/40 hover:shadow-md hover:-translate-y-0.5"
    }`}>
      <div className="flex items-start gap-3">
        <InitialsAvatar name={card.nome || card.nome_whatsapp || card.numero} size={38} className="shrink-0 font-medium" src={card.foto_url} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold truncate text-foreground leading-tight">{card.nome || card.nome_whatsapp || card.numero}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{card.numero}</div>
        </div>
      </div>
      {card.ultima_mensagem && (
        <p className="text-muted-foreground text-[12.5px] mt-2.5 line-clamp-2 leading-relaxed bg-[var(--panel)]/40 p-2 rounded-lg border border-[var(--border)]/40">
          {card.ultima_mensagem}
        </p>
      )}
      {card.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {card.tags.map((t) => (
            <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[var(--brand)]/10 text-[var(--brand-text)] border border-[var(--brand)]/20">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[var(--border)]/80">
        {card.valor != null && Number(card.valor) > 0 ? (
          <span className="font-display font-bold text-[13px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
            R$ {Number(card.valor).toLocaleString("pt-BR")}
          </span>
        ) : (
          <span className="text-[10px] font-bold text-[var(--brand-text)] bg-[var(--brand)]/10 border border-[var(--brand)]/20 px-1.5 py-0.5 rounded-md flex items-center gap-1">
            <Sparkles className="size-2.5" /> IA
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground/80 font-medium">
          {time.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {time.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

function StageDialog({ open, onClose, onSave, initial }:
  { open: boolean; onClose: () => void; onSave: (nome: string, cor: string) => void; initial?: Stage }) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [cor, setCor] = useState(initial?.cor ?? STAGE_COLORS[0]);
  useEffect(() => { if (open) { setNome(initial?.nome ?? ""); setCor(initial?.cor ?? STAGE_COLORS[0]); } }, [open, initial?.id]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial ? "Editar etapa" : "Nova etapa"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus /></div>
          <div>
            <Label className="flex items-center gap-1.5"><Palette className="size-3.5" />Cor</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {STAGE_COLORS.map((c) => (
                <button key={c} onClick={() => setCor(c)}
                  className={`size-8 rounded-full ring-2 transition ${cor === c ? "ring-[var(--brand)] scale-110" : "ring-transparent"}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => nome.trim() && onSave(nome.trim(), cor)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddFromWhatsappDialog({ open, onClose, companyId, userId, firstStageId, firstStageNome, onAdded, existingNumbers }: {
  open: boolean; onClose: () => void; companyId: string; userId: string;
  firstStageId: string | null; firstStageNome: string;
  onAdded: () => void; existingNumbers: Set<string>;
}) {
  const [convs, setConvs] = useState<{ numero: string; contato_nome: string | null; texto: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !companyId) return;
    void (async () => {
      setLoading(true);
      const { data } = await supabase.from("mensagens")
        .select("numero,contato_nome,texto,created_at").eq("company_id", companyId)
        .order("created_at", { ascending: false }).limit(100);
      const seen = new Set<string>(); const list: typeof convs = [];
      (data ?? []).forEach((m: any) => {
        if (seen.has(m.numero) || existingNumbers.has(m.numero)) return;
        seen.add(m.numero); list.push(m);
      });
      setConvs(list); setLoading(false);
    })();
  }, [open, companyId]);

  async function add(c: any) {
    const { error } = await supabase.from("crm_cards").upsert({
      company_id: companyId, user_id: userId, numero: c.numero, nome: c.contato_nome,
      status: firstStageNome, stage_id: firstStageId,
      ultima_mensagem: c.texto.slice(0, 240), ultima_em: new Date().toISOString(),
    }, { onConflict: "company_id,numero" });
    if (error) return toast.error(error.message);
    toast.success("Adicionado");
    onAdded(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Conversas recentes do WhatsApp</DialogTitle></DialogHeader>
        {loading ? <div className="text-sm text-muted-foreground py-6 text-center">Carregando…</div>
          : convs.length === 0 ? <div className="text-sm text-muted-foreground py-6 text-center">Nenhuma conversa nova.</div>
          : (
            <ul className="max-h-80 overflow-auto divide-y divide-[var(--border)]">
              {convs.map((c) => (
                <li key={c.numero} className="py-2.5 flex items-center gap-3">
                  <InitialsAvatar name={c.contato_nome || c.numero} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.contato_nome || c.numero}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.texto}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => add(c)}>Adicionar</Button>
                </li>
              ))}
            </ul>
          )}
      </DialogContent>
    </Dialog>
  );
}

function LeadRecoveryDialog({
  open,
  onClose,
  cards,
  stages,
  onSelectCard,
}: {
  open: boolean;
  onClose: () => void;
  cards: LeadCard[];
  stages: Stage[];
  onSelectCard: (c: LeadCard) => void;
}) {
  const [runningBatch, setRunningBatch] = useState(false);

  const recoverable = useMemo(() => {
    return cards.filter((c) => {
      const stage = stages.find((s) => s.id === c.stage_id);
      return (stage as any)?.tipo !== "ganho" && (stage as any)?.tipo !== "perda";
    });
  }, [cards, stages]);

  async function handleRunBatch() {
    if (recoverable.length === 0) {
      toast.info("Não há leads aguardando recuperação no momento.");
      return;
    }
    setRunningBatch(true);
    try {
      const res = await runBatchSalesRecovery({ data: { minInactivityHours: 1, maxLeads: 10 } });
      if (res.sent > 0) {
        toast.success(`⚡ Recuperação em massa: ${res.sent} mensagens de follow-up enviadas com sucesso!`);
      } else if (res.skipped > 0 && res.sent === 0) {
        toast.info("Leads já foram contatados recentemente ou estão pausados.");
      } else {
        toast.info("Nenhum lead elegível para reativação imediata.");
      }
      onClose();
    } catch (err: any) {
      toast.error(`Falha no disparo em massa: ${err?.message || "Erro desconhecido"}`);
    } finally {
      setRunningBatch(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-4">
            <span className="flex items-center gap-2">
              <Sparkles className="size-5 text-amber-500" />
              Recuperação de Vendas & Follow-up com IA
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-muted-foreground leading-relaxed flex items-center justify-between gap-3">
            <div className="flex-1">
              A IA analisa cada conversa parada, compreende as dúvidas ou objeções e envia abordagens personalizadas com PIX e promoções para fechar a venda.
            </div>
            {recoverable.length > 0 && (
              <Button
                size="sm"
                disabled={runningBatch}
                onClick={handleRunBatch}
                className="shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-semibold text-xs shadow"
              >
                {runningBatch ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <Zap className="size-3.5 mr-1.5" />
                )}
                {runningBatch ? "Disparando..." : "Disparar em Massa"}
              </Button>
            )}
          </div>

          {recoverable.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-[var(--border)] rounded-xl">
              Nenhum lead aguardando recuperação no momento.
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-[var(--border)] pr-1">
              {recoverable.map((c) => {
                const stage = stages.find((s) => s.id === c.stage_id);
                const time = new Date(c.ultima_em);
                return (
                  <li
                    key={c.id}
                    className="py-3 flex items-center justify-between gap-3 hover:bg-[var(--panel-2)]/60 px-2 rounded-lg transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <InitialsAvatar name={c.nome || c.nome_whatsapp || c.numero} size={36} src={c.foto_url} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{c.nome || c.nome_whatsapp || c.numero}</span>
                          {stage && (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full font-medium text-white"
                              style={{ background: stage.cor }}
                            >
                              {stage.nome}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {c.ultima_mensagem || "(sem mensagem recente)"}
                        </p>
                        <span className="text-[10px] text-muted-foreground">
                          Última interação: {time.toLocaleDateString("pt-BR")} às{" "}
                          {time.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => onSelectCard(c)}
                      className="shrink-0 text-xs bg-amber-500 hover:bg-amber-600 text-black font-medium"
                    >
                      <Sparkles className="size-3.5 mr-1" />
                      Fazer Follow-up
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
