import { createFileRoute } from "@tanstack/react-router";
import { HelpTip } from "@/components/help-tip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brand } from "@/config/brand";
import { toast } from "sonner";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { LeadDrawer, type LeadCard, type Stage, type Member } from "@/components/crm/lead-drawer";
import { Plus, Upload, Search } from "lucide-react";
import Papa from "papaparse";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { createContact, importContacts } from "@/lib/plan.functions";
import { PlanUsageBadge } from "@/components/plan-usage-badge";
import { usePlanFeatures } from "@/hooks/use-plan-features";

export const Route = createFileRoute("/app/contatos")({
  head: () => ({ meta: [{ title: `${brand.name} — Contatos` }] }),
  component: ContatosPage,
});

function ContatosPage() {
  const ctx = Route.useRouteContext();
  const companyId = ctx.company?.id;
  const plan = usePlanFeatures();
  const createContactFn = useServerFn(createContact);
  const importContactsFn = useServerFn(importContacts);
  const [cards, setCards] = useState<LeadCard[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [stageId, setStageId] = useState<string>("todos");
  const [active, setActive] = useState<LeadCard | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoNumero, setNovoNumero] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!companyId) return;
    const [{ data: c }, { data: st }, { data: cu }] = await Promise.all([
      supabase.from("crm_cards").select("*").eq("company_id", companyId).order("ultima_em", { ascending: false }),
      supabase.from("crm_stage").select("id,nome,cor,ordem,tipo").eq("company_id", companyId).order("ordem", { ascending: true }),
      supabase.from("company_user").select("user_id,profiles(nome,email)").eq("company_id", companyId).eq("ativo", true),
    ]);
    setCards((c ?? []) as any);
    setStages((st ?? []) as any);
    setMembers(((cu ?? []) as any[]).map((m) => ({
      user_id: m.user_id, email: m.profiles?.email ?? null, nome: m.profiles?.nome ?? null,
    })));
  }
  useEffect(() => { void load(); }, [companyId]);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (stageId !== "todos" && c.stage_id !== stageId) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (c.nome ?? "").toLowerCase().includes(q) || c.numero.includes(q);
      }
      return true;
    });
  }, [cards, search, stageId]);

  function stageOf(card: LeadCard) {
    return stages.find((s) => s.id === card.stage_id) ?? null;
  }

  async function criarNovo() {
    if (!novoNumero.trim()) return;
    try {
      await createContactFn({ data: { numero: novoNumero.trim(), nome: novoNome.trim() || null } });
      toast.success("Contato criado");
      setNovoNome(""); setNovoNumero(""); setNewOpen(false);
      await Promise.all([load(), plan.refresh()]);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao criar");
    }
  }

  function importCSV(file: File) {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (res) => {
        const rows = (res.data as any[]).map((r) => {
          const nome = (r.nome ?? r.name ?? r.Nome ?? "").toString().trim() || null;
          const numero = (r.telefone ?? r.phone ?? r.Telefone ?? r.numero ?? "").toString().replace(/\D/g, "");
          return { nome, numero };
        }).filter((r) => r.numero.length >= 8);
        if (rows.length === 0) return toast.error("Nenhuma linha válida (precisa de coluna nome/telefone).");
        try {
          const r = await importContactsFn({ data: { contatos: rows } });
          toast.success(`${r.inseridos ?? rows.length} contato(s) importado(s)`);
          await Promise.all([load(), plan.refresh()]);
        } catch (e: any) {
          toast.error(e?.message || "Falha ao importar");
        }
      },
      error: (e) => toast.error(e.message),
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-tight flex items-center gap-2">Contatos <HelpTip text="Sua base de clientes. Cada contato representa um número de WhatsApp e guarda todo o histórico de conversa e dados do CRM." /></h1>
          <p className="text-sm text-muted-foreground">Todos os leads gerados pelo WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!plan.loading && (
            <PlanUsageBadge label="contatos" used={plan.usage.contatos} limit={plan.limites.contatos} />
          )}
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCSV(f); e.currentTarget.value = ""; }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4 mr-2" /> Importar CSV
          </Button>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="size-4 mr-2" /> Novo contato
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou número…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={stageId} onValueChange={setStageId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os estágios</SelectItem>
            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground ml-auto">{filtered.length} contatos</div>
      </div>

      <div className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--panel)] overflow-hidden">
        <div className="grid grid-cols-12 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-[color:var(--panel-2)] px-5 py-3 border-b border-[color:var(--hairline)]">
          <div className="col-span-4">Contato</div>
          <div className="col-span-2">Número</div>
          <div className="col-span-2">Etapa</div>
          <div className="col-span-2">Valor</div>
          <div className="col-span-2">Última atividade</div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</div>
        ) : (
          <ul className="divide-y divide-[color:var(--hairline)]">
            {filtered.map((c) => {
              const st = stageOf(c);
              return (
                <li key={c.id}>
                  <button onClick={() => setActive(c)} className="w-full grid grid-cols-12 px-5 py-3.5 items-center text-[14px] text-left hover:bg-[color:var(--panel-2)] transition-colors">
                    <div className="col-span-4 flex items-center gap-3 min-w-0">
                      <InitialsAvatar name={c.nome || c.nome_whatsapp || c.numero} size={36} src={c.foto_url} />
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{c.nome || c.nome_whatsapp || "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">{(c.tags ?? []).slice(0, 3).join(", ") || c.origem || "—"}</div>
                      </div>
                    </div>
                    <div className="col-span-2 text-muted-foreground font-mono text-[12.5px] truncate">{c.numero}</div>
                    <div className="col-span-2">
                      {st ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full ring-1"
                          style={{ background: `color-mix(in oklab, ${st.cor} 18%, transparent)`, color: st.cor, borderColor: `color-mix(in oklab, ${st.cor} 35%, transparent)` } as any}>
                          <span className="size-1.5 rounded-full" style={{ background: st.cor }} />
                          {st.nome}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <div className="col-span-2 font-semibold">
                      {(c.valor ?? 0) > 0 ? `R$ ${Number(c.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span className="text-muted-foreground font-normal">—</span>}
                    </div>
                    <div className="col-span-2 text-muted-foreground text-[12.5px] truncate">
                      {new Date(c.ultima_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {companyId && (
        <LeadDrawer
          card={active} stages={stages} members={members} companyId={companyId}
          onClose={() => setActive(null)}
          onChanged={() => { void load(); }}
        />
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo contato</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nome</Label><Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do contato" /></div>
            <div className="space-y-1.5"><Label>Telefone (com DDI)</Label><Input value={novoNumero} onChange={(e) => setNovoNumero(e.target.value)} placeholder="5511999998888" inputMode="numeric" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button onClick={criarNovo} disabled={!novoNumero.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
