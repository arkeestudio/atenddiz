import { createFileRoute } from "@tanstack/react-router";

/**
 * Confirmação de visita no dia anterior. Chamado por pg_cron de hora em hora (como o
 * process-campaigns).
 *
 * Regras, nesta ordem:
 * - visita "agendado" que começa entre 20h e 28h a partir de agora (= amanhã);
 * - uma mensagem só por visita (lead_evento "confirmacao_visita" com [ag:id]);
 * - só entre 9h e 19h de Brasília — ninguém quer confirmação às 2 da manhã;
 * - só se o contato escreveu nas últimas 24h: fora da janela a mensagem é "fria" e é
 *   exatamente o que faz o WhatsApp bloquear o número. Quem não escreveu há mais de um
 *   dia fica para a equipe ligar;
 * - contato na fila humana não recebe: a equipe está cuidando.
 * A resposta ("vou", "não vou", "pode remarcar") cai na IA, que já sabe o que fazer.
 */
export const Route = createFileRoute("/api/public/hooks/confirmar-visitas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const segredo = process.env.HOOKS_SECRET?.trim();
          if (segredo && request.headers.get("x-hooks-secret") !== segredo) {
            return new Response("unauthorized", { status: 401 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");
          const { descreverHorario } = await import("@/lib/agenda.server");
          const admin = supabaseAdmin as any;

          const horaBrasilia = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
          if (horaBrasilia < 9 || horaBrasilia >= 19) {
            return Response.json({ ok: true, skipped: "fora do horário", hora: horaBrasilia });
          }

          const agora = Date.now();
          const { data: visitas } = await admin
            .from("agendamento")
            .select("id, titulo, inicio, fim, company_id, card_id, crm_cards(numero, nome, nome_whatsapp, aguardando_humano)")
            .eq("status", "agendado")
            .not("card_id", "is", null)
            .gte("inicio", new Date(agora + 20 * 3_600_000).toISOString())
            .lte("inicio", new Date(agora + 28 * 3_600_000).toISOString())
            .limit(100);

          const resultado: any[] = [];
          for (const v of (visitas ?? []) as any[]) {
            const card = v.crm_cards;
            const numero: string | null = card?.numero ?? null;
            if (!numero) { resultado.push({ id: v.id, skipped: "sem numero" }); continue; }
            if (card.aguardando_humano) { resultado.push({ id: v.id, skipped: "fila humana" }); continue; }

            const { data: jaEnviada } = await admin
              .from("lead_evento")
              .select("id")
              .eq("card_id", v.card_id)
              .eq("tipo", "confirmacao_visita")
              .like("descricao", `%[ag:${v.id}]%`)
              .limit(1);
            if (jaEnviada?.length) { resultado.push({ id: v.id, skipped: "ja enviada" }); continue; }

            const { data: recente } = await admin
              .from("mensagens")
              .select("id")
              .eq("company_id", v.company_id)
              .eq("numero", numero)
              .eq("direcao", "entrada")
              .gte("created_at", new Date(agora - 24 * 3_600_000).toISOString())
              .limit(1);
            if (!recente?.length) { resultado.push({ id: v.id, skipped: "fora da janela de 24h" }); continue; }

            const { data: inst } = await admin
              .from("whatsapp_instances")
              .select("instance_name, status, user_id")
              .eq("company_id", v.company_id)
              .maybeSingle();
            if (!inst?.instance_name || (inst.status !== "connected" && inst.status !== "open")) {
              resultado.push({ id: v.id, skipped: "sem whatsapp" }); continue;
            }

            const { data: cfg } = await admin
              .from("agent_config")
              .select("nome_agente, nome_empresa")
              .eq("company_id", v.company_id)
              .maybeSingle();

            const primeiroNome = String(card.nome || card.nome_whatsapp || "").trim().split(/\s+/)[0] || "";
            const quando = descreverHorario(new Date(v.inicio));
            const texto =
              `Oi${primeiroNome ? `, ${primeiroNome}` : ""}! Aqui é ${cfg?.nome_agente ? `a ${cfg.nome_agente}` : "a assistente"}${cfg?.nome_empresa ? `, do ${cfg.nome_empresa}` : ""}. ` +
              `Passando para confirmar a visita de amanhã, ${quando}${v.titulo ? ` (${v.titulo})` : ""}. Podemos contar com você? 😊`;

            try {
              const provider = getWhatsAppProvider();
              const sent: any = await provider.sendText(v.company_id, inst.instance_name, numero, texto);
              await admin.from("mensagens").insert({
                company_id: v.company_id,
                user_id: inst.user_id,
                numero,
                contato_nome: card.nome ?? null,
                direcao: "saida",
                autor: "ia",
                texto,
                whatsapp_message_id: typeof sent?.messageId === "string" ? sent.messageId : null,
                status_entrega: "enviado",
              });
              await admin.from("lead_evento").insert({
                company_id: v.company_id, card_id: v.card_id, tipo: "confirmacao_visita",
                descricao: `Confirmação da visita de ${quando} enviada ao cliente [ag:${v.id}]`,
              });
              resultado.push({ id: v.id, enviada: true });
            } catch (e: any) {
              console.error("[confirmar-visitas] envio falhou", v.id, e?.message);
              resultado.push({ id: v.id, erro: e?.message });
            }
          }

          return Response.json({ ok: true, hora: horaBrasilia, resultado });
        } catch (e: any) {
          console.error("[confirmar-visitas]", e);
          return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});
