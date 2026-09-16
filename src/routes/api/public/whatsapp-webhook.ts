import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload: any = await request.json().catch(() => ({}));
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");
          const { runAiReply, upsertCard, loadCrmStages } = await import("@/lib/ai-reply.server");
          const { transcribeAndUpdateMessage, audioPendingText, AUDIO_RECEBIDO, AUDIO_ENVIADO } = await import("@/lib/audio-transcription.server");

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

          // Nome de quem escreveu. Em mensagem enviada pelo celular isso é o nome do PRÓPRIO
          // número (ex: "ARKE Estúdio"), que não pode virar o nome do contato.
          const pushName: string | undefined = fromMe
            ? undefined
            : data?.pushName ||
              data?.sender?.pushname ||
              data?.sender?.name ||
              data?.sender?.formattedName ||
              data?.chat?.name ||
              data?.chat?.formattedTitle ||
              data?.contact?.name ||
              data?.contact?.formattedName;
          const msg = data?.message ?? {};
          // Sticker, figurinha e mídia sem `type`/`mimetype` chegam do OpenWA com o arquivo
          // inteiro no `body`. Detecta pela assinatura do base64 para não virar texto na conversa.
          const corpoBruto = typeof data?.body === "string" ? data.body.trim() : "";
          const bodyEhBase64 =
            /^(data:[^;,]{0,60};base64,|\/9j\/|iVBORw0KGgo|R0lGOD|UklGR|T2dnUw|SUQz|AAAA[A-Za-z0-9+/])/.test(corpoBruto) ||
            (corpoBruto.length > 512 && !/\s/.test(corpoBruto) && /^[A-Za-z0-9+/=]+$/.test(corpoBruto));
          const audioMsg = msg.audioMessage || (data?.type === "ptt" || data?.type === "audio" ? data : null);
          const imageMsg =
            msg.imageMessage ||
            (data?.type === "image" ||
            (data?.mimetype && String(data.mimetype).startsWith("image/")) ||
            (bodyEhBase64 && !audioMsg)
              ? data
              : null);
          // No OpenWA o `body` de mídia é o conteúdo/miniatura em base64, não texto: usa só a legenda.
          const isOpenwaMedia = !data?.message && (audioMsg || imageMsg);
          let text: string =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            msg.imageMessage?.caption ||
            msg.videoMessage?.caption ||
            (isOpenwaMedia || bodyEhBase64 ? data?.caption : data?.body) ||
            data?.text ||
            data?.content ||
            "";
          if (audioMsg) text = "";
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
          const stages = await loadCrmStages(supabaseAdmin, companyId);

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

            const { data: fromMeRow } = await (supabaseAdmin as any)
              .from("mensagens")
              .insert({
                company_id: companyId,
                user_id: userId,
                numero: number,
                contato_nome: pushName ?? null,
                direcao: "saida",
                autor: "humano",
                texto: text || (audioMsg ? audioPendingText(AUDIO_ENVIADO) : imageMsg ? "📎 [Imagem]" : ""),
                whatsapp_message_id: whatsappMessageId,
              })
              .select("id")
              .maybeSingle();

            await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text || (audioMsg ? AUDIO_ENVIADO : "📎 [Imagem]"), stages);

            // Nota de voz enviada pelo celular também é transcrita na hora.
            if (audioMsg && fromMeRow?.id) {
              await transcribeAndUpdateMessage({
                db: supabaseAdmin, companyId, messageId: fromMeRow.id, label: AUDIO_ENVIADO,
                instanceName, whatsappMedia: { key, message: msg, ...data },
              });
            }
            return new Response("fromMe-saved", { status: 200 });
          }

          // Checa duplicata antes de baixar/transcrever mídia (o sync-chats reenvia mensagens antigas).
          if (whatsappMessageId) {
            const { data: duplicate } = await (supabaseAdmin as any)
              .from("mensagens")
              .select("id")
              .eq("company_id", companyId)
              .eq("whatsapp_message_id", whatsappMessageId)
              .maybeSingle();
            if (duplicate) return new Response("duplicate", { status: 200 });
          }

          // Nota de voz: salva na hora como "transcrevendo" e transcreve logo após o insert.
          if (audioMsg) text = audioPendingText(AUDIO_RECEBIDO);

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

          // A transcrição atualiza a mensagem (a tela recebe pelo realtime) e vira o texto que a IA responde.
          // Sem transcrição o áudio fica salvo como "🎤 [Áudio]" para o atendente, sem resposta da IA.
          if (audioMsg) {
            const transcript = inserted?.id
              ? await transcribeAndUpdateMessage({
                  db: supabaseAdmin, companyId, messageId: inserted.id, label: AUDIO_RECEBIDO,
                  instanceName, whatsappMedia: { key, message: msg, ...data },
                })
              : "";
            if (!transcript) {
              await upsertCard(supabaseAdmin, companyId, userId, number, pushName, AUDIO_RECEBIDO, stages);
              return new Response("audio-sem-transcricao", { status: 200 });
            }
            text = transcript;
          }

          // Nome e foto de perfil do contato (renovados a cada poucos dias).
          try {
            const { sincronizarPerfilContato } = await import("@/lib/contato-perfil.server");
            await sincronizarPerfilContato({ admin: supabaseAdmin, companyId, instanceName, numero: number });
          } catch (e: any) { console.warn("[perfil-contato]", e?.message); }

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
            // Registra a transferência no sistema: fila "Aguardando humano" + ficha atualizada.
            const { registrarTransferenciaHumano } = await import("@/lib/ficha-atendimento.server");
            await registrarTransferenciaHumano({
              admin: supabaseAdmin, companyId, userId, numero: number,
              motivo: "Cliente pediu para falar com um atendente",
            });
            return new Response("human-handover", { status: 200 });
          }
          const { data: pauseRow } = await supabaseAdmin
            .from("contact_pause")
            .select("pausado, updated_at")
            .eq("company_id", companyId)
            .eq("numero", number)
            .maybeSingle();
          if (pauseRow?.pausado) {
            // Atendimento humano expira: sem atividade humana (pausa ou mensagem de atendente)
            // há HUMAN_IDLE_RESUME_MS, a IA reassume e responde esta mensagem.
            const { data: lastHuman } = await supabaseAdmin
              .from("mensagens")
              .select("created_at")
              .eq("company_id", companyId)
              .eq("numero", number)
              .eq("direcao", "saida")
              .eq("autor", "humano")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const lastHumanActivity = Math.max(
              pauseRow.updated_at ? new Date(pauseRow.updated_at).getTime() : 0,
              lastHuman?.created_at ? new Date(lastHuman.created_at).getTime() : 0,
            );
            if (Date.now() - lastHumanActivity < HUMAN_IDLE_RESUME_MS) {
              await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
              return new Response("paused-contact", { status: 200 });
            }
            await supabaseAdmin
              .from("contact_pause")
              .update({ pausado: false })
              .eq("company_id", companyId)
              .eq("numero", number);
            console.log("[whatsapp] IA reassumiu após inatividade humana", companyId, number);
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

          const result = await runAiReply({
            admin: supabaseAdmin, companyId, userId, instanceName, number, pushName, text, stages, cfg, isReceipt, receiptAnalysis,
          });
          return new Response(result, { status: 200 });
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

// Tempo sem atividade humana após o qual uma conversa pausada volta para a IA.
const HUMAN_IDLE_RESUME_MS = 30 * 60_000;

const OPT_OUT_WORDS =["parar", "pare", "cancelar", "sair", "remover", "descadastrar", "stop", "unsubscribe"];

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
