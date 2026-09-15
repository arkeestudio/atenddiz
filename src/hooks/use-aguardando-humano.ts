import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

function chime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.22].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime + t);
      gain.gain.setValueAtTime(0.18, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch {}
}

/**
 * Fila "aguardando humano" da empresa: devolve quantos contatos esperam a equipe e
 * avisa (som + toast + notificação do navegador) quando a IA transfere alguém.
 */
export function useAguardandoHumano(companyId?: string | null) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const waiting = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!companyId) return;
    let alive = true;

    async function load() {
      const { data } = await supabase
        .from("crm_cards")
        .select("*")
        .eq("company_id", companyId!)
        .eq("aguardando_humano" as any, true);
      if (!alive) return;
      waiting.current = new Set(((data ?? []) as any[]).map((r) => r.numero));
      setCount(waiting.current.size);
    }
    void load();

    const ch = supabase
      .channel(`tenant:${companyId}:aguardando-humano`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_cards", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const row = payload.new as any;
          if (!row?.numero) return;
          const set = waiting.current;
          if (row.aguardando_humano && !set.has(row.numero)) {
            set.add(row.numero);
            setCount(set.size);
            const nome = row.nome || row.numero;
            const motivo = row.transferencia_motivo || "Pediu atendimento humano";
            chime();
            toast(`🙋 ${nome} precisa de atendimento`, {
              description: motivo,
              duration: 20_000,
              action: {
                label: "Abrir",
                onClick: () => navigate({ to: "/app/conversas", search: { numero: row.numero } as any }),
              },
            });
            try {
              if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
                new Notification(`${nome} precisa de atendimento`, { body: motivo, tag: `humano:${row.numero}` });
              }
            } catch {}
          } else if (!row.aguardando_humano && set.has(row.numero)) {
            set.delete(row.numero);
            setCount(set.size);
          }
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [companyId, navigate]);

  return count;
}
