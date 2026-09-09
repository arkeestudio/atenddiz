import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload: any = await request.json().catch(() => ({}));
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");
          const { lovableAiChat } = await import("@/lib/lovable-ai.server");
          const { buildSystemPrompt, parseAiOutput } = await import("@/lib/ai-prompt");

          const event: string | undefined = payload?.event;
          const instanceName: string | undefined =
            payload?.instance ||
            payload?.instanceName ||
            payload?.data?.instance ||
            payload?.sessionId ||
            payload?.session ||
            payload?.data?.sessionId;

          if (!instanceName) return new Response("ok", { status: 200 });

          const data = payload?.data ?? payload;
          const evNorm = String(event || "").toLowerCase().replace(/_/g, ".");
          const suppliedToken = new URL(request.url).searchParams.get("t") || request.headers.get("x-webhook-token") || "";

          // Evento de conexão: mantém o status do número atualizado em tempo real.
          if (evNorm === "connection.update" || evNorm === "session.status_changed") {
            try {
              const { data: ci } = await (supabaseAdmin as any)
                .from("whatsapp_instances")
                .select("status, webhook_token")
                .eq("instance_name", instanceName)
                .maybeSingle();
              if (ci && (!suppliedToken || suppliedToken === ci.webhook_token)) {
                const st = String(data?.state || data?.connection || data?.status || "").toLowerCase();
                const newStatus =
                  st === "open" || st === "connected"
                    ? "connected"
                    : st === "connecting" || st === "pairing"
                    ? "connecting"
                    : st === "close" || st === "disconnected"
                    ? "disconnected"
                    : null;
                if (newStatus && newStatus !== ci.status) {
                  await (supabaseAdmin as any).from("whatsapp_instances").update({ status: newStatus }).eq("instance_name", instanceName);
                }
              }
            } catch (e: any) { console.error("[connection.update]", e?.message); }
            return new Response("connection", { status: 200 });
          }

          // Atualização de mensagem: status de entrega/leitura (✓✓).
          if (evNorm === "messages.update" || evNorm === "message.ack") {
            try { await handleMessageAck(supabaseAdmin, instanceName, suppliedToken, data); }
            catch (e: any) { console.error("[messages.update]", e?.message); }
            return new Response("ack", { status: 200 });
          }

          const isMessageEvent = evNorm === "messages.upsert" || evNorm === "message.created" || evNorm === "message";
          if (event && !isMessageEvent) {
            return new Response("ignored", { status: 200 });
          }

          const key = data?.key ?? {};
          const fromMe: boolean = !!(key.fromMe ?? data?.fromMe);
          const whatsappMessageId: string | null =
            typeof key.id === "string" && key.id.trim()
              ? key.id.trim()
              : typeof data?.id === "string" && data.id.trim()
              ? data.id.trim()
              : null;

          const number = extractPhoneNumber(data, key);
          if (!number) return new Response("no valid number", { status: 200 });

          const pushName: string | undefined =
            data?.pushName ||
            data?.sender?.pushname ||
            data?.sender?.name ||
            data?.sender?.formattedName ||
            data?.chat?.name ||
            data?.chat?.formattedTitle ||
            data?.contact?.name ||
            data?.contact?.formattedName;
          const msg = data?.message ?? {};
          let text: string =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            msg.imageMessage?.caption ||
            msg.videoMessage?.caption ||
            data?.body ||
            data?.text ||
            data?.content ||
            "";
          const audioMsg = msg.audioMessage || (data?.type === "ptt" || data?.type === "audio" ? data : null);
          const imageMsg = msg.imageMessage || (data?.type === "image" || (data?.mimetype && String(data.mimetype).startsWith("image/")) ? data : null);
          if ((!text || !text.trim()) && !audioMsg && !imageMsg) return new Response("no text", { status: 200 });

          const { data: inst } = await (supabaseAdmin as any)
            .from("whatsapp_instances")
            .select("company_id, user_id, instance_name, webhook_token")
            .eq("instance_name", instanceName)
            .maybeSingle();
          if (!inst) return new Response("unknown instance", { status: 200 });
          if (suppliedToken && suppliedToken !== (inst as any).webhook_token) {
            return new Response("invalid webhook", { status: 401 });
          }
          const companyId = (inst as any).company_id as string;
          const userId = (inst as any).user_id as string;

          // Carrega etapas da company para atualizar o card
          const { data: stagesRows } = await supabaseAdmin
            .from("crm_stage")
            .select("id, nome, tipo, ordem")
            .eq("company_id", companyId)
            .order("ordem", { ascending: true });
          const stages = (stagesRows ?? []) as Array<{ id: string; nome: string; tipo: "normal" | "ganho" | "perda" }>;

          // Mensagem enviada pelo próprio usuário via celular: salva no banco e atualiza card
          if (fromMe) {
            if (whatsappMessageId) {
              const { data: duplicate } = await (supabaseAdmin as any)
                .from("mensagens")
                .select("id")
                .eq("company_id", companyId)
                .eq("whatsapp_message_id", whatsappMessageId)
                .maybeSingle();
              if (duplicate) return new Response("duplicate", { status: 200 });
            }

            await (supabaseAdmin as any).from("mensagens").insert({
              company_id: companyId,
              user_id: userId,
              numero: number,
              contato_nome: pushName ?? null,
              direcao: "saida",
              autor: "humano",
              texto: text,
              whatsapp_message_id: whatsappMessageId,
            });

            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            return new Response("fromMe-saved", { status: 200 });
          }

          // Nota de voz -> transcreve com Gemini para a IA entender e responder.
          if ((!text || !text.trim()) && audioMsg) {
            try {
              const provider = getWhatsAppProvider();
              if (provider.getMediaBase64) {
                const media = await provider.getMediaBase64(companyId, instanceName, { key, message: msg, ...data });
                if (media?.base64) {
                  const { geminiTranscribeAudio } = await import("@/lib/lovable-ai.server");
                  const transcript = await geminiTranscribeAudio(media.base64, media.mimetype);
                  if (transcript) text = transcript;
                }
              }
            } catch (e: any) { console.error("[audio transcribe]", e?.message); }
            if (!text || !text.trim()) return new Response("no audio text", { status: 200 });
          }

          let isReceipt = false;
          let receiptAnalysis: any = null;

          // Imagem recebida -> audita com Gemini Vision se for comprovante bancário
          if (imageMsg) {
            try {
              const provider = getWhatsAppProvider();
              if (provider.getMediaBase64) {
                const media = await provider.getMediaBase64(companyId, instanceName, { key, message: msg, ...data });
                if (media?.base64) {
                  const { geminiAnalyzeReceipt } = await import("@/lib/lovable-ai.server");
                  receiptAnalysis = await geminiAnalyzeReceipt(media.base64, media.mimetype);
                  if (receiptAnalysis?.e_comprovante) {
                    isReceipt = true;
                    const valFmt = receiptAnalysis.valor ? `R$ ${Number(receiptAnalysis.valor).toFixed(2)}` : "";
                    text = `[Comprovante de Pagamento Recebido: ${valFmt} - ${receiptAnalysis.resumo || "Validado via IA"}]`;
                  } else if (!text || !text.trim()) {
                    text = "[Imagem enviada pelo cliente]";
                  }
                }
              }
            } catch (e: any) {
              console.error("[image/receipt audit]", e?.message);
              if (!text || !text.trim()) text = "[Imagem enviada pelo cliente]";
            }
            if (!text || !text.trim()) return new Response("no image text", { status: 200 });
          }

          if (whatsappMessageId) {
            const { data: duplicate } = await (supabaseAdmin as any)
              .from("mensagens")
              .select("id")
              .eq("company_id", companyId)
              .eq("whatsapp_message_id", whatsappMessageId)
              .maybeSingle();
            if (duplicate) return new Response("duplicate", { status: 200 });
          }

          const insertedAt = new Date().toISOString();
          const { data: inserted } = await (supabaseAdmin as any)
            .from("mensagens")
            .insert({
              company_id: companyId,
              user_id: userId,
              numero: number,
              contato_nome: pushName ?? null,
              direcao: "entrada",
              autor: "contato",
              texto: text,
              whatsapp_message_id: whatsappMessageId,
              created_at: insertedAt,
            })
            .select("id, created_at")
            .maybeSingle();
          const myCreatedAt = inserted?.created_at || insertedAt;

          // Dispara webhooks externos (best-effort, não bloqueia)
          try {
            const { emitWebhook } = await import("@/lib/webhooks.server");
            void emitWebhook(companyId, "message.received", {
              numero: number, contato_nome: pushName ?? null, texto: text, message_id: inserted?.id,
            });
          } catch {}

          // Captura UTM da primeira mensagem do contato (padrão [utm:source/medium/campaign])
          try {
            const utmMatch = text.match(/\[utm:([^/\]]*)\/([^/\]]*)\/([^\]]*)\]/i);
            if (utmMatch) {
              const [, s, m, c] = utmMatch;
              await (supabaseAdmin as any).from("crm_cards").update({
                utm_source: s || null, utm_medium: m || null, utm_campaign: c || null,
              }).eq("company_id", companyId).eq("numero", number).is("utm_source", null);
            }
          } catch {}


          const { data: cfg } = await supabaseAdmin
            .from("agent_config")
            .select("*")
            .eq("company_id", companyId)
            .maybeSingle();

          const palavraPausar = (cfg?.palavra_pausar || "/pausar").toLowerCase().trim();
          const palavraDespausar = (cfg?.palavra_despausar || "/despausar").toLowerCase().trim();
          const lower = text.toLowerCase().trim();

          const { data: produtosRows } = await supabaseAdmin
            .from("produto")
            .select("nome, preco, descricao, imagem_url, ativo, ordem")
            .eq("company_id", companyId)
            .eq("ativo", true)
            .order("ordem", { ascending: true });
          const produtos = (produtosRows ?? []).map((p: any) => ({
            nome: p.nome,
            preco: p.preco,
            descricao: p.descricao,
            imagem_url: (p as any).imagem_url ?? null,
          }));

          const provider = getWhatsAppProvider();

          if (isOptOutMessage(lower)) {
            await supabaseAdmin
              .from("contact_pause")
              .upsert({ company_id: companyId, user_id: userId, numero: number, pausado: true }, { onConflict: "company_id,numero" });
            // Opt-out de campanhas: nunca mais envia disparo em massa pra esse número.
            await (supabaseAdmin as any)
              .from("campaign_optout")
              .upsert({ company_id: companyId, numero: number }, { onConflict: "company_id,numero" });
            try {
              const confirmacao = "Pronto! Você não vai mais receber mensagens de campanhas. Se mudar de ideia, é só nos chamar. 👍";
              await provider.sendText(companyId, instanceName, number, confirmacao);
              await supabaseAdmin.from("mensagens").insert({
                company_id: companyId, user_id: userId, numero: number,
                contato_nome: pushName ?? null, direcao: "saida", autor: "sistema", texto: confirmacao,
              });
            } catch (e: any) { console.error("[opt-out confirm]", e?.message); }
            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            return new Response("opt-out", { status: 200 });
          }

          if (lower === palavraPausar) {
            await supabaseAdmin
              .from("contact_pause")
              .upsert({ company_id: companyId, user_id: userId, numero: number, pausado: true }, { onConflict: "company_id,numero" });
            return new Response("paused", { status: 200 });
          }
          if (lower === palavraDespausar) {
            await supabaseAdmin
              .from("contact_pause")
              .upsert({ company_id: companyId, user_id: userId, numero: number, pausado: false }, { onConflict: "company_id,numero" });
            return new Response("resumed", { status: 200 });
          }

          // Transbordo humano automático: se o cliente solicitar atendimento humano
          const HUMAN_HANDOVER_KEYWORDS = [
            "humano", "atendente", "falar com alguem", "falar com pessoa",
            "falar com humano", "falar com atendente", "ajuda humana", "atendimento humano",
            "atendente humano", "atendente real", "pessoa real", "suporte humano",
          ];
          if (HUMAN_HANDOVER_KEYWORDS.some((kw) => lower.includes(kw))) {
            await supabaseAdmin
              .from("contact_pause")
              .upsert({ company_id: companyId, user_id: userId, numero: number, pausado: true }, { onConflict: "company_id,numero" });

            try {
              const respostaTransbordo = "Entendido! Estou transferindo seu atendimento para nossa equipe humana. Um atendente falará com você em breve. 👤";
              await provider.sendText(companyId, instanceName, number, respostaTransbordo);
              await supabaseAdmin.from("mensagens").insert({
                company_id: companyId, user_id: userId, numero: number,
                contato_nome: pushName ?? null, direcao: "saida", autor: "sistema", texto: respostaTransbordo,
              });
            } catch (e: any) { console.error("[transbordo send]", e?.message); }

            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            return new Response("human-handover", { status: 200 });
          }
          const { data: pauseRow } = await supabaseAdmin
            .from("contact_pause")
            .select("pausado")
            .eq("company_id", companyId)
            .eq("numero", number)
            .maybeSingle();
          if (pauseRow?.pausado) {
            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            return new Response("paused-contact", { status: 200 });
          }

          // Horário de atendimento: se ativo e fora do horário, manda mensagem padrão e não chama IA.
          try {
            const { isWithinBusinessHours } = await import("@/lib/business-hours");
            const horarios = (cfg as any)?.horarios_atendimento;
            if (horarios?.enabled && !isWithinBusinessHours(horarios)) {
              const msgFora =
                ((cfg as any)?.mensagem_fora_horario as string) ||
                "No momento estamos fora do horário de atendimento. Retornamos em breve.";
              // evita responder a mesma coisa em rajada: só responde se a última saída IA não foi a msg fora
              const { data: ultimaSaida } = await supabaseAdmin
                .from("mensagens")
                .select("texto, created_at")
                .eq("company_id", companyId)
                .eq("numero", number)
                .eq("direcao", "saida")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              const ultimaFoiFora =
                ultimaSaida &&
                ultimaSaida.texto === msgFora &&
                Date.now() - new Date(ultimaSaida.created_at).getTime() < 6 * 60 * 60_000;
              if (!ultimaFoiFora) {
                try {
                  await provider.sendText(companyId, instanceName, number, msgFora);
                  await supabaseAdmin.from("mensagens").insert({
                    company_id: companyId,
                    user_id: userId,
                    numero: number,
                    contato_nome: pushName ?? null,
                    direcao: "saida",
                    autor: "ia",
                    texto: msgFora,
                  });
                } catch (e: any) {
                  console.error("[off-hours send]", e?.message);
                }
              }
              await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
              return new Response("off-hours", { status: 200 });
            }
          } catch (e: any) {
            console.error("[business-hours]", e?.message);
          }

          const bufferSec = Math.max(0, Math.min(20, Number(cfg?.segundos_buffer ?? 8)));
          if (bufferSec > 0) {
            await new Promise((r) => setTimeout(r, bufferSec * 1000));
          }

          const { data: newer } = await supabaseAdmin
            .from("mensagens")
            .select("id, created_at")
            .eq("company_id", companyId)
            .eq("numero", number)
            .eq("direcao", "entrada")
            .gt("created_at", myCreatedAt)
            .limit(1);
          if (newer && newer.length > 0) {
            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            return new Response("superseded", { status: 200 });
          }

          const { data: humanRecent } = await supabaseAdmin
            .from("mensagens")
            .select("id, created_at, autor")
            .eq("company_id", companyId)
            .eq("numero", number)
            .eq("direcao", "saida")
            .eq("autor", "humano")
            .gte("created_at", new Date(Date.now() - 90_000).toISOString())
            .limit(1);
          if (humanRecent && humanRecent.length > 0) {
            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            return new Response("human-active", { status: 200 });
          }

          const { data: histDesc } = await supabaseAdmin
            .from("mensagens")
            .select("autor,direcao,texto,created_at")
            .eq("company_id", companyId)
            .eq("numero", number)
            .order("created_at", { ascending: false })
            .limit(25);
          const historico = (histDesc ?? []).slice().reverse();

          const { data: cardRow } = await supabaseAdmin
            .from("crm_cards")
            .select("status, nome, stage_id")
            .eq("company_id", companyId)
            .eq("numero", number)
            .maybeSingle();
          const estagioAtual = cardRow?.status || stages[0]?.nome || "Conversas";
          const resumoContato = `${cardRow?.nome || pushName || "Contato"} (${number}), ${historico.length} mensagens trocadas`;

          const { data: googleIntegration } = await supabaseAdmin
            .from("google_integration")
            .select("conectado")
            .eq("company_id", companyId)
            .maybeSingle();

          const responderEmPartes = cfg?.responder_em_partes ?? true;
          const system = buildSystemPrompt(cfg ?? {}, {
            responderEmPartes,
            estagioAtual,
            resumoContato,
            produtos,
            stages: stages.map((s) => ({ nome: s.nome, tipo: s.tipo })),
            googleConectado: !!googleIntegration?.conectado,
          });

          const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
            { role: "system", content: system },
            ...historico.map((m) => ({
              role: (m.direcao === "entrada" ? "user" : "assistant") as "user" | "assistant",
              content: m.texto,
            })),
          ];
          if (!messages.length || messages[messages.length - 1].role !== "user") {
            messages.push({ role: "user", content: text });
          }

          // Enforcement de créditos: cada resposta da IA consome 1 crédito.
          // Se zerou, a IA não responde — exige assinatura/recarga.
          const { getCompanyPlan } = await import("@/lib/plan-limits.server");
          const { allowsProvider } = await import("@/lib/plan-features");
          const { data: hasCredit } = await supabaseAdmin.rpc("consume_ai_credit", {
            _company_id: companyId,
            _ref: number,
          });
          if (!hasCredit) {
            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            console.warn("[credits] créditos esgotados — IA não respondeu", companyId);
            return new Response("no_credits", { status: 200 });
          }
          const throttleReason = await getAiThrottleReason(supabaseAdmin, companyId, number);
          if (throttleReason) {
            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
            console.warn("[whatsapp.safety] resposta pausada", throttleReason, companyId, number);
            return new Response(throttleReason, { status: 200 });
          }
          const plan = await getCompanyPlan(companyId);
          let providerChoice = ((cfg as any)?.ai_provider || "gemini") as string;
          let modelChoice = ((cfg as any)?.ai_model || "google/gemini-2.5-flash") as string;
          if (!allowsProvider(plan.slug, providerChoice)) {
            providerChoice = "gemini";
            modelChoice = "google/gemini-2.5-flash";
          }

          let rawReply = "";
          try {
            rawReply = await lovableAiChat(messages, {
              provider: providerChoice,
              model: modelChoice,
              openaiKey: (cfg as any)?.openai_api_key || "",
              anthropicKey: (cfg as any)?.anthropic_api_key || "",
            });
          } catch (e: any) {
            console.error("[ai]", e?.message);
          }

          const { parts, stage, agendar, fotoUrl, pixValor } = parseAiOutput(rawReply, stages.map((s) => ({ nome: s.nome, tipo: s.tipo })));
          const finalParts = sanitizeAiParts(responderEmPartes ? parts : [parts.join(" ")]);

          // Gera PIX Copia e Cola instantâneo se a IA definiu valor de pagamento
          const chavePix = (cfg as any)?.chave_pix;
          if (pixValor && chavePix) {
            try {
              const { generatePixCopyPaste } = await import("@/lib/pix");
              const pixCode = generatePixCopyPaste({
                chave: chavePix,
                nome: (cfg as any)?.nome_titular_pix || "Atendimento",
                cidade: (cfg as any)?.cidade_pix || "BRASIL",
                valor: pixValor,
                infoAdicional: "Pedido WhatsApp",
              });
              finalParts.push(
                `📋 *PIX Copia e Cola* (Toque no código abaixo para copiar):\n\n\`\`\`${pixCode}\`\`\`\n\n_Após realizar o pagamento, basta enviar o comprovante aqui para confirmação imediata!_ ⚡`
              );
            } catch (e: any) {
              console.error("[generatePixCopyPaste]", e?.message);
            }
          }

          // Envia foto do produto se a IA marcou [ENVIAR_FOTO: url]
          if (fotoUrl && provider.sendMedia) {
            try {
              await provider.sendMedia(companyId, instanceName, number, fotoUrl, "Foto do produto");
              await supabaseAdmin.from("mensagens").insert({
                company_id: companyId,
                user_id: userId,
                numero: number,
                contato_nome: pushName ?? null,
                direcao: "saida",
                autor: "ia",
                texto: `📸 [Foto do Produto: ${fotoUrl}]`,
                status_entrega: "enviado",
              } as any);
              await new Promise((r) => setTimeout(r, 1200));
            } catch (e: any) {
              console.error("[sendMedia foto]", e?.message);
            }
          }

          // Cria evento no Google Agenda se a IA marcou [AGENDAR: ...]
          if (agendar && googleIntegration?.conectado) {
            try {
              const { createCalendarEventForCompany } = await import("@/lib/google.server");
              await createCalendarEventForCompany(supabaseAdmin, companyId, {
                titulo: agendar.titulo,
                inicio: agendar.inicio,
                fim: agendar.fim,
                descricao: `Agendado via WhatsApp — ${pushName || number}`,
              });
            } catch (e: any) {
              console.error("[agendar]", e?.message);
            }
          }

          for (let i = 0; i < finalParts.length; i++) {
            const part = finalParts[i];
            if (!part) continue;
            try {
              const typingMs = Math.min(3000, 1200 + Math.floor(part.length * 35));
              if (provider.sendPresence) {
                await provider.sendPresence(companyId, instanceName, number, "composing", typingMs);
              }
              await new Promise((r) => setTimeout(r, typingMs));
              const sent: any = await provider.sendText(companyId, instanceName, number, part);
              await supabaseAdmin.from("mensagens").insert({
                company_id: companyId,
                user_id: userId,
                numero: number,
                contato_nome: pushName ?? null,
                direcao: "saida",
                autor: "ia",
                texto: part,
                whatsapp_message_id: sent?.messageId ?? null,
                status_entrega: "enviado",
              } as any);
              if (i < finalParts.length - 1) {
                await new Promise((r) => setTimeout(r, 700 + Math.floor(Math.random() * 800)));
              }
            } catch (e: any) {
              console.error("[send]", e?.message);
            }
          }

          const stageGanho = stages.find((s) => s.tipo === "ganho")?.nome;
          await upsertCard(
            supabaseAdmin,
            companyId,
            userId,
            number,
            pushName,
            finalParts[finalParts.length - 1] || text,
            stages,
            isReceipt && stageGanho ? stageGanho : stage,
            {
              valor: receiptAnalysis?.valor ? Number(receiptAnalysis.valor) : (pixValor || undefined),
              isReceipt: !!isReceipt,
              observacao: receiptAnalysis?.resumo ? `Comprovante validado por IA: ${receiptAnalysis.resumo}` : undefined,
            },
          );

          return new Response("ok", { status: 200 });
        } catch (e: any) {
          console.error("[webhook]", e?.message, e?.stack);
          return new Response("error", { status: 200 });
        }
      },
      GET: async () => new Response("Atendizz webhook online", { status: 200 }),
    },
  },
});

function extractPhoneNumber(data: any, key: any): string | null {
  const isGroup =
    data?.from?.endsWith("@g.us") ||
    data?.chatId?.endsWith("@g.us") ||
    key?.remoteJid?.endsWith("@g.us");
  if (isGroup) return null;

  const isFromMe = !!(key?.fromMe ?? data?.fromMe);

  const candidates: Array<string | undefined | null> = [
    typeof data?.chatId === "string" ? data.chatId : null,
    typeof data?.chat?.id === "string" ? data.chat.id : data?.chat?.id?._serialized,
    typeof data?.sender?.id === "string" ? data.sender.id : data?.sender?.id?._serialized,
    typeof data?.contact?.id === "string" ? data.contact.id : data?.contact?.id?._serialized,
    typeof data?.author === "string" ? data.author : null,
    typeof data?.from === "string" ? data.from : null,
    typeof data?.to === "string" ? data.to : null,
    typeof key?.remoteJid === "string" ? key.remoteJid : null,
  ];

  if (isFromMe) {
    const toCandidates = [
      typeof data?.to === "string" ? data.to : null,
      typeof data?.chatId === "string" ? data.chatId : null,
      typeof key?.remoteJid === "string" ? key.remoteJid : null,
    ];
    for (const c of toCandidates) {
      if (c && (c.endsWith("@c.us") || c.endsWith("@s.whatsapp.net"))) {
        const num = c.split("@")[0].replace(/\D/g, "");
        if (num && num.length >= 8 && num.length <= 15) return num;
      }
    }
  }

  for (const c of candidates) {
    if (c && (c.endsWith("@c.us") || c.endsWith("@s.whatsapp.net"))) {
      const num = c.split("@")[0].replace(/\D/g, "");
      if (num && num.length >= 8 && num.length <= 15) return num;
    }
  }

  for (const c of candidates) {
    if (c && !c.endsWith("@lid") && !c.endsWith("@g.us") && !c.endsWith("@newsletter") && !c.endsWith("@broadcast")) {
      const num = c.split("@")[0].replace(/\D/g, "");
      if (num && num.length >= 8 && num.length <= 15) return num;
    }
  }

  for (const c of candidates) {
    if (c && c.includes("@")) {
      const num = c.split("@")[0].replace(/\D/g, "");
      if (num && num.length >= 8 && num.length <= 15) return num;
    }
  }

  return null;
}

const OPT_OUT_WORDS = ["parar", "pare", "cancelar", "sair", "remover", "descadastrar", "stop", "unsubscribe"];

function isOptOutMessage(text: string) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return OPT_OUT_WORDS.some((word) => normalized === word || normalized.includes(` ${word} `));
}

function mapAckStatus(s: any): string | null {
  if (s == null) return null;
  const v = String(s).toUpperCase();
  if (v === "READ" || v === "PLAYED" || v === "4" || v === "5") return "lido";
  if (v === "DELIVERY_ACK" || v === "DELIVERED" || v === "3") return "entregue";
  if (v === "SERVER_ACK" || v === "SENT" || v === "2") return "enviado";
  if (v === "ERROR" || v === "0") return "falhou";
  return null;
}

async function handleMessageAck(admin: any, instanceName: string, suppliedToken: string, data: any) {
  const { data: inst } = await admin
    .from("whatsapp_instances")
    .select("company_id, webhook_token")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!inst || !suppliedToken || suppliedToken !== inst.webhook_token) return;
  const rank: Record<string, number> = { falhou: 0, enviado: 1, entregue: 2, lido: 3 };
  const items = Array.isArray(data) ? data : [data];
  for (const it of items) {
    const wid = it?.key?.id || it?.keyId || it?.messageId || it?.id;
    const raw = it?.update?.status ?? it?.status ?? it?.update?.receipt?.type;
    const mapped = mapAckStatus(raw);
    if (!wid || !mapped) continue;
    const { data: row } = await admin
      .from("mensagens")
      .select("id, status_entrega")
      .eq("company_id", inst.company_id)
      .eq("whatsapp_message_id", wid)
      .maybeSingle();
    if (!row) continue;
    if ((rank[mapped] ?? 0) < (rank[row.status_entrega as string] ?? -1)) continue;
    await admin.from("mensagens").update({ status_entrega: mapped }).eq("id", row.id);
  }
}

function sanitizeAiParts(parts: string[]) {
  return parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((part) => (part.length > 700 ? `${part.slice(0, 697).trim()}...` : part))
    .slice(0, 2);
}

async function getAiThrottleReason(admin: any, companyId: string, numero: string): Promise<string | null> {
  const now = Date.now();
  const [contactRecent, companyRecent] = await Promise.all([
    admin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("numero", numero)
      .eq("direcao", "saida")
      .eq("autor", "ia")
      .gte("created_at", new Date(now - 10 * 60_000).toISOString()),
    admin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("direcao", "saida")
      .eq("autor", "ia")
      .gte("created_at", new Date(now - 60_000).toISOString()),
  ]);

  if ((contactRecent.count ?? 0) >= 6) return "contact-rate-limit";
  if ((companyRecent.count ?? 0) >= 20) return "company-rate-limit";
  return null;
}

async function upsertCard(
  admin: any,
  companyId: string,
  userId: string,
  numero: string,
  nome: string | undefined,
  ultimaMensagem: string,
  stages: Array<{ id: string; nome: string; tipo: "normal" | "ganho" | "perda" }>,
  proposedStageName?: string | null,
  extra?: { valor?: number; isReceipt?: boolean; observacao?: string },
) {
  const { data: existing } = await admin
    .from("crm_cards")
    .select("id, status, nome, stage_id, valor, observacao")
    .eq("company_id", companyId)
    .eq("numero", numero)
    .maybeSingle();

  const stageByName = new Map(stages.map((s) => [s.nome.toLowerCase(), s]));
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const currentStage = existing?.stage_id ? stageById.get(existing.stage_id) : undefined;
  const currentTipo = currentStage?.tipo ?? (existing?.status ? stageByName.get(String(existing.status).toLowerCase())?.tipo : undefined);
  const isLocked = !extra?.isReceipt && (currentTipo === "ganho" || currentTipo === "perda");

  const proposed = proposedStageName ? stageByName.get(proposedStageName.toLowerCase()) : undefined;

  let finalStage = currentStage;
  if (proposed && !isLocked) finalStage = proposed;
  if (!finalStage) finalStage = stages[0];

  let cardName = existing?.nome || null;
  if (nome && nome.trim() && (!cardName || cardName === numero || /^\d+$/.test(cardName.replace(/\D/g, "")))) {
    cardName = nome.trim();
  }

  const payload: any = {
    company_id: companyId,
    user_id: userId,
    numero,
    nome: cardName,
    ultima_mensagem: ultimaMensagem.slice(0, 240),
    ultima_em: new Date().toISOString(),
  };
  if (finalStage) {
    payload.stage_id = finalStage.id;
    payload.status = finalStage.nome;
  } else if (existing?.status) {
    payload.status = existing.status;
  } else {
    payload.status = "Conversas";
  }

  if (extra?.valor !== undefined && extra.valor > 0) {
    payload.valor = extra.valor;
  }
  if (extra?.observacao) {
    payload.observacao = extra.observacao;
  }

  const { data: savedCard } = await admin
    .from("crm_cards")
    .upsert(payload, { onConflict: "company_id,numero" })
    .select("id")
    .maybeSingle();

  const cardId = savedCard?.id || existing?.id;
  if (extra?.isReceipt && cardId && extra?.observacao) {
    try {
      await admin.from("lead_nota").insert({
        company_id: companyId,
        card_id: cardId,
        autor_id: null,
        texto: `🧾 [IA Vision] ${extra.observacao}${extra.valor ? ` — R$ ${Number(extra.valor).toFixed(2)}` : ""}`,
      });
    } catch (e: any) {
      console.error("[lead_nota receipt]", e?.message);
    }
  }
}
