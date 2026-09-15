import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Hand, Loader2, Save, Sparkles, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { normalizeFichaCampos, type FichaCampo } from "@/lib/ficha-campos";
import { atualizarFichaIa, salvarFicha, marcarAtendido } from "@/lib/ficha.functions";

export type FichaCard = {
  numero: string;
  ficha?: Record<string, string> | null;
  ficha_resumo?: string | null;
  ficha_proximo_passo?: string | null;
  ficha_atualizada_em?: string | null;
  aguardando_humano?: boolean | null;
  aguardando_desde?: string | null;
  transferencia_motivo?: string | null;
};

const camposCache = new Map<string, FichaCampo[]>();

export function useFichaCampos(companyId?: string | null) {
  const [campos, setCampos] = useState<FichaCampo[] | null>(companyId ? camposCache.get(companyId) ?? null : null);
  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    void supabase
      .from("agent_config")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        const c = normalizeFichaCampos((data as any)?.ficha_campos);
        camposCache.set(companyId, c);
        if (alive) setCampos(c);
      });
    return () => { alive = false; };
  }, [companyId]);
  return campos;
}

function formatWhen(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? `hoje às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Ficha do atendimento: preenchida pela IA, editável pela equipe. */
export function FichaAtendimento({
  companyId,
  card,
  onChanged,
}: {
  companyId: string;
  card: FichaCard | null | undefined;
  onChanged?: () => void;
}) {
  const campos = useFichaCampos(companyId);
  const atualizarFn = useServerFn(atualizarFichaIa);
  const salvarFn = useServerFn(salvarFicha);
  const atendidoFn = useServerFn(marcarAtendido);

  // "base" = último estado salvo (vindo do banco, do salvar ou da IA); o formulário é comparado com ele.
  const [base, setBase] = useState<{ ficha: Record<string, string>; resumo: string; proximo: string; em: string | null }>({
    ficha: {}, resumo: "", proximo: "", em: null,
  });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState("");
  const [proximo, setProximo] = useState("");
  const [aguardando, setAguardando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);

  function aplicar(ficha: Record<string, string>, r: string, p: string, em: string | null) {
    setBase({ ficha: { ...ficha }, resumo: r, proximo: p, em });
    setValores({ ...ficha });
    setResumo(r);
    setProximo(p);
  }

  // Recarrega o formulário quando o card muda no banco (IA atualizou, outra pessoa salvou).
  const assinatura = JSON.stringify([card?.numero, card?.ficha, card?.ficha_resumo, card?.ficha_proximo_passo, card?.ficha_atualizada_em]);
  useEffect(() => {
    aplicar(
      (card?.ficha as Record<string, string>) || {},
      card?.ficha_resumo || "",
      card?.ficha_proximo_passo || "",
      card?.ficha_atualizada_em || null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  useEffect(() => { setAguardando(!!card?.aguardando_humano); }, [card?.numero, card?.aguardando_humano]);

  const dirty = useMemo(() => {
    if (base.resumo !== resumo || base.proximo !== proximo) return true;
    return (campos ?? []).some((c) => (base.ficha[c.id] ?? "") !== (valores[c.id] ?? ""));
  }, [base, campos, valores, resumo, proximo]);

  if (!card) {
    return (
      <p className="text-xs text-muted-foreground">
        A ficha é criada quando o contato manda a primeira mensagem.
      </p>
    );
  }

  async function atualizarComIa() {
    if (!card) return;
    setAtualizando(true);
    try {
      const res = await atualizarFn({ data: { numero: card.numero } });
      aplicar(res.ficha, res.resumo, res.proximoPasso, new Date().toISOString());
      toast.success("Ficha atualizada com a conversa.");
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível atualizar a ficha.");
    } finally {
      setAtualizando(false);
    }
  }

  async function salvar() {
    if (!card) return;
    setSalvando(true);
    try {
      await salvarFn({ data: { numero: card.numero, ficha: valores, resumo, proximoPasso: proximo } });
      setBase((b) => ({ ...b, ficha: { ...valores }, resumo: resumo.trim(), proximo: proximo.trim() }));
      setResumo((r) => r.trim());
      setProximo((p) => p.trim());
      toast.success("Ficha salva.");
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível salvar a ficha.");
    } finally {
      setSalvando(false);
    }
  }

  async function atendido() {
    if (!card) return;
    setResolvendo(true);
    try {
      await atendidoFn({ data: { numero: card.numero } });
      setAguardando(false);
      toast.success("Contato saiu da fila de atendimento humano.");
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível atualizar.");
    } finally {
      setResolvendo(false);
    }
  }

  return (
    <div className="space-y-3">
      {aguardando && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-amber-700 dark:text-amber-300">
            <Hand className="size-3.5" /> Aguardando atendimento humano
          </div>
          <div className="text-[12px] text-foreground/85 space-y-0.5">
            {card.transferencia_motivo && <div><b>Motivo:</b> {card.transferencia_motivo}</div>}
            {card.aguardando_desde && <div className="text-muted-foreground">Desde {formatWhen(card.aguardando_desde)}</div>}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => void atendido()} disabled={resolvendo}>
            {resolvendo ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1" />}
            Marcar como atendido
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">Ficha do atendimento</div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void atualizarComIa()} disabled={atualizando}>
          {atualizando ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Sparkles className="size-3 mr-1" />}
          Atualizar com IA
        </Button>
      </div>
      {base.em && (
        <p className="text-[10.5px] text-muted-foreground -mt-2">Atualizada pela IA {formatWhen(base.em)}</p>
      )}

      <div className="space-y-1">
        <Label className="text-[11px]">Resumo</Label>
        <Textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={3} className="text-[12.5px]"
          placeholder="O que o contato quer e o que já foi combinado" />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Próximo passo</Label>
        <Input value={proximo} onChange={(e) => setProximo(e.target.value)} className="h-8 text-[12.5px]"
          placeholder="O que a equipe deve fazer agora" />
      </div>

      {campos === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        campos.map((c) => (
          <div key={c.id} className="space-y-1">
            <Label className="text-[11px]">{c.label}</Label>
            <Input
              value={valores[c.id] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [c.id]: e.target.value }))}
              placeholder={c.dica || "—"}
              className="h-8 text-[12.5px]"
            />
          </div>
        ))
      )}

      {dirty && (
        <Button size="sm" className="w-full" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Save className="size-3.5 mr-1.5" />}
          Salvar ficha
        </Button>
      )}
    </div>
  );
}
