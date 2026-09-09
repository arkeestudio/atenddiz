import { createFileRoute } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import {
  Hand, MessageSquareText, Send, Sparkles, User, Search, Bot, ExternalLink,
  Star, Mic, Paperclip, Lock, Square, FileText, X, Zap, Tag, Plus, Check,
  Loader2, Trash2, CreditCard, Copy, Image as ImageIcon, Volume2, AlertCircle, PhoneForwarded
} from "lucide-react";
import { sendCsat } from "@/lib/csat.functions";
import { toast } from "sonner";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { sendWhatsappText, sendWhatsappMedia, sendInternalNote, setContactIaActive, summarizeConversation, transcribeAudioMessage } from "@/lib/evolution.functions";
import { generateSuggestedReply, polishDraftMessage, sendPixPayment, assignConversationOwner, forwardLeadSummaryManual } from "@/lib/chat-copilot.functions";
import { markConversationSeen, sendTypingPresence } from "@/lib/whatsapp.functions";
import { LeadDrawer, type LeadCard, type Stage, type Member } from "@/components/crm/lead-drawer";
import { listTemplates, saveTemplate, deleteTemplate, type MessageTemplate } from "@/lib/templates.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/app/conversas")({
  head: () => ({ meta: [{ title: `${brand.name} — Conversas` }] }),
  component: ConversasPage,
});

interface Msg {
  id: string; numero: string; contato_nome: string | null;
  direcao: "entrada" | "saida"; autor: "ia" | "humano" | "contato";
  texto: string; created_at: string; user_id: string | null;
  status_entrega?: string | null;
}

type Filter = "todas" | "nao_lidas" | "aguardando_humano" | "minhas" | "ia_ativa" | "resolvidas";

// Bolhas ainda não confirmadas pelo servidor.
const OPTIMISTIC_PREFIX = "optimistic:";

const QUICK_REPLIES = [
  "Olá! Em que posso ajudar?",
  "Obrigado pelo contato! Vou verificar e já te respondo.",
  "Pode me passar mais detalhes, por favor?",
  "Posso te enviar uma proposta?",
];

type StageWithTipo = Stage & { tipo?: string };

function ConversasPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const userId = ctx.user.id;


  const sendFn = useServerFn(sendWhatsappText);
  const sendMediaFn = useServerFn(sendWhatsappMedia);
  const sendNoteFn = useServerFn(sendInternalNote);
  const sendCsatFn = useServerFn(sendCsat);
  const toggleIaFn = useServerFn(setContactIaActive);
  const fetchTemplates = useServerFn(listTemplates);
  const saveTemplateFn = useServerFn(saveTemplate);
  const deleteTemplateFn = useServerFn(deleteTemplate);
  const summarizeFn = useServerFn(summarizeConversation);
  const transcribeFn = useServerFn(transcribeAudioMessage);

  // Copiloto IA & OpenWA hooks
  const suggestReplyFn = useServerFn(generateSuggestedReply);
  const polishDraftFn = useServerFn(polishDraftMessage);
  const sendPixFn = useServerFn(sendPixPayment);
  const assignOwnerFn = useServerFn(assignConversationOwner);
  const markSeenFn = useServerFn(markConversationSeen);
  const sendPresenceFn = useServerFn(sendTypingPresence);
  const forwardSummaryFn = useServerFn(forwardLeadSummaryManual);

  // Estados do Copiloto IA e PIX
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [forwardingSummary, setForwardingSummary] = useState(false);
  const [pixValorInput, setPixValorInput] = useState("");
  const [pixDescInput, setPixDescInput] = useState("");
  const [sendingPix, setSendingPix] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const [newTplAtalho, setNewTplAtalho] = useState("");
  const [newTplTexto, setNewTplTexto] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);

  // Resumo IA Dialog
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState("");

  // Tag Quick Add
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");

  const composerRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [cards, setCards] = useState<Record<string, LeadCard>>({});
  const [pauses, setPauses] = useState<Record<string, boolean>>({});
  const [stages, setStages] = useState<StageWithTipo[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>(() => {
    if (typeof window === "undefined") return "todas";
    return (localStorage.getItem("conv:filter") as Filter) || "todas";
  });
  const [active, setActive] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [drawerCard, setDrawerCard] = useState<LeadCard | null>(null);
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Audio Recorder State
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);

  function playNotificationChime() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }

  const activeRef = useRef<string | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  function applyIncoming(m: Msg) {
    if (m.direcao === "entrada" && m.numero !== activeRef.current) {
      playNotificationChime();
    }
    setMsgs((prev) => {
      const base = m.direcao === "saida"
        ? prev.filter((x) => !(x.id.startsWith(OPTIMISTIC_PREFIX) && x.numero === m.numero && x.texto === m.texto))
        : prev;
      const i = base.findIndex((x) => x.id === m.id);
      if (i === -1) return [m, ...base].slice(0, 500);
      const next = base.slice();
      next[i] = { ...next[i], ...m };
      return next;
    });
  }

  useEffect(() => {
    if (!companyId) return;
    void load(companyId);
    let subscribedOnce = false;
    const ch = supabase
      .channel(`tenant:${companyId}:mensagens`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "mensagens", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const m = payload.new as Msg;
          applyIncoming(m);
          if (m.direcao === "entrada" && m.numero !== activeRef.current) {
            setUnread((u) => ({ ...u, [m.numero]: (u[m.numero] ?? 0) + 1 }));
            try {
              if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
                new Notification(m.contato_nome ?? m.numero, { body: m.texto?.slice(0, 140) ?? "Nova mensagem", tag: m.numero });
              }
            } catch {}
          }
        },
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "mensagens", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMsgs((p) => p.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
        },
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "contact_pause", filter: `company_id=eq.${companyId}` },
        () => { void loadPauses(companyId); },
      )
      .subscribe((status) => {
        // Numa REassinatura (queda de rede, servidor reciclando o socket) o que
        // passou enquanto o canal estava fora nunca é reenviado. Recarregar aqui
        // é o que substitui o F5 manual.
        if (status === "SUBSCRIBED") {
          if (subscribedOnce) void load(companyId);
          subscribedOnce = true;
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [companyId]);

  // Aba voltou pro primeiro plano: o browser suspende websocket em aba oculta,
  // então sincroniza ao reaparecer. Com throttle, porque load() puxa 500
  // mensagens + 4 queries e quem alterna de aba direto pagaria isso toda vez.
  const lastSyncRef = useRef(0);
  useEffect(() => {
    if (!companyId) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncRef.current < 5000) return;
      lastSyncRef.current = Date.now();
      void load(companyId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [companyId]);

  useEffect(() => {
    if (active) setUnread((u) => ({ ...u, [active]: 0 }));
    requestAnimationFrame(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); });
  }, [active, msgs.length]);

  useEffect(() => {
    try { localStorage.setItem("conv:filter", filter); } catch {}
  }, [filter]);

  // Load templates once
  useEffect(() => {
    void (async () => {
      try { setTemplates(await fetchTemplates()); } catch {}
    })();
    // eslint-disable-next-line
  }, []);

  // Keyboard shortcuts attached after `conversations` is declared (see below).



  async function loadPauses(cid: string) {
    const { data } = await supabase.from("contact_pause").select("numero,pausado").eq("company_id", cid);
    const map: Record<string, boolean> = {};
    (data ?? []).forEach((r: any) => { map[r.numero] = !!r.pausado; });
    setPauses(map);
  }

  async function load(cid: string) {
    const [{ data: m }, { data: c }, { data: st }, { data: cu }] = await Promise.all([
      supabase.from("mensagens").select("*").eq("company_id", cid).order("created_at", { ascending: false }).limit(500),
      supabase.from("crm_cards").select("*").eq("company_id", cid),
      supabase.from("crm_stage").select("id,nome,cor,ordem,tipo").eq("company_id", cid).order("ordem", { ascending: true }),
      supabase.from("company_user").select("user_id,profiles(nome,email)").eq("company_id", cid).eq("ativo", true),
    ]);
    setMsgs((m ?? []) as Msg[]);
    const map: Record<string, LeadCard> = {};
    (c ?? []).forEach((r: any) => { map[r.numero] = r; });
    setCards(map);
    setStages((st ?? []) as any);
    setMembers(((cu ?? []) as any[]).map((r) => ({
      user_id: r.user_id, nome: r.profiles?.nome ?? null, email: r.profiles?.email ?? null,
    })));
    await loadPauses(cid);
    void loadAllTemplates();
  }

  async function loadAllTemplates() {
    try {
      const res = await fetchTemplates();
      setTemplates(res ?? []);
    } catch {}
  }

  async function handleSaveTemplate() {
    if (!newTplAtalho.trim() || !newTplTexto.trim()) {
      return toast.error("Preencha atalho e texto da resposta rápida");
    }
    setSavingTpl(true);
    try {
      await saveTemplateFn({ data: { atalho: newTplAtalho, texto: newTplTexto } });
      await loadAllTemplates();
      setNewTplAtalho("");
      setNewTplTexto("");
      toast.success("Resposta rápida salva!");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar template");
    } finally {
      setSavingTpl(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    try {
      await deleteTemplateFn({ data: { id } });
      await loadAllTemplates();
      toast.success("Resposta rápida removida");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao remover");
    }
  }

  function handleSelectTemplate(text: string) {
    setComposer(text);
    setShowTemplatePicker(false);
    composerRef.current?.focus();
  }

  async function handleGenerateSummary() {
    if (!active) return;
    setSummaryLoading(true);
    setSummaryOpen(true);
    setSummaryText("");
    try {
      const res = await summarizeFn({ data: { numero: active } });
      setSummaryText(res?.summary || "Nenhum histórico recente encontrado.");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao resumir conversa com IA");
      setSummaryOpen(false);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleSaveSummaryAsNote() {
    if (!summaryText || !active) return;
    try {
      await sendNoteFn({ data: { numero: active, texto: summaryText, contatoNome: activeConv?.nome ?? null } });
      toast.success("Resumo gravado como Nota Interna!");
      setSummaryOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar nota interna");
    }
  }

  async function handleForwardSummary(customDest?: string) {
    if (!active) return;
    setForwardingSummary(true);
    try {
      const res = await forwardSummaryFn({
        data: {
          numero: active,
          contatoNome: activeConv?.nome ?? null,
          destinationNumber: customDest || undefined,
        },
      });
      toast.success(`Resumo executivo encaminhado com sucesso via WhatsApp para ${res.destination}!`);
      setSummaryOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao encaminhar resumo");
    } finally {
      setForwardingSummary(false);
    }
  }

  async function handleTranscribeAudio(msgId: string, currentText: string) {
    try {
      toast.info("Transcrevendo áudio com IA...");
      const res = await transcribeFn({ data: { messageId: msgId, texto: currentText } });
      setMsgs((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, texto: `🎤 [Áudio] 📝 Transcrição: "${res.transcricao}"` } : m
        )
      );
      toast.success("Áudio transcrito!");
    } catch (e: any) {
      toast.error(e?.message || "Erro na transcrição");
    }
  }

  async function handleUpdateStage(stageId: string) {
    if (!active || !companyId) return;
    try {
      const card = cards[active];
      if (card?.id) {
        await supabase.from("crm_cards").update({ stage_id: stageId }).eq("id", card.id);
        setCards((prev) => ({ ...prev, [active]: { ...prev[active], stage_id: stageId } }));
      } else {
        const { data: newCard } = await supabase.from("crm_cards").insert({
          company_id: companyId,
          user_id: userId,
          numero: active,
          nome: activeConv?.nome || active,
          stage_id: stageId,
          ultima_em: new Date().toISOString(),
        }).select().maybeSingle();
        if (newCard) {
          setCards((prev) => ({ ...prev, [active]: newCard as any }));
        }
      }
      toast.success("Etapa do lead atualizada!");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao atualizar etapa");
    }
  }

  async function handleAddTag(tag: string) {
    const clean = tag.trim().replace(/^#/, "");
    if (!clean || !active || !companyId) return;
    const card = cards[active];
    const currentTags = card?.tags || [];
    if (currentTags.includes(clean)) return;
    const nextTags = [...currentTags, clean];
    try {
      if (card?.id) {
        await supabase.from("crm_cards").update({ tags: nextTags }).eq("id", card.id);
        setCards((prev) => ({ ...prev, [active]: { ...prev[active], tags: nextTags } }));
      }
      setNewTagInput("");
      setShowAddTag(false);
      toast.success(`Tag #${clean} adicionada!`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao adicionar tag");
    }
  }

  async function handleRemoveTag(tagToRemove: string) {
    if (!active || !companyId) return;
    const card = cards[active];
    const nextTags = (card?.tags || []).filter((t) => t !== tagToRemove);
    try {
      if (card?.id) {
        await supabase.from("crm_cards").update({ tags: nextTags }).eq("id", card.id);
        setCards((prev) => ({ ...prev, [active]: { ...prev[active], tags: nextTags } }));
      }
      toast.success(`Tag #${tagToRemove} removida`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao remover tag");
    }
  }

  async function handleSuggestReply(tone: "vendas" | "curto" | "consultivo") {
    if (!active) return;
    setAiSuggesting(true);
    try {
      const res = await suggestReplyFn({
        data: {
          numero: active,
          tone,
          contactName: activeConv?.nome ?? undefined,
        },
      });
      if (res?.suggestion) {
        setComposer(res.suggestion);
        composerRef.current?.focus();
        toast.success("Resposta sugerida pela IA inserida!");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao gerar sugestão com IA");
    } finally {
      setAiSuggesting(false);
    }
  }

  async function handlePolishDraft() {
    if (!composer.trim()) return;
    setPolishing(true);
    try {
      const res = await polishDraftFn({
        data: { draftText: composer, contactName: activeConv?.nome ?? undefined },
      });
      if (res?.polished) {
        setComposer(res.polished);
        composerRef.current?.focus();
        toast.success("Texto aprimorado pela IA!");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao aprimorar texto");
    } finally {
      setPolishing(false);
    }
  }

  async function handleSendPix() {
    const rawVal = pixValorInput.replace(/[^\d.,]/g, "").replace(",", ".");
    const valorNum = parseFloat(rawVal);
    if (!active || isNaN(valorNum) || valorNum <= 0) {
      toast.error("Informe um valor válido em R$.");
      return;
    }
    setSendingPix(true);
    try {
      const res: any = await sendPixFn({
        data: {
          numero: active,
          valor: valorNum,
          descricao: pixDescInput.trim() || undefined,
          contatoNome: activeConv?.nome ?? null,
        },
      });
      if (res?.mensagem) applyIncoming(res.mensagem as Msg);
      setPixModalOpen(false);
      setPixValorInput("");
      setPixDescInput("");
      toast.success("Cobrança PIX enviada com sucesso no WhatsApp via OpenWA!");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao gerar e enviar PIX");
    } finally {
      setSendingPix(false);
    }
  }

  async function handleAssignOwner(ownerId: string | null) {
    if (!active || !companyId) return;
    try {
      await assignOwnerFn({ data: { numero: active, ownerId } });
      setCards((prev) => ({
        ...prev,
        [active]: { ...prev[active], owner_id: ownerId },
      }));
      const memberName = members.find((m) => m.user_id === ownerId)?.nome || "Sem responsável";
      toast.success(`Conversa atribuída a: ${memberName}`);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao atribuir responsável");
    }
  }

  function handleSelectConversation(numero: string) {
    setActive(numero);
    setUnread((prev) => ({ ...prev, [numero]: 0 }));
    // OpenWA: Marca como lido com ticks azuis
    void markSeenFn({ data: { numero } });
  }

  const countsAguardandoHumano = useMemo(() => {
    const map = new Map<string, Msg>();
    for (const m of msgs) {
      if (!map.has(m.numero)) map.set(m.numero, m);
    }
    let c = 0;
    for (const [num, last] of map.entries()) {
      const card = cards[num];
      const tipo = card?.stage_id ? stages.find((s) => s.id === card.stage_id)?.tipo : null;
      const resolvida = tipo === "ganho" || tipo === "perda";
      const iaAtiva = !(pauses[num] ?? false);
      if (!resolvida && (!iaAtiva || (last.direcao === "entrada" && last.autor === "contato"))) {
        c++;
      }
    }
    return c;
  }, [msgs, cards, stages, pauses]);

  const conversations = useMemo(() => {
    const map = new Map<string, { numero: string; nome: string | null; last: Msg }>();
    for (const m of msgs) {
      const card = cards[m.numero];
      const name = card?.nome || m.contato_nome || null;
      const cur = map.get(m.numero);
      if (!cur) {
        map.set(m.numero, { numero: m.numero, nome: name, last: m });
      } else if (!cur.nome && name) {
        cur.nome = name;
      }
    }
    let list = Array.from(map.values());
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => (c.nome ?? "").toLowerCase().includes(q) || c.numero.includes(q));
    }
    // Filtros
    list = list.filter((c) => {
      const card = cards[c.numero];
      const iaAtiva = !(pauses[c.numero] ?? false);
      const tipo = card?.stage_id ? stages.find((s) => s.id === card.stage_id)?.tipo : null;
      const resolvida = tipo === "ganho" || tipo === "perda";
      switch (filter) {
        case "nao_lidas": return (unread[c.numero] ?? 0) > 0;
        case "aguardando_humano": return !resolvida && (!iaAtiva || (c.last.direcao === "entrada" && c.last.autor === "contato"));
        case "minhas": return card?.owner_id === userId;
        case "ia_ativa": return iaAtiva && !resolvida;
        case "resolvidas": return resolvida;
        default: return true;
      }
    });
    return list.sort((a, b) => +new Date(b.last.created_at) - +new Date(a.last.created_at));
  }, [msgs, search, filter, unread, cards, pauses, stages, userId]);

  const thread = useMemo(() =>
    [...msgs].filter((m) => m.numero === active).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [msgs, active]);

  const activeConv = conversations.find((c) => c.numero === active) ?? (active ? { numero: active, nome: cards[active]?.nome ?? null, last: thread[thread.length - 1] } : null);
  const activeCard = active ? cards[active] : undefined;
  const activeStage = activeCard?.stage_id ? stages.find((s) => s.id === activeCard.stage_id) : null;
  const iaAtivaAqui = active ? !(pauses[active] ?? false) : true;

  // Keyboard shortcuts (after conversations is declared)
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t as any).isContentEditable);
      if (ev.key === "/" && t === composerRef.current && (composerRef.current?.value ?? "") === "") {
        ev.preventDefault();
        setShowTemplatePicker(true);
        return;
      }
      if (ev.key === "Escape") setShowTemplatePicker(false);
      if (typing) return;
      if (ev.key === "j" || ev.key === "k") {
        ev.preventDefault();
        const idx = conversations.findIndex((c) => c.numero === active);
        const next = ev.key === "j" ? Math.min(conversations.length - 1, idx + 1) : Math.max(0, idx - 1);
        const target = conversations[next];
        if (target) setActive(target.numero);
      } else if (ev.key === "r" && active) {
        ev.preventDefault();
        composerRef.current?.focus();
      } else if (ev.key === "e" && active) {
        ev.preventDefault();
        void toggleIa(false);
      } else if (ev.key === "/") {
        ev.preventDefault();
        composerRef.current?.focus();
        setShowTemplatePicker(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [active, conversations.length]);


  async function toggleIa(v: boolean) {
    if (!active) return;
    setPauses((p) => ({ ...p, [active]: !v })); // optimistic
    try { await toggleIaFn({ data: { numero: active, ativa: v } }); }
    catch (e: any) { toast.error(e?.message); setPauses((p) => ({ ...p, [active]: v })); }
  }

  async function assumir() {
    if (!active) return;
    await toggleIa(false);
    toast.success("Você assumiu este atendimento. IA pausada.");
  }

  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSec(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSec((s) => s + 1);
      }, 1000);
    } catch (e: any) {
      toast.error("Não foi possível acessar o microfone: " + (e?.message || e));
    }
  }

  async function stopVoiceRecording(shouldSend: boolean) {
    if (!mediaRecorderRef.current) return;
    clearInterval(recordTimerRef.current);
    const recorder = mediaRecorderRef.current;

    recorder.onstop = async () => {
      setRecording(false);
      setRecordSec(0);
      recorder.stream.getTracks().forEach((t) => t.stop());
      if (!shouldSend || audioChunksRef.current.length === 0 || !active) return;

      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const tempId = `${OPTIMISTIC_PREFIX}${crypto.randomUUID()}`;
        const optimistic: Msg = {
          id: tempId, numero: active, contato_nome: activeConv?.nome ?? null,
          direcao: "saida", autor: "humano", texto: "🎤 [Nota de Voz]",
          created_at: new Date().toISOString(), user_id: userId, status_entrega: null,
        };
        setMsgs((p) => [optimistic, ...p].slice(0, 500));
        try {
          const res: any = await sendMediaFn({
            data: { numero: active, base64, isVoice: true, contatoNome: activeConv?.nome ?? null }
          });
          if (res?.mensagem) applyIncoming(res.mensagem as Msg);
          toast.success("Áudio enviado!");
        } catch (e: any) {
          toast.error(e?.message || "Falha ao enviar áudio");
        }
      };
      reader.readAsDataURL(blob);
    };

    recorder.stop();
  }

  async function handleFileUpload(file: File) {
    if (!active || !file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      const filename = file.name;
      const tempId = `${OPTIMISTIC_PREFIX}${crypto.randomUUID()}`;
      const optimistic: Msg = {
        id: tempId, numero: active, contato_nome: activeConv?.nome ?? null,
        direcao: "saida", autor: "humano", texto: `📎 [Arquivo: ${filename}]`,
        created_at: new Date().toISOString(), user_id: userId, status_entrega: null,
      };
      setMsgs((p) => [optimistic, ...p].slice(0, 500));
      try {
        const res: any = await sendMediaFn({
          data: { numero: active, base64, filename, caption: filename, contatoNome: activeConv?.nome ?? null }
        });
        if (res?.mensagem) applyIncoming(res.mensagem as Msg);
        toast.success("Arquivo enviado!");
      } catch (e: any) {
        toast.error(e?.message || "Falha ao enviar arquivo");
      }
    };
    reader.readAsDataURL(file);
  }

  async function sendMsg(text?: string) {
    const txt = (text ?? composer).trim();
    if (!txt || !active || !companyId) return;
    const numero = active;
    const nome = activeConv?.nome ?? null;

    const isNote = isInternalNote;
    const tempId = `${OPTIMISTIC_PREFIX}${crypto.randomUUID()}`;
    const optimistic: Msg = {
      id: tempId, numero, contato_nome: nome,
      direcao: "saida", autor: "humano",
      texto: isNote ? `🔒 [NOTA INTERNA]: ${txt}` : txt,
      created_at: new Date().toISOString(), user_id: userId, status_entrega: null,
    };
    setMsgs((p) => [optimistic, ...p].slice(0, 500));
    setComposer("");
    setSending(true);
    try {
      let res: any;
      if (isNote) {
        res = await sendNoteFn({ data: { numero, texto: txt, contatoNome: nome } });
      } else {
        res = await sendFn({ data: { numero, texto: txt, contatoNome: nome } });
      }
      if (res?.mensagem) applyIncoming(res.mensagem as Msg);
      else setMsgs((p) => p.filter((x) => x.id !== tempId));
    } catch (e: any) {
      setMsgs((p) => p.filter((x) => x.id !== tempId));
      setComposer((c) => c || txt);
      toast.error(e?.message ?? "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight flex items-center gap-2">Conversas <HelpTip text="Caixa de entrada unificada do WhatsApp. Filtre por status, assuma um atendimento manualmente, envie CSAT e responda em nome do agente." /></h1>
          <p className="text-sm text-muted-foreground">Inbox em tempo real do WhatsApp</p>
        </div>
        <FilterTabs value={filter} onChange={setFilter} counts={{
          nao_lidas: Object.values(unread).reduce((a, b) => a + b, 0),
          aguardando_humano: countsAguardandoHumano,
        }} />
      </header>

      <div className="grid md:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_300px] border border-[color:var(--hairline)] rounded-2xl overflow-hidden h-[calc(100vh-200px)] min-h-[500px] bg-[color:var(--panel)]">
        {/* LISTA */}
        <aside className="border-r border-[color:var(--hairline)] flex flex-col min-h-0 bg-[color:var(--panel)]">
          <div className="p-3 border-b border-[color:var(--hairline)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar contato ou mensagem…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
          <ul className="flex-1 overflow-auto">
            {conversations.length === 0 && (
              <li className="p-8 text-sm text-muted-foreground text-center">Nenhuma conversa neste filtro.</li>
            )}
            {conversations.map((c) => {
              const on = c.numero === active;
              const u = unread[c.numero] ?? 0;
              const iaAtiva = !(pauses[c.numero] ?? false);
              const card = cards[c.numero];
              const tipo = card?.stage_id ? stages.find((s) => s.id === card.stage_id)?.tipo : null;
              const resolvida = tipo === "ganho" || tipo === "perda";
              const aguardandoHumano = !resolvida && (!iaAtiva || (c.last.direcao === "entrada" && c.last.autor === "contato"));

              return (
                <li key={c.numero}>
                  <button
                    onClick={() => handleSelectConversation(c.numero)}
                    className={`relative w-full text-left flex gap-3 p-3 border-b border-[color:var(--hairline)] transition-colors ${
                      on ? "bg-[color:var(--brand-soft)]" : "hover:bg-[color:var(--panel-2)]"
                    }`}
                  >
                    {on && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--brand)]" />}
                    <InitialsAvatar name={c.nome || c.numero} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <b className="text-[13.5px] truncate">{c.nome || c.numero}</b>
                        <span className="ml-auto text-[10.5px] text-muted-foreground whitespace-nowrap">
                          {new Date(c.last.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[12.5px] text-muted-foreground truncate flex-1">{c.last.texto}</p>
                        {aguardandoHumano ? (
                          <span title="Aguardando atendimento humano" className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 animate-pulse">
                            <Hand className="size-2.5" /> Humano
                          </span>
                        ) : iaAtiva ? (
                          <span title="IA ativa" className="text-[color:var(--brand-text)]"><Bot className="size-3" /></span>
                        ) : null}
                        {u > 0 && (
                          <span className="bg-[color:var(--brand)] text-primary-foreground text-[10px] font-bold min-w-[18px] h-[18px] rounded-full grid place-items-center px-1">
                            {u}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* THREAD */}
        <section className="flex flex-col min-h-0 bg-[color:var(--panel-2)]">
          {!active ? (
            <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
              <div className="text-center"><MessageSquareText className="mx-auto mb-2 size-6" />Selecione uma conversa</div>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 px-4 py-3 border-b border-[color:var(--hairline)] bg-[color:var(--panel)] flex-wrap">
                <InitialsAvatar name={activeConv?.nome || active} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{activeConv?.nome || active}</span>
                    {stages.length > 0 && (
                      <Select
                        value={activeCard?.stage_id || ""}
                        onValueChange={(val) => void handleUpdateStage(val)}
                      >
                        <SelectTrigger className="h-6 text-[11px] px-2 py-0 rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-2)] max-w-[130px]">
                          <SelectValue placeholder="Sem etapa" />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((st) => (
                            <SelectItem key={st.id} value={st.id} className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <span className="size-2 rounded-full" style={{ backgroundColor: st.cor }} />
                                {st.nome}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {members.length > 0 && (
                      <Select
                        value={activeCard?.owner_id || "none"}
                        onValueChange={(val) => void handleAssignOwner(val === "none" ? null : val)}
                      >
                        <SelectTrigger className="h-6 text-[11px] px-2 py-0 rounded-full border border-[color:var(--hairline)] bg-[color:var(--panel-2)] max-w-[140px]">
                          <span className="flex items-center gap-1 truncate text-xs">
                            <User className="size-3 text-muted-foreground shrink-0" />
                            <SelectValue placeholder="Responsável" />
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" className="text-xs">Sem responsável</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id} className="text-xs">
                              {m.nome || m.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    <span className="text-[11px] text-muted-foreground font-mono mr-1">{active}</span>
                    {(activeCard?.tags ?? []).map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--panel-2)] text-muted-foreground border border-[color:var(--hairline)] font-medium">
                        #{t}
                        <button onClick={() => void handleRemoveTag(t)} className="hover:text-red-500 font-bold ml-0.5">×</button>
                      </span>
                    ))}
                    {showAddTag ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          autoFocus
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); void handleAddTag(newTagInput); }
                            else if (e.key === "Escape") setShowAddTag(false);
                          }}
                          placeholder="Tag + Enter"
                          className="h-5 text-[10px] w-20 px-1.5 rounded border border-[color:var(--hairline)] bg-[color:var(--panel-2)] outline-none"
                        />
                        <button onClick={() => setShowAddTag(false)} className="text-muted-foreground hover:text-foreground text-xs">×</button>
                      </span>
                    ) : (
                      <button onClick={() => setShowAddTag(true)} className="text-[10.5px] text-[color:var(--brand-text)] hover:underline font-medium">
                        + Tag
                      </button>
                    )}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleGenerateSummary()}
                    className="bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20"
                  >
                    <Sparkles className="size-3.5 mr-1 text-purple-600 dark:text-purple-400" /> Resumo IA
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleForwardSummary()}
                    disabled={forwardingSummary}
                    title="Gera resumo com IA e encaminha via WhatsApp para a equipe"
                    className="bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {forwardingSummary ? <Loader2 className="size-3.5 animate-spin mr-1 text-emerald-600" /> : <PhoneForwarded className="size-3.5 mr-1 text-emerald-600 dark:text-emerald-400" />}
                    Encaminhar
                  </Button>
                  <label className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
                    <Bot className="size-3.5" /> IA
                    <Switch checked={iaAtivaAqui} onCheckedChange={(v) => void toggleIa(v)} />
                  </label>
                  <Button size="sm" variant="outline" onClick={() => void assumir()}>
                    <Hand className="size-3.5 mr-1" /> Assumir
                  </Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!active) return;
                    try {
                      await sendCsatFn({ data: { numero: active, contatoNome: activeConv?.nome ?? null } });
                      toast.success("Pesquisa de satisfação enviada");
                    } catch (e: any) { toast.error(e?.message ?? "Erro ao enviar"); }
                  }}>
                    <Star className="size-3.5 mr-1" /> CSAT
                  </Button>
                </div>
              </header>

              <div ref={threadRef} className="flex-1 overflow-auto p-4 flex flex-col gap-2.5">
                {thread.map((m) => (
                  <Bubble
                    key={m.id}
                    m={m}
                    onTranscribe={handleTranscribeAudio}
                    onPreviewImage={setImagePreviewUrl}
                  />
                ))}
              </div>

              {/* Quick replies & Copiloto IA */}
              <div className="px-4 py-2 border-t border-[color:var(--hairline)] bg-[color:var(--panel)] flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 shrink-0">
                      <Sparkles className="size-3 text-amber-500" /> Copiloto IA:
                    </span>
                    <button
                      type="button"
                      disabled={aiSuggesting}
                      onClick={() => void handleSuggestReply("vendas")}
                      className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-[color:var(--panel-2)] hover:bg-amber-500/15 hover:text-amber-700 dark:hover:text-amber-300 font-semibold border border-[color:var(--hairline)] transition"
                    >
                      {aiSuggesting ? <Loader2 className="size-3 animate-spin inline mr-1" /> : "⚡ Fechamento"}
                    </button>
                    <button
                      type="button"
                      disabled={aiSuggesting}
                      onClick={() => void handleSuggestReply("curto")}
                      className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-[color:var(--panel-2)] hover:bg-[color:var(--brand-soft)] hover:text-[color:var(--brand-text)] font-semibold border border-[color:var(--hairline)] transition"
                    >
                      💬 Curta
                    </button>
                    <button
                      type="button"
                      disabled={aiSuggesting}
                      onClick={() => void handleSuggestReply("consultivo")}
                      className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-[color:var(--panel-2)] hover:bg-purple-500/15 hover:text-purple-700 dark:hover:text-purple-300 font-semibold border border-[color:var(--hairline)] transition"
                    >
                      🎯 Consultiva
                    </button>
                  </div>

                  {composer.trim() && (
                    <button
                      type="button"
                      disabled={polishing}
                      onClick={() => void handlePolishDraft()}
                      className="text-[11px] px-2.5 py-1 rounded-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-700 dark:text-purple-300 font-bold transition flex items-center gap-1 ml-auto shrink-0 shadow-sm"
                    >
                      {polishing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                      {polishing ? "Polindo..." : "Melhorar Texto com IA"}
                    </button>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto pt-0.5">
                  {QUICK_REPLIES.map((q) => (
                    <button key={q} onClick={() => void sendMsg(q)}
                      className="shrink-0 text-[11.5px] px-2.5 py-1 rounded-full bg-[color:var(--panel-2)] hover:bg-[color:var(--brand-soft)] hover:text-[color:var(--brand-text)] text-muted-foreground transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,application/pdf,.doc,.docx,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileUpload(f);
                  e.currentTarget.value = "";
                }}
              />

              <form onSubmit={(e) => { e.preventDefault(); void sendMsg(); }}
                className="px-4 py-3 border-t border-[color:var(--hairline)] bg-[color:var(--panel)] flex gap-2 items-center relative">

                {recording ? (
                  <div className="flex-1 flex items-center justify-between bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 rounded-full px-4 py-2 text-sm font-semibold animate-pulse">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full bg-red-500 animate-ping" />
                      Gravando áudio… {Math.floor(recordSec / 60)}:{(recordSec % 60).toString().padStart(2, "0")}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => stopVoiceRecording(false)}>
                        <X className="size-3.5 mr-1" /> Cancelar
                      </Button>
                      <Button type="button" size="sm" className="h-8 bg-red-600 hover:bg-red-700 text-white text-xs" onClick={() => stopVoiceRecording(true)}>
                        <Send className="size-3.5 mr-1" /> Enviar Áudio
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsInternalNote(!isInternalNote)}
                      title={isInternalNote ? "Modo Nota Interna ativo (não envia ao WhatsApp)" : "Alternar para Nota Interna da Equipe"}
                      className={`p-2 rounded-full transition-colors ${
                        isInternalNote ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-2 ring-amber-500/40" : "text-muted-foreground hover:bg-[color:var(--panel-2)]"
                      }`}
                    >
                      <Lock className="size-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Anexar arquivo ou imagem"
                      className="p-2 rounded-full text-muted-foreground hover:bg-[color:var(--panel-2)] transition-colors"
                    >
                      <Paperclip className="size-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setPixModalOpen(true)}
                      title="Cobrar com PIX Copia e Cola (Padrão BACEN / OpenWA)"
                      className="p-2 rounded-full text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                    >
                      <CreditCard className="size-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                      title="Respostas Rápidas (/)"
                      className={`p-2 rounded-full transition-colors ${
                        showTemplatePicker ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : "text-muted-foreground hover:bg-[color:var(--panel-2)]"
                      }`}
                    >
                      <Zap className="size-4" />
                    </button>

                    {showTemplatePicker && (
                      <div className="absolute bottom-[calc(100%+6px)] left-4 right-16 max-h-64 overflow-auto bg-[color:var(--panel)] border border-[color:var(--hairline)] rounded-xl shadow-lg z-10 p-1">
                        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[color:var(--hairline)] mb-1">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Respostas Rápidas</span>
                          <button
                            type="button"
                            onClick={() => { setShowTemplatePicker(false); setManageTemplatesOpen(true); }}
                            className="text-[11px] text-[color:var(--brand-text)] hover:underline font-medium"
                          >
                            + Gerenciar
                          </button>
                        </div>
                        {templates.length === 0 ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">
                            Nenhum template cadastrado.{" "}
                            <button
                              type="button"
                              onClick={() => { setShowTemplatePicker(false); setManageTemplatesOpen(true); }}
                              className="text-[color:var(--brand-text)] underline"
                            >
                              Criar primeiro
                            </button>
                          </div>
                        ) : (
                          templates.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => handleSelectTemplate(t.texto)}
                              className="w-full text-left flex gap-2 px-2 py-2 rounded-md hover:bg-[color:var(--panel-2)] text-sm"
                            >
                              <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">/{t.atalho}</code>
                              <span className="truncate text-muted-foreground">{t.texto}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    <input
                      ref={composerRef}
                      value={composer}
                      onChange={(e) => {
                        const v = e.target.value;
                        setComposer(v);
                        if (active && v) {
                          clearTimeout(typingTimeoutRef.current);
                          typingTimeoutRef.current = setTimeout(() => {
                            void sendPresenceFn({ data: { numero: active, presence: "composing" } });
                          }, 400);
                        }
                        if (v.startsWith("/")) {
                          setShowTemplatePicker(true);
                          const slug = v.slice(1).split(/\s/)[0].toLowerCase();
                          const hit = templates.find((t) => t.atalho === slug);
                          if (hit && v.endsWith(" ")) {
                            setComposer(hit.texto);
                            setShowTemplatePicker(false);
                          }
                        } else {
                          setShowTemplatePicker(false);
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === "Escape") setShowTemplatePicker(false); }}
                      placeholder={isInternalNote ? "🔒 Digite uma nota interna para a equipe…" : "Digite uma mensagem… (digite / para templates)"}
                      disabled={sending}
                      className={`flex-1 border rounded-full px-4 py-2.5 text-sm outline-none transition-colors ${
                        isInternalNote
                          ? "bg-amber-500/10 border-amber-500/40 focus:border-amber-500 text-amber-900 dark:text-amber-100 placeholder:text-amber-700/60"
                          : "bg-[color:var(--panel-2)] border-[color:var(--hairline)] focus:border-[color:var(--brand)]/60"
                      }`}
                    />

                    {!composer.trim() && (
                      <button
                        type="button"
                        onClick={startVoiceRecording}
                        title="Gravar nota de voz"
                        className="size-10 rounded-full grid place-items-center text-muted-foreground hover:bg-[color:var(--panel-2)] hover:text-foreground transition"
                      >
                        <Mic className="size-4" />
                      </button>
                    )}

                    <button
                      type="submit" disabled={sending || !composer.trim()}
                      className={`size-10 rounded-full grid place-items-center text-primary-foreground transition disabled:opacity-50 ${
                        isInternalNote ? "bg-amber-600 hover:brightness-110" : "bg-[color:var(--brand)] hover:brightness-110"
                      }`}
                      aria-label="Enviar"
                    >
                      <Send className="size-4" />
                    </button>
                  </>
                )}
              </form>
            </>
          )}
        </section>

        {/* INFO */}
        <aside className="hidden xl:flex flex-col gap-4 border-l border-[color:var(--hairline)] p-5 bg-[color:var(--panel)] overflow-auto">
          {!active ? (
            <p className="text-xs text-muted-foreground text-center mt-6">Selecione uma conversa para ver os detalhes.</p>
          ) : (
            <>
              <div className="flex flex-col items-center text-center gap-2 pb-4 border-b border-[color:var(--hairline)]">
                <InitialsAvatar name={activeConv?.nome || active} size={72} />
                <div>
                  <div className="font-semibold text-sm">{activeConv?.nome || active}</div>
                  <div className="text-[11.5px] text-muted-foreground font-mono">{active}</div>
                </div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Etapa CRM</div>
                {activeStage ? (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-full ring-1"
                    style={{ background: `color-mix(in oklab, ${activeStage.cor} 18%, transparent)`, color: activeStage.cor, borderColor: `color-mix(in oklab, ${activeStage.cor} 35%, transparent)` } as any}>
                    <Sparkles className="size-3.5" /> {activeStage.nome}
                  </span>
                ) : <span className="text-xs text-muted-foreground">Sem etapa</span>}
              </div>
              {(activeCard?.tags ?? []).length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {(activeCard?.tags ?? []).map((t) => (
                      <span key={t} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[color:var(--panel-2)] text-muted-foreground border border-[color:var(--hairline)]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {activeCard?.observacao && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">Observações</div>
                  <p className="text-[13px] text-foreground/85 whitespace-pre-wrap">{activeCard.observacao}</p>
                </div>
              )}
              {activeCard && (
                <Button variant="outline" size="sm" onClick={() => setDrawerCard(activeCard)}>
                  <ExternalLink className="size-3.5 mr-1.5" /> Abrir ficha do lead
                </Button>
              )}
              <div className="mt-auto pt-3 border-t border-[color:var(--hairline)] text-[11.5px] text-muted-foreground flex items-center gap-1.5">
                <User className="size-3" /> {thread.length} mensagens nesta conversa
              </div>
            </>
          )}
        </aside>
      </div>

      {/* DIALOG DE RESUMO IA */}
      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Sparkles className="size-4 text-purple-600 dark:text-purple-400" /> Resumo Inteligente da Conversa
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {summaryLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-6 animate-spin text-purple-600" />
                <span>O Google Gemini está analisando o histórico da conversa...</span>
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto space-y-3 text-xs leading-relaxed border border-[color:var(--hairline)] rounded-xl p-4 bg-[color:var(--panel-2)] whitespace-pre-wrap font-sans">
                {summaryText}
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:justify-between items-center flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(summaryText);
                toast.success("Copiado para a área de transferência!");
              }}
              disabled={summaryLoading || !summaryText}
            >
              Copiar
            </Button>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSummaryOpen(false)}
              >
                Fechar
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSaveSummaryAsNote()}
                disabled={summaryLoading || !summaryText}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
              >
                <Lock className="size-3.5 mr-1" /> Nota Interna
              </Button>
              <Button
                size="sm"
                onClick={() => void handleForwardSummary()}
                disabled={summaryLoading || forwardingSummary}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              >
                {forwardingSummary ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <PhoneForwarded className="size-3.5 mr-1" />}
                Encaminhar no WhatsApp
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE GERENCIAR RESPOSTAS RÁPIDAS */}
      <Dialog open={manageTemplatesOpen} onOpenChange={setManageTemplatesOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Zap className="size-4 text-amber-500" /> Respostas Rápidas (Templates)
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="border border-[color:var(--hairline)] bg-[color:var(--panel-2)] p-3 rounded-xl space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Nova Resposta Rápida</div>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <Input
                  placeholder="atalho (ex: pix)"
                  value={newTplAtalho}
                  onChange={(e) => setNewTplAtalho(e.target.value.replace(/^\/+/, ""))}
                  className="text-xs font-mono"
                />
                <Input
                  placeholder="Texto da mensagem..."
                  value={newTplTexto}
                  onChange={(e) => setNewTplTexto(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void handleSaveTemplate()}
                  disabled={savingTpl}
                  className="text-xs h-8"
                >
                  {savingTpl ? <Loader2 className="size-3 animate-spin mr-1" /> : <Plus className="size-3 mr-1" />}
                  Cadastrar Atalho
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              <div className="text-xs font-semibold text-muted-foreground">Atalhos Cadastrados ({templates.length})</div>
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum template cadastrado ainda.</p>
              ) : (
                templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-start justify-between gap-2 p-2.5 rounded-lg border border-[color:var(--hairline)] bg-[color:var(--panel)] text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-[color:var(--brand-text)]">/{tpl.atalho}</div>
                      <div className="text-muted-foreground truncate mt-0.5">{tpl.texto}</div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleDeleteTemplate(tpl.id)}
                      className="size-7 text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setManageTemplatesOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE COBRANÇA PIX (OPENWA / BACEN) */}
      <Dialog open={pixModalOpen} onOpenChange={setPixModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <CreditCard className="size-5 text-emerald-500" /> Cobrança Instantânea via PIX
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-muted-foreground leading-relaxed">
              O sistema gera o código oficial <b>BACEN PIX Copia e Cola</b> e envia no WhatsApp para o cliente pagar com 1 toque.
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Valor a Cobrar (R$)</label>
              <Input
                autoFocus
                placeholder="Ex: 150,00"
                value={pixValorInput}
                onChange={(e) => setPixValorInput(e.target.value)}
                className="text-lg font-bold text-emerald-600 dark:text-emerald-400"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Descrição do Pedido / Serviço (opcional)</label>
              <Input
                placeholder="Ex: Entrada do Pedido #123"
                value={pixDescInput}
                onChange={(e) => setPixDescInput(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPixModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSendPix()}
              disabled={sendingPix || !pixValorInput.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {sendingPix ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Send className="size-3.5 mr-1.5" />}
              {sendingPix ? "Gerando e Enviando..." : "Enviar PIX no WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE ZOOM DE IMAGEM */}
      <Dialog open={!!imagePreviewUrl} onOpenChange={(o) => !o && setImagePreviewUrl(null)}>
        <DialogContent className="max-w-2xl p-2 bg-black/90 border-zinc-800">
          {imagePreviewUrl && (
            <div className="relative flex flex-col items-center justify-center p-2">
              <img
                src={imagePreviewUrl}
                alt="Visualização de Mídia"
                className="max-h-[80vh] w-auto object-contain rounded-lg"
              />
              <div className="flex justify-end w-full mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs text-white bg-zinc-800 border-zinc-700"
                  onClick={() => window.open(imagePreviewUrl, "_blank")}
                >
                  <ExternalLink className="size-3.5 mr-1" /> Abrir original
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {companyId && (
        <LeadDrawer
          card={drawerCard} stages={stages} members={members} companyId={companyId}
          onClose={() => setDrawerCard(null)}
          onChanged={() => { if (companyId) void load(companyId); }}
        />
      )}
    </div>
  );
}

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
  counts: { nao_lidas: number; aguardando_humano?: number };
}) {
  const opts: { v: Filter; label: string; badge?: number; color?: string }[] = [
    { v: "todas", label: "Todas" },
    { v: "nao_lidas", label: "Não lidas", badge: counts.nao_lidas },
    { v: "aguardando_humano", label: "Aguardando Humano", badge: counts.aguardando_humano, color: "bg-amber-500 text-black" },
    { v: "minhas", label: "Atribuídas a mim" },
    { v: "ia_ativa", label: "IA ativa" },
    { v: "resolvidas", label: "Resolvidas" },
  ];
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-[color:var(--hairline)] bg-[color:var(--panel)] p-1 gap-0.5">
      {opts.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 text-[12.5px] font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
            value === o.v ? "bg-[color:var(--brand-soft)] text-[color:var(--brand-text)]" : "text-muted-foreground hover:text-foreground"
          }`}>
          {o.label}
          {o.badge ? (
            <span className={`${o.color || "bg-[color:var(--brand)] text-primary-foreground"} text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] grid place-items-center`}>
              {o.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Bubble({
  m,
  onTranscribe,
  onPreviewImage,
}: {
  m: Msg;
  onTranscribe?: (msgId: string, currentText: string) => void;
  onPreviewImage?: (url: string) => void;
}) {
  const isInternal = m.texto.startsWith("🔒 [NOTA INTERNA]:");
  const isOut = m.direcao === "saida";
  const ia = m.autor === "ia";
  const displayText = isInternal ? m.texto.replace("🔒 [NOTA INTERNA]:", "").trim() : m.texto;
  const isAudio = m.texto.includes("[Áudio]") || m.texto.includes("[Audio]") || m.texto.startsWith("🎤");
  const hasTranscription = m.texto.includes("📝 Transcrição:");
  const isReceipt = m.texto.includes("[Comprovante de Pagamento Recebido:");

  // Detecta URLs de imagem no texto
  const imgMatch = m.texto.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)/i) ||
    m.texto.match(/\[Foto do Produto:\s*(https?:\/\/[^\]]+)\]/i);
  const imageUrl = imgMatch ? (imgMatch[1] || imgMatch[0]) : null;

  if (isInternal) {
    return (
      <div className="flex justify-center my-1">
        <div className="max-w-[85%] sm:max-w-[70%] px-4 py-2.5 text-[13px] bg-amber-500/15 border border-amber-500/40 text-amber-900 dark:text-amber-200 rounded-2xl shadow-sm">
          <div className="flex items-center gap-1.5 font-bold text-[10.5px] uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
            <Lock className="size-3" /> Nota Interna — Visível apenas para a equipe
          </div>
          <div className="whitespace-pre-wrap break-words">{displayText}</div>
          <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-1 text-right">
            {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] sm:max-w-[62%] px-3.5 py-2.5 text-[13.5px] ${
          isOut
            ? "bg-[color:var(--brand)] text-primary-foreground rounded-2xl rounded-br-md font-medium shadow-sm"
            : "bg-[color:var(--panel)] text-foreground rounded-2xl rounded-bl-md border border-[color:var(--hairline)] shadow-sm"
        }`}
      >
        {isOut && (
          <span className="block text-[9.5px] font-bold opacity-80 mb-1 uppercase tracking-wider">
            {ia ? "⚡ Agente IA" : "Atendente"}
          </span>
        )}

        {/* Card visual de Comprovante de Pagamento PIX */}
        {isReceipt ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-2.5 my-1 text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-1.5 font-bold text-[11px] text-emerald-700 dark:text-emerald-300 mb-1">
              🧾 Comprovante PIX Reconhecido por IA
            </div>
            <div className="text-xs font-medium">{displayText}</div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">{displayText}</div>
        )}

        {/* Visualização de imagem na thread */}
        {imageUrl && (
          <div className="mt-2 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 max-w-sm">
            <img
              src={imageUrl}
              alt="Mídia"
              onClick={() => onPreviewImage?.(imageUrl)}
              className="w-full max-h-48 object-cover rounded-lg cursor-pointer hover:opacity-95 transition"
            />
          </div>
        )}

        {/* Botão de cópia para PIX Copia e Cola */}
        {m.texto.includes("PIX Copia e Cola") && (
          <button
            type="button"
            onClick={() => {
              const codeMatch = m.texto.match(/```([^`]+)```/);
              if (codeMatch) {
                void navigator.clipboard.writeText(codeMatch[1].trim());
                toast.success("Código PIX copiado!");
              }
            }}
            className="mt-2 text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/30 transition font-bold"
          >
            <Copy className="size-3" /> Copiar Código PIX
          </button>
        )}

        {isAudio && !hasTranscription && onTranscribe && (
          <button
            type="button"
            onClick={() => onTranscribe(m.id, m.texto)}
            className="mt-2 text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[color:var(--brand-soft)] text-[color:var(--brand-text)] hover:brightness-95 transition font-medium"
          >
            <Sparkles className="size-3" /> Transcrever Áudio com IA
          </button>
        )}
        <div className={`text-[10.5px] mt-1 flex items-center gap-1 ${isOut ? "opacity-80 justify-end" : "text-muted-foreground"}`}>
          {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          {isOut && m.status_entrega && <DeliveryTick status={m.status_entrega} />}
        </div>
      </div>
    </div>
  );
}

function DeliveryTick({ status }: { status: string }) {
  if (status === "falhou") return <span title="Falha no envio" className="text-red-200">⚠</span>;
  if (status === "lido") return <span title="Lido" className="text-sky-200 font-semibold">✓✓</span>;
  if (status === "entregue") return <span title="Entregue">✓✓</span>;
  return <span title="Enviado">✓</span>;
}
