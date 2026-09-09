import { createFileRoute } from "@tanstack/react-router";

/**
 * Worker chamado por pg_cron a cada minuto.
 * Processa até N envios por execução, respeitando intervalos anti-ban.
 */
export const Route = createFileRoute("/api/public/hooks/process-campaigns")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");

          // Promove agendadas que chegaram a hora
          await supabaseAdmin
            .from("campaign")
            .update({ status: "enviando" })
            .eq("status", "agendada")
            .lte("proximo_envio_em", new Date().toISOString());

          const { data: due } = await supabaseAdmin
            .from("campaign")
            .select("*")
            .eq("status", "enviando")
            .lte("proximo_envio_em", new Date().toISOString())
            .limit(10);

          const processed: any[] = [];
          for (const c of (due ?? []) as any[]) {
            // Carrega instância WhatsApp da empresa
            const { data: inst } = await supabaseAdmin
              .from("whatsapp_instances")
              .select("instance_name, status")
              .eq("company_id", c.company_id)
              .maybeSingle();
            if (!inst || (inst.status !== "open" && inst.status !== "connected")) {
              processed.push({ id: c.id, skipped: "sem_whatsapp" });
              continue;
            }

            // Quantos enviar agora (cap por execução)
            let batchSize = 5;

            // Modo aquecimento (colunas podem não existir ainda -> degrada sem quebrar o envio).
            const { data: warm } = await (supabaseAdmin as any)
              .from("whatsapp_instances")
              .select("aquecimento_ativo, aquecimento_limite_dia")
              .eq("company_id", c.company_id)
              .maybeSingle();
            if (warm?.aquecimento_ativo) {
              const limiteDia = warm.aquecimento_limite_dia ?? 50;
              const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
              const { count: enviados24h } = await supabaseAdmin
                .from("campaign_target")
                .select("id", { count: "exact", head: true })
                .eq("company_id", c.company_id)
                .eq("status", "enviado")
                .gte("enviado_em", since);
              const restante = limiteDia - (enviados24h ?? 0);
              if (restante <= 0) {
                // Bateu o limite do dia: adia a campanha e não envia mais agora.
                await supabaseAdmin.from("campaign").update({
                  proximo_envio_em: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                }).eq("id", c.id);
                processed.push({ id: c.id, skipped: "aquecimento_limite", enviados24h });
                continue;
              }
              batchSize = Math.min(batchSize, restante);
            }
            const { data: pending } = await supabaseAdmin
              .from("campaign_target")
              .select("id, contato_numero, contato_nome")
              .eq("campaign_id", c.id)
              .eq("status", "pendente")
              .limit(batchSize);

            if (!pending || pending.length === 0) {
              await supabaseAdmin.from("campaign").update({
                status: "concluida",
                concluido_em: new Date().toISOString(),
              }).eq("id", c.id);
              processed.push({ id: c.id, done: true });
              continue;
            }

            let enviados = 0;
            let falhas = 0;
            for (const t of pending as any[]) {
              try {
                const texto = String(c.mensagem || "").replace(/\{\{nome\}\}/gi, t.contato_nome || "");
                const provider = getWhatsAppProvider();
                if (c.media_url && provider.sendMedia) {
                  await provider.sendMedia(c.company_id, inst.instance_name, t.contato_numero, c.media_url, texto);
                } else {
                  await provider.sendText(c.company_id, inst.instance_name, t.contato_numero, texto);
                }
                await supabaseAdmin.from("campaign_target").update({
                  status: "enviado",
                  enviado_em: new Date().toISOString(),
                }).eq("id", t.id);
                if (c.created_by) {
                  await supabaseAdmin.from("mensagens").insert({
                    company_id: c.company_id,
                    user_id: c.created_by,
                    numero: t.contato_numero,
                    contato_nome: t.contato_nome,
                    direcao: "saida",
                    autor: "sistema",
                    texto,
                  });
                }
                enviados++;
              } catch (e: any) {
                await supabaseAdmin.from("campaign_target").update({
                  status: "falhou",
                  erro: String(e?.message ?? e).slice(0, 500),
                }).eq("id", t.id);
                falhas++;
              }
            }

            // Calcula próximo envio com intervalo aleatório
            const minS = Math.max(2, c.intervalo_min_seg ?? 5);
            const maxS = Math.max(minS, c.intervalo_max_seg ?? 20);
            let nextDelaySeg = Math.floor(minS + Math.random() * (maxS - minS + 1));

            // Anti-ban: pausa longa a cada N envios
            const totalEnviados = (c.total_enviados ?? 0) + enviados;
            const pausaApos = c.pausa_apos_envios ?? 50;
            const pausaDurMin = c.pausa_duracao_min ?? 10;
            if (pausaApos > 0 && Math.floor(totalEnviados / pausaApos) > Math.floor((c.total_enviados ?? 0) / pausaApos)) {
              nextDelaySeg = pausaDurMin * 60;
            }

            await supabaseAdmin.from("campaign").update({
              total_enviados: totalEnviados,
              total_falhas: (c.total_falhas ?? 0) + falhas,
              proximo_envio_em: new Date(Date.now() + nextDelaySeg * 1000).toISOString(),
            }).eq("id", c.id);

            processed.push({ id: c.id, enviados, falhas });
          }

          return Response.json({ ok: true, processed });
        } catch (e: any) {
          console.error("[process-campaigns]", e);
          return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500 });
        }
      },
    },
  },
});
