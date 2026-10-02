import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const NOTA_INTERNA = "🔒 [NOTA INTERNA]:";

/**
 * Avisos da IA para a equipe, em tempo real. Quando a IA marca uma visita (ou falha ao
 * marcar), ela grava uma nota interna na conversa; aqui essa nota vira um alerta no painel
 * com botão para abrir a conversa. Transferência para humano já tem o seu próprio alerta
 * (useAguardandoHumano), então fica de fora para não avisar duas vezes.
 */
export function useAvisosSistema(companyId?: string | null) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!companyId) return;
    const ch = supabase
      .channel(`tenant:${companyId}:avisos-sistema`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensagens", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const row = payload.new as any;
          if (!row?.numero || row.autor !== "sistema") return;
          const texto: string = String(row.texto || "");
          if (!texto.startsWith(NOTA_INTERNA)) return;
          const corpo = texto.slice(NOTA_INTERNA.length).trim();
          // Só agenda (📅 marcada, ⚠️ problema ao marcar). Transferência (🙋) já avisa por outro caminho.
          if (!/^(📅|⚠️)/.test(corpo)) return;
          const nome = row.contato_nome || row.numero;
          const abrir = () => navigate({ to: "/app/conversas", search: { numero: row.numero } as any });
          const fn = corpo.startsWith("📅") ? toast.success : toast.warning;
          fn(nome, { description: corpo, duration: 15_000, action: { label: "Abrir", onClick: abrir } });
          try {
            if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
              new Notification(nome, { body: corpo, tag: `agenda:${row.numero}` });
            }
          } catch {}
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [companyId, navigate]);
}
