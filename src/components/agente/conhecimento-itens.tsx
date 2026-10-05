import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, Loader2, Lightbulb } from "lucide-react";

// Um item = um fato que a Lia precisa saber. Entra no prompt como lista. Salva na hora,
// sem passar pelo "Salvar" geral da página: quem está no atendimento e descobre uma
// informação nova adiciona em 20 segundos e volta para a conversa.
export type ConhecimentoItem = {
  id: string;
  titulo: string;
  texto: string;
  atualizado_em: string;
  por?: string | null;
};

const MAX_ITENS = 60;

export function normalizeConhecimentoItens(raw: unknown): ConhecimentoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => ({
      id: String(r?.id ?? "").trim() || cryptoId(),
      titulo: String(r?.titulo ?? "").trim(),
      texto: String(r?.texto ?? "").trim(),
      atualizado_em: String(r?.atualizado_em ?? "") || new Date(0).toISOString(),
      por: r?.por ? String(r.por) : null,
    }))
    .filter((r) => r.titulo || r.texto)
    .slice(0, MAX_ITENS);
}

function cryptoId(): string {
  try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); }
}

function quando(iso: string): string {
  const d = new Date(iso);
  if (!+d || +d === 0) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ConhecimentoItens({ companyId }: { companyId: string }) {
  const [itens, setItens] = useState<ConhecimentoItem[] | null>(null);
  const [semColuna, setSemColuna] = useState(false);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [quem, setQuem] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      setQuem(u.user?.email?.split("@")[0] ?? null);
      const { data, error } = await (supabase as any)
        .from("agent_config")
        .select("conhecimento_itens")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error && /conhecimento_itens/.test(error.message)) { setSemColuna(true); setItens([]); return; }
      setItens(normalizeConhecimentoItens(data?.conhecimento_itens));
    })();
  }, [companyId]);

  async function persistir(novos: ConhecimentoItem[]) {
    setSalvando(true);
    const { error } = await (supabase as any)
      .from("agent_config")
      .update({ conhecimento_itens: novos })
      .eq("company_id", companyId);
    setSalvando(false);
    if (error) {
      if (/conhecimento_itens/.test(error.message)) setSemColuna(true);
      toast.error(error.message);
      return false;
    }
    setItens(novos);
    return true;
  }

  function abrirNovo() {
    setEditando("novo"); setTitulo(""); setTexto("");
  }
  function abrirEdicao(it: ConhecimentoItem) {
    setEditando(it.id); setTitulo(it.titulo); setTexto(it.texto);
  }
  async function confirmar() {
    const t = titulo.trim(), x = texto.trim();
    if (!x) return toast.error("Escreva a informação.");
    const agora = new Date().toISOString();
    const atual = itens ?? [];
    const novos = editando === "novo"
      ? [{ id: cryptoId(), titulo: t || x.slice(0, 40), texto: x, atualizado_em: agora, por: quem }, ...atual]
      : atual.map((it) => (it.id === editando ? { ...it, titulo: t || it.titulo, texto: x, atualizado_em: agora, por: quem } : it));
    if (novos.length > MAX_ITENS) return toast.error(`Máximo de ${MAX_ITENS} informações. Junte itens parecidos ou mova para a base de conhecimento.`);
    if (await persistir(novos)) {
      toast.success(editando === "novo" ? "Informação adicionada — a IA já usa na próxima resposta." : "Informação atualizada.");
      setEditando(null);
    }
  }
  async function remover(it: ConhecimentoItem) {
    if (!window.confirm(`Remover "${it.titulo}"? A IA deixa de saber isso.`)) return;
    if (await persistir((itens ?? []).filter((x) => x.id !== it.id))) toast.success("Removida.");
  }

  if (semColuna) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
        Este recurso precisa de uma atualização no banco (coluna <code>conhecimento_itens</code>). Rode a migração
        <code> supabase/migrations/20261005120000_conhecimento_itens.sql</code> e recarregue a página.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Um fato por item, do jeito que você diria para uma atendente nova: <i>"Em novembro a visita é só às terças"</i>,{" "}
        <i>"Não temos vaga no Berçário I até março"</i>. Entra na próxima resposta da IA, sem precisar salvar a página.
      </p>

      {editando === "novo" && (
        <Editor titulo={titulo} texto={texto} setTitulo={setTitulo} setTexto={setTexto} salvando={salvando}
          onOk={() => void confirmar()} onCancel={() => setEditando(null)} />
      )}

      {itens === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : itens.length === 0 && editando !== "novo" ? (
        <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-[var(--border)] rounded-xl">
          Nenhuma informação avulsa ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {itens.map((it) => (
            <li key={it.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
              {editando === it.id ? (
                <Editor titulo={titulo} texto={texto} setTitulo={setTitulo} setTexto={setTexto} salvando={salvando}
                  onOk={() => void confirmar()} onCancel={() => setEditando(null)} />
              ) : (
                <div className="flex items-start gap-3">
                  <Lightbulb className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{it.titulo}</div>
                    <p className="text-[12.5px] text-foreground/85 whitespace-pre-wrap mt-0.5">{it.texto}</p>
                    <div className="text-[10.5px] text-muted-foreground mt-1">
                      {it.por ? `${it.por} · ` : ""}{quando(it.atualizado_em)}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button type="button" size="icon" variant="ghost" className="size-7" title="Editar" onClick={() => abrirEdicao(it)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="size-7 hover:text-destructive" title="Remover" onClick={() => void remover(it)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editando !== "novo" && (
        <Button type="button" size="sm" onClick={abrirNovo} className="text-xs">
          <Plus className="size-3.5 mr-1" /> Adicionar informação
        </Button>
      )}
    </div>
  );
}

function Editor({ titulo, texto, setTitulo, setTexto, salvando, onOk, onCancel }: {
  titulo: string; texto: string; setTitulo: (v: string) => void; setTexto: (v: string) => void;
  salvando: boolean; onOk: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--brand)]/40 bg-[var(--panel)] p-3">
      <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título curto (ex: Visitas em novembro)" className="text-xs" autoFocus />
      <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} className="text-xs"
        placeholder="A informação, como você diria para uma atendente nova. Ex: Em novembro as visitas com a coordenação são só às terças, das 9h às 12h."
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onOk(); if (e.key === "Escape") onCancel(); }} />
      <div className="flex items-center gap-2 justify-end">
        <span className="text-[10.5px] text-muted-foreground mr-auto">Ctrl+Enter salva</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}><X className="size-3.5 mr-1" /> Cancelar</Button>
        <Button type="button" size="sm" className="h-7 text-xs" onClick={onOk} disabled={salvando}>
          {salvando ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Check className="size-3.5 mr-1" />} Salvar
        </Button>
      </div>
    </div>
  );
}
