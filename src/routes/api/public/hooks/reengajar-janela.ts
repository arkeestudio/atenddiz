import { createFileRoute } from "@tanstack/react-router";

/**
 * Reengajamento antes de a janela de 24h fechar. Chamado por pg_cron a cada 30 min.
 *
 * Para quem: a última mensagem DO CLIENTE tem entre 21h e 23h, e depois dela só houve
 * resposta nossa (ele ficou em silêncio). Então, uma vez por conversa, a IA pergunta se
 * ficou alguma dúvida e oferece ligação da equipe — ainda dentro da janela, sem risco de
 * mensagem fria.
 *
 * Não manda para: lead ganho/perdido, contato na fila humana, empresa com o recurso
 * desligado, WhatsApp fora do ar, fora das 9h–19h de Brasília, ou se já mandou nas últimas 24h.
 */
export const Route = createFileRoute("/api/public/hooks/reengajar-janela")({
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
          const admin = supabaseAdmin as any;

          const horaBrasilia = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
          if (horaBrasilia < 9 || horaBrasilia >= 19) {
            return Response.json({ ok: true, skipped: "fora do horário", hora: horaBrasilia });
          }

          const { data: empresas } = await admin
            .from("agent_config")
            .select("company_id, nome_agente, nome_empresa")
            .eq("reengajamento_ativo", true)
            .limit(200);

          const agora = Date.now();
          const de = new Date(agora - 23 * 3_600_000).toISOString();
          const ate = new Date(agora - 21 * 3_600_000).toISOString();
          const resultado: any[] = [];

          for (const emp of (empresas ?? []) as any[]) {
            const companyId = emp.company_id as string;
            const { data: inst } = await admin
              .from("whatsapp_instances")
              .select("instance_name, status, user_id")
              .eq("company_id", companyId)
              .maybeSingle();
            if (!inst?.instance_name || (inst.status !== "connected" && inst.status !== "open")) {
              resultado.push({ companyId, skipped: "sem whatsapp" });
              continue;
            }

            // Candidatos: quem escreveu entre 21h e 23h atrás.
            const { data: entradas } = await admin
              .from("mensagens")
              .select("numero, created_at, contato_nome")
              .eq("company_id", companyId)
              .eq("direcao", "entrada")
              .gte("created_at", de)
              .lt("created_at", ate)
              .order("created_at", { ascending: false })
              .limit(500);
            const porNumero = new Map<string, { created_at: string; contato_nome: string | null }>();
            for (const m of (entradas ?? []) as any[]) if (!porNumero.has(m.numero)) porNumero.set(m.numero, m);

            for (const [numero, ultimaEntrada] of porNumero) {
              // Ele escreveu de novo depois? Então a janela foi renovada; não é caso.
              const { data: maisNova } = await admin
                .from("mensagens").select("id").eq("company_id", companyId).eq("numero", numero)
                .eq("direcao", "entrada").gt("created_at", ultimaEntrada.created_at).limit(1);
              if (maisNova?.length) { resultado.push({ numero, skipped: "escreveu depois" }); continue; }

              // A última mensagem da conversa tem que ser nossa (ele ficou em silêncio).
              const { data: ultima } = await admin
                .from("mensagens").select("direcao, autor, texto").eq("company_id", companyId).eq("numero", numero)
                .not("texto", "like", "🔒 [NOTA INTERNA]%")
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
              if (!ultima || ultima.direcao !== "saida") { resultado.push({ numero, skipped: "sem resposta nossa" }); continue; }

              const { data: card } = await admin
                .from("crm_cards").select("id, nome, aguardando_humano, stage_id, crm_stage(tipo)")
                .eq("company_id", companyId).eq("numero", numero).maybeSingle();
              if (card?.aguardando_humano) { resultado.push({ numero, skipped: "fila humana" }); continue; }
              const tipo = card?.crm_stage?.tipo;
              if (tipo === "ganho" || tipo === "perda") { resultado.push({ numero, skipped: `lead ${tipo}` }); continue; }

              if (card?.id) {
                const { data: jaFez } = await admin
                  .from("lead_evento").select("id").eq("card_id", card.id).eq("tipo", "reengajamento")
                  .gte("created_at", new Date(agora - 24 * 3_600_000).toISOString()).limit(1);
                if (jaFez?.length) { resultado.push({ numero, skipped: "ja enviado" }); continue; }
              }

              const primeiroNome = String(card?.nome || ultimaEntrada.contato_nome || "").trim().split(/\s+/)[0] || "";
              const texto =
                `Oi${primeiroNome ? `, ${primeiroNome}` : ""}! Aqui é ${emp.nome_agente ? `a ${emp.nome_agente}` : "a assistente"}${emp.nome_empresa ? `, do ${emp.nome_empresa}` : ""}. ` +
                `Ficou alguma dúvida que eu possa ajudar? Se preferir, alguém da equipe pode te ligar — é só me dizer. 😊`;

              try {
                const provider = getWhatsAppProvider();
                const sent: any = await provider.sendText(companyId, inst.instance_name, numero, texto);
                await admin.from("mensagens").insert({
                  company_id: companyId, user_id: inst.user_id, numero,
                  contato_nome: card?.nome ?? ultimaEntrada.contato_nome ?? null,
                  direcao: "saida", autor: "ia", texto,
                  whatsapp_message_id: typeof sent?.messageId === "string" ? sent.messageId : null,
                  status_entrega: "enviado",
                });
                if (card?.id) {
                  await admin.from("lead_evento").insert({
                    company_id: companyId, card_id: card.id, tipo: "reengajamento",
                    descricao: "IA perguntou se ficou dúvida e ofereceu ligação, antes de a janela de 24h fechar",
                  });
                }
                resultado.push({ numero, enviado: true });
              } catch (e: any) {
                console.error("[reengajar-janela] envio falhou", numero, e?.message);
                resultado.push({ numero, erro: e?.message });
              }
            }
          }

          return Response.json({ ok: true, hora: horaBrasilia, resultado });
        } catch (e: any) {
          console.error("[reengajar-janela]", e);
          return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});
