import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lembretes de visita dentro do painel, para a equipe nunca ser pega de surpresa:
 * - ao abrir o dia: "Hoje: 2 visitas — 10:00 Juliana · 14:00 Valeria" (uma vez por dia)
 * - fim de tarde: "Amanhã: visita de Fulano às 10:00" (uma vez por dia)
 * - contagem: faltam 60 / 30 / 10 min e "agora", com notificação do navegador se a aba
 *   estiver em segundo plano
 * Cada aviso dispara uma vez por navegador (localStorage), mesmo recarregando a página.
 * Devolve quantas visitas ainda faltam hoje, para o selo no menu.
 */
type Visita = { id: string; inicio: string; fim: string; titulo: string; nome: string; numero: string | null };

const TZ = "America/Sao_Paulo";
const LIMIARES_MIN = [60, 30, 10];
const HORA_AVISO_AMANHA = 15; // a partir das 15h o painel lembra o dia seguinte

const chaveDia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hora = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const horaAgora = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));

function jaAvisou(chave: string): boolean {
  try { return localStorage.getItem(`lembrete:${chave}`) === "1"; } catch { return false; }
}
function marcarAvisado(chave: string) {
  try { localStorage.setItem(`lembrete:${chave}`, "1"); } catch {}
}
function notificar(titulo: string, corpo: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
      new Notification(titulo, { body: corpo, tag: `visita:${titulo}:${corpo}` });
    }
  } catch {}
}

export function useLembretesVisitas(companyId?: string | null): { hoje: number } {
  const navigate = useNavigate();
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [hoje, setHoje] = useState(0);
  const visitasRef = useRef<Visita[]>([]);
  visitasRef.current = visitas;

  // Carrega de agora-1h até o fim de amanhã; recarrega a cada 5 min e quando a agenda muda.
  useEffect(() => {
    if (!companyId) return;
    let vivo = true;
    async function carregar() {
      const agora = new Date();
      const fimAmanha = new Date(agora); fimAmanha.setDate(fimAmanha.getDate() + 2); fimAmanha.setHours(0, 0, 0, 0);
      const { data } = await (supabase as any)
        .from("agendamento")
        .select("id, titulo, inicio, fim, crm_cards(nome, nome_whatsapp, numero)")
        .eq("company_id", companyId)
        .eq("status", "agendado")
        .gte("fim", new Date(agora.getTime() - 60 * 60_000).toISOString())
        .lt("inicio", fimAmanha.toISOString())
        .order("inicio", { ascending: true });
      if (!vivo) return;
      setVisitas(((data ?? []) as any[]).map((r) => ({
        id: r.id, inicio: r.inicio, fim: r.fim, titulo: r.titulo,
        nome: r.crm_cards?.nome || r.crm_cards?.nome_whatsapp || r.crm_cards?.numero || r.titulo,
        numero: r.crm_cards?.numero ?? null,
      })));
    }
    void carregar();
    const timer = setInterval(() => { void carregar(); }, 5 * 60_000);
    const ch = supabase
      .channel(`tenant:${companyId}:lembretes-visitas`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agendamento", filter: `company_id=eq.${companyId}` }, () => { void carregar(); })
      .subscribe();
    return () => { vivo = false; clearInterval(timer); supabase.removeChannel(ch); };
  }, [companyId]);

  // Resumo do dia e de amanhã: uma vez por dia, assim que a lista chega.
  useEffect(() => {
    if (!visitas.length) { setHoje(0); return; }
    const agora = new Date();
    const kHoje = chaveDia(agora);
    const amanhaD = new Date(agora); amanhaD.setDate(amanhaD.getDate() + 1);
    const kAmanha = chaveDia(amanhaD);
    const deHoje = visitas.filter((v) => chaveDia(new Date(v.inicio)) === kHoje);
    const deAmanha = visitas.filter((v) => chaveDia(new Date(v.inicio)) === kAmanha);
    setHoje(deHoje.filter((v) => +new Date(v.fim) > agora.getTime()).length);

    const abrir = (numero: string | null) => () =>
      numero ? navigate({ to: "/app/conversas", search: { numero } as any }) : navigate({ to: "/app/agenda" });

    if (deHoje.length && !jaAvisou(`dia:${kHoje}`)) {
      marcarAvisado(`dia:${kHoje}`);
      const lista = deHoje.map((v) => `${hora(v.inicio)} ${v.nome}`).join(" · ");
      toast.info(`Hoje: ${deHoje.length} ${deHoje.length === 1 ? "visita" : "visitas"}`, {
        description: lista, duration: 20_000,
        action: { label: "Agenda", onClick: () => navigate({ to: "/app/agenda" }) },
      });
    }
    if (deAmanha.length && horaAgora() >= HORA_AVISO_AMANHA && !jaAvisou(`amanha:${kHoje}`)) {
      marcarAvisado(`amanha:${kHoje}`);
      const lista = deAmanha.map((v) => `${hora(v.inicio)} ${v.nome}`).join(" · ");
      toast.info(`Amanhã: ${deAmanha.length === 1 ? `visita de ${deAmanha[0].nome} às ${hora(deAmanha[0].inicio)}` : `${deAmanha.length} visitas`}`, {
        description: deAmanha.length === 1 ? deAmanha[0].titulo : lista, duration: 20_000,
        action: { label: "Agenda", onClick: () => navigate({ to: "/app/agenda" }) },
      });
    }
    void abrir;
  }, [visitas, navigate]);

  // Contagem regressiva: checa a cada 30 s. Cada limiar avisa uma vez por visita.
  useEffect(() => {
    if (!companyId) return;
    const tick = () => {
      const agora = Date.now();
      for (const v of visitasRef.current) {
        const faltamMin = (new Date(v.inicio).getTime() - agora) / 60_000;
        for (const t of LIMIARES_MIN) {
          if (faltamMin <= t && faltamMin > t - 1 && !jaAvisou(`${v.id}:${t}`)) {
            marcarAvisado(`${v.id}:${t}`);
            const titulo = `Faltam ${t} min: visita de ${v.nome}`;
            toast.warning(titulo, {
              description: `${hora(v.inicio)} · ${v.titulo}`, duration: 30_000,
              action: { label: v.numero ? "Abrir conversa" : "Agenda", onClick: () => v.numero ? navigate({ to: "/app/conversas", search: { numero: v.numero } as any }) : navigate({ to: "/app/agenda" }) },
            });
            notificar(titulo, `${hora(v.inicio)} · ${v.titulo}`);
          }
        }
        if (faltamMin <= 0 && faltamMin > -1 && !jaAvisou(`${v.id}:agora`)) {
          marcarAvisado(`${v.id}:agora`);
          const titulo = `Agora: visita de ${v.nome}`;
          toast.success(titulo, { description: v.titulo, duration: 30_000 });
          notificar(titulo, v.titulo);
        }
      }
      // Selo do menu acompanha o relógio, não só o carregamento.
      const kHoje = chaveDia(new Date());
      setHoje(visitasRef.current.filter((v) => chaveDia(new Date(v.inicio)) === kHoje && +new Date(v.fim) > agora).length);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [companyId, navigate]);

  return { hoje };
}
