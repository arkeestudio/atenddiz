import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function deriveInstanceName(companyId: string) {
  return `atendezap_${companyId.replace(/-/g, "").slice(0, 16)}`;
}

// Nome da PROXIMA geracao da instancia. Um nome pode ficar inutilizavel na
// Evolution (zumbi: status "open" eterno, sem QR, imune a logout/delete — ver
// EvoDisconnectResult.orphaned). Como o nome era derivado só do companyId, a
// empresa ficava presa a ele pra sempre. O sufixo _r<n> dá uma instância nova e
// limpa, e por ser incremental se auto-cura caso a nova também envenene.
function nextInstanceName(companyId: string, current?: string | null) {
  const base = deriveInstanceName(companyId);
  const match = current ? /_r(\d+)$/.exec(current) : null;
  const gen = match ? Number(match[1]) + 1 : 2;
  return `${base}_r${gen}`;
}

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("company_user")
    .select("company_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Você ainda não possui uma empresa. Finalize o onboarding.");
  return data.company_id as string;
}

// A equipe respondeu pelo painel: o contato sai da fila "Aguardando humano".
async function clearAguardandoHumano(supabase: any, companyId: string, numero: string) {
  const { error } = await supabase
    .from("crm_cards")
    .update({ aguardando_humano: false, aguardando_desde: null })
    .eq("company_id", companyId)
    .eq("numero", numero)
    .eq("aguardando_humano", true);
  if (error) console.warn("[aguardando_humano] não foi possível limpar:", error.message);
}

export const connectWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // `force` = "trocar número": derruba a sessão atual antes de pedir o QR.
  .inputValidator((d?: { force?: boolean } | null) => ({ force: !!d?.force }))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: existing } = await (supabase as any)
      .from("whatsapp_instances")
      .select("instance_name,status,numero,webhook_token")
      .eq("company_id", companyId)
      .maybeSingle();
    const webhookToken = existing?.webhook_token || crypto.randomUUID();

    const conn = await provider.connect(companyId, existing?.instance_name, data.force);

    await supabase
      .from("whatsapp_instances")
      .upsert(
        {
          company_id: companyId,
          user_id: userId,
          instance_name: conn.instanceName,
          status: conn.state === "open" || conn.state === "CONNECTED" ? "connected" : "connecting",
          webhook_token: webhookToken,
          numero: null,
          webhook_configured_at: conn.webhookUrl ? new Date().toISOString() : null,
        } as any,
        { onConflict: "company_id" },
      );

    return { instanceName: conn.instanceName, qrBase64: conn.qrBase64, code: conn.code, state: conn.state, webhookUrl: conn.webhookUrl };
  });

/** Estado do interruptor geral da IA. */
export const getIaAtiva = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { data } = await (supabase as any)
      .from("agent_config")
      .select("ia_ativa, ia_pausada_motivo")
      .eq("company_id", companyId)
      .maybeSingle();
    // Sem a coluna (banco antigo) a IA segue ligada, que era o comportamento anterior.
    return { ativa: data?.ia_ativa !== false, motivo: (data?.ia_pausada_motivo as string) || null };
  });

/**
 * Liga/desliga a IA para a empresa inteira. Desligada, a mensagem continua entrando no
 * painel e o contato vai para a fila humana — desligar não pode virar perder cliente.
 */
export const setIaAtiva = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ativa: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { error } = await (supabase as any)
      .from("agent_config")
      .update({ ia_ativa: data.ativa, ia_pausada_motivo: data.ativa ? null : "Desligada manualmente" })
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true, ativa: data.ativa };
  });

export const checkWhatsappStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: row } = await (supabase as any)
      .from("whatsapp_instances")
      .select("instance_name,status,numero,webhook_token,webhook_configured_at,ultimo_numero,sincronizado_em")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!row) return { status: "disconnected", state: null, numero: null, qrBase64: null, code: null, numeroTrocou: false };

    let statusRes;
    try {
      statusRes = await provider.getStatus(companyId, row.instance_name);
    } catch (e) {
      console.warn("[whatsapp-provider.getStatus]", e);
      return {
        status: row.status || "disconnected",
        state: null,
        numero: row.numero ?? null,
        qrBase64: null,
        code: null,
        numeroTrocou: false,
      };
    }

    const newStatus = statusRes.status;
    let numero: string | null = statusRes.numero || row.numero || null;

    // Conectou um número DIFERENTE do que estava aqui antes. Foi exatamente assim que a IA
    // atendeu clientes num número particular ligado por engano: ela começa a responder no
    // instante em que a sessão sobe. Desliga sozinha e obriga alguém a conferir e religar.
    const numeroTrocou = !!(numero && row.ultimo_numero && numero !== row.ultimo_numero);
    if (numeroTrocou) {
      await (supabase as any)
        .from("agent_config")
        .update({
          ia_ativa: false,
          ia_pausada_motivo: `Número conectado mudou de ${row.ultimo_numero} para ${numero}. Confira antes de religar.`,
        })
        .eq("company_id", companyId);
      console.warn("[whatsapp] número trocou — IA desligada por segurança", companyId, row.ultimo_numero, "->", numero);
    }

    if (newStatus !== row.status || (numero && numero !== row.numero)) {
      // `as any`: os tipos gerados do Supabase ainda não têm ultimo_numero/sincronizado_em.
      await (supabase as any)
        .from("whatsapp_instances")
        .update({ status: newStatus, ...(numero ? { numero, ultimo_numero: numero } : {}) })
        .eq("company_id", companyId);
    }

    // Acabou de (re)conectar: recupera o que chegou enquanto estava fora. Uma vez a cada
    // 10 min no máximo, para o polling da tela não disparar sync a cada 3 segundos.
    if (newStatus === "connected" && row.status !== "connected") {
      const ultimaSync = row.sincronizado_em ? new Date(row.sincronizado_em).getTime() : 0;
      if (Date.now() - ultimaSync > 10 * 60_000) {
        void (async () => {
          try {
            const { openwaSyncChats } = await import("./whatsapp-provider/openwa.server");
            await openwaSyncChats(row.instance_name);
            await (supabase as any)
              .from("whatsapp_instances")
              .update({ sincronizado_em: new Date().toISOString() })
              .eq("company_id", companyId);
            console.log("[whatsapp] sync-chats disparado após reconexão", companyId);
          } catch (e: any) {
            console.warn("[whatsapp] sync-chats falhou", e?.message);
          }
        })();
      }
    }

    return { status: newStatus, state: statusRes.state, numero, qrBase64: statusRes.qrBase64 || null, code: statusRes.code || null, numeroTrocou };
  });

export const disconnectWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: row } = await supabase
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!row) return { ok: true };

    const res = await provider.disconnect(companyId, row.instance_name);

    await supabase
      .from("whatsapp_instances")
      .update({ status: "disconnected", numero: null, webhook_configured_at: null } as any)
      .eq("company_id", companyId);

    return { ok: true, deleted: res.deleted, orphaned: res.orphaned };
  });

export const sendWhatsappText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; texto: string; contatoNome?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: inst } = await supabase
      .from("whatsapp_instances").select("instance_name,status").eq("company_id", companyId).maybeSingle();
    if (!inst?.instance_name) throw new Error("WhatsApp não conectado");
    const { data: recentInbound } = await supabase
      .from("mensagens")
      .select("id")
      .eq("company_id", companyId)
      .eq("numero", data.numero)
      .eq("direcao", "entrada")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      .limit(1);
    if (!recentInbound?.length) {
      throw new Error("Por segurança, só é possível responder contatos que mandaram mensagem nas últimas 24h. Para iniciar conversa, use a API oficial com template aprovado.");
    }
    const { data: recentOutbound } = await supabase
      .from("mensagens")
      .select("id")
      .eq("company_id", companyId)
      .eq("numero", data.numero)
      .eq("direcao", "saida")
      .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .limit(6);
    if ((recentOutbound?.length ?? 0) >= 6) {
      throw new Error("Envio pausado por alguns minutos para proteger a qualidade do número.");
    }
    const { assertWithinLimit } = await import("./plan-limits.server");
    await assertWithinLimit(companyId, "mensagens");
    try { await provider.sendText(companyId, inst.instance_name, data.numero, data.texto); }
    catch (e: any) { throw new Error(`Falha ao enviar: ${e?.message ?? e}`); }
    // Devolve a linha inserida: a tela usa isso pra trocar a bolha otimista pela
    // definitiva, sem depender do INSERT do realtime chegar (que era o delay).
    const { data: inserted, error } = await supabase.from("mensagens").insert({
      company_id: companyId, user_id: userId, numero: data.numero,
      contato_nome: data.contatoNome ?? null,
      direcao: "saida", autor: "humano", texto: data.texto,
    }).select("*").single();
    if (error) throw new Error(error.message);
    // Envio manual não pausa a IA: só "Assumir", o switch IA ou o pedido do cliente pausam.
    await clearAguardandoHumano(supabase, companyId, data.numero);
    return { ok: true, mensagem: inserted ?? null };
  });

export const sendWhatsappMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; base64: string; caption?: string; filename?: string; isVoice?: boolean; contatoNome?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const provider = getWhatsAppProvider();

    const { data: inst } = await supabase
      .from("whatsapp_instances").select("instance_name,status").eq("company_id", companyId).maybeSingle();
    if (!inst?.instance_name) throw new Error("WhatsApp não conectado");

    let sent: any = null;
    try {
      if (data.isVoice && provider.sendVoice) {
        sent = await provider.sendVoice(companyId, inst.instance_name, data.numero, data.base64);
      } else if (provider.sendMedia) {
        sent = await provider.sendMedia(companyId, inst.instance_name, data.numero, data.base64, data.caption);
      } else {
        throw new Error("Envio de mídia não suportado no provedor atual");
      }
    } catch (e: any) {
      throw new Error(`Falha ao enviar mídia: ${e?.message ?? e}`);
    }

    // Nota de voz entra como "transcrevendo"; a tela chama transcribeAudioMessage logo em seguida.
    const { AUDIO_ENVIADO, audioPendingText } = await import("./audio-labels");
    const mediaText = data.isVoice
      ? audioPendingText(AUDIO_ENVIADO)
      : `📎 [Arquivo: ${data.filename || "Mídia"}] ${data.caption || ""}`.trim();

    const messageId = typeof sent?.messageId === "string" ? sent.messageId : null;
    const { data: inserted, error } = await supabase.from("mensagens").insert({
      company_id: companyId, user_id: userId, numero: data.numero,
      contato_nome: data.contatoNome ?? null,
      direcao: "saida", autor: "humano", texto: mediaText,
      whatsapp_message_id: messageId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    await clearAguardandoHumano(supabase, companyId, data.numero);
    return { ok: true, mensagem: inserted ?? null };
  });

export const sendInternalNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; texto: string; contatoNome?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    const { data: inserted, error } = await supabase.from("mensagens").insert({
      company_id: companyId,
      user_id: userId,
      numero: data.numero,
      contato_nome: data.contatoNome ?? null,
      direcao: "saida",
      autor: "humano",
      texto: `🔒 [NOTA INTERNA]: ${data.texto.trim()}`,
    }).select("*").single();

    if (error) throw new Error(error.message);
    return { ok: true, mensagem: inserted ?? null };
  });

export const setContactIaActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; ativa: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { error } = await supabase.from("contact_pause").upsert(
      { company_id: companyId, user_id: userId, numero: data.numero, pausado: !data.ativa },
      { onConflict: "company_id,numero" },
    );
    if (error) throw new Error(error.message);
    if (!data.ativa) return { ok: true };

    // Religou a IA: se o cliente está esperando resposta, a IA responde a mensagem pendente.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const { data: last } = await admin
        .from("mensagens")
        .select("direcao, autor, texto, contato_nome")
        .eq("company_id", companyId)
        .eq("numero", data.numero)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last || last.direcao !== "entrada" || last.autor !== "contato" || !last.texto?.trim()) {
        return { ok: true };
      }

      const { data: inst } = await admin
        .from("whatsapp_instances")
        .select("instance_name, user_id, status")
        .eq("company_id", companyId)
        .maybeSingle();
      if (!inst?.instance_name || inst.status !== "connected") return { ok: true };

      const { data: cfg } = await admin.from("agent_config").select("*").eq("company_id", companyId).maybeSingle();
      const horarios = cfg?.horarios_atendimento;
      if (horarios?.enabled) {
        const { isWithinBusinessHours } = await import("@/lib/business-hours");
        if (!isWithinBusinessHours(horarios)) return { ok: true };
      }

      const { runAiReply, loadCrmStages } = await import("./ai-reply.server");
      const stages = await loadCrmStages(admin, companyId);
      const result = await runAiReply({
        admin,
        companyId,
        userId: inst.user_id || userId,
        instanceName: inst.instance_name,
        number: data.numero,
        pushName: last.contato_nome ?? undefined,
        text: last.texto,
        stages,
        cfg,
      });
      return { ok: true, respostaPendente: result };
    } catch (e: any) {
      console.error("[ia-reativada resposta pendente]", e?.message);
      return { ok: true };
    }
  });

export const getWhatsappSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { data } = await (supabase as any)
      .from("whatsapp_instances")
      .select("aquecimento_ativo, aquecimento_limite_dia")
      .eq("company_id", companyId)
      .maybeSingle();
    return {
      aquecimento_ativo: data?.aquecimento_ativo ?? false,
      aquecimento_limite_dia: data?.aquecimento_limite_dia ?? 50,
    };
  });

export const setWhatsappWarmup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ativo: boolean; limite: number }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const limite = Math.max(1, Math.min(1000, Math.floor(Number(data.limite) || 50)));
    const { error } = await (supabase as any)
      .from("whatsapp_instances")
      .update({ aquecimento_ativo: !!data.ativo, aquecimento_limite_dia: limite })
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true, aquecimento_ativo: !!data.ativo, aquecimento_limite_dia: limite };
  });

export const testAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { message: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { lovableAiChat } = await import("./lovable-ai.server");
    const { buildSystemPrompt, parseAiOutput } = await import("./ai-prompt");
    const [{ data: cfg }, { data: stagesRows }, { data: prodRows }] = await Promise.all([
      supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      supabase.from("crm_stage").select("nome, tipo, ordem").eq("company_id", companyId).order("ordem", { ascending: true }),
      supabase.from("produto").select("*").eq("company_id", companyId).eq("ativo", true).order("ordem", { ascending: true }),
    ]);
    const stages = (stagesRows ?? []).map((s: any) => ({ nome: s.nome, tipo: s.tipo }));
    const produtos = (prodRows ?? []).map((p: any) => ({ nome: p.nome, preco: p.preco, descricao: p.descricao, imagem_url: p.imagem_url }));
    const system = buildSystemPrompt(cfg ?? {}, {
      responderEmPartes: cfg?.responder_em_partes ?? true,
      stages,
      produtos,
    });

    // Enforcement: provider precisa estar liberado no plano (Starter = Gemini)
    const { getCompanyPlan } = await import("./plan-limits.server");
    const { allowsProvider } = await import("./plan-features");
    const plan = await getCompanyPlan(companyId);
    let provider = ((cfg as any)?.ai_provider || "gemini") as string;
    let model = ((cfg as any)?.ai_model || "google/gemini-2.5-flash-lite") as string;
    if (!allowsProvider(plan.slug, provider)) {
      throw new Error(`O provedor ${provider.toUpperCase()} não está liberado nesta conta. Use o Gemini.`);
    }

    const raw = await lovableAiChat(
      [
        { role: "system", content: system },
        { role: "user", content: data.message },
      ],
      {
        provider,
        model,
        openaiKey: (cfg as any)?.openai_api_key || "",
        anthropicKey: (cfg as any)?.anthropic_api_key || "",
      },
    );
    const { parts, stage } = parseAiOutput(raw, stages);
    return { reply: parts.join("\n\n"), parts, stage, system };
  });

export const summarizeConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string }) => {
    if (!d?.numero) throw new Error("Número obrigatório");
    return { numero: d.numero };
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { lovableAiChat } = await import("./lovable-ai.server");

    const { data: rows } = await supabase
      .from("mensagens")
      .select("autor, direcao, texto, created_at")
      .eq("company_id", companyId)
      .eq("numero", data.numero)
      .order("created_at", { ascending: false })
      .limit(30);

    const msgs = (rows ?? []).reverse();
    if (msgs.length === 0) {
      return { summary: "Nenhuma mensagem encontrada para este contato ainda." };
    }

    const conversaTxt = msgs
      .map((m: any) => `[${m.direcao === "entrada" ? "CLIENTE" : m.autor?.toUpperCase()}]: ${m.texto}`)
      .join("\n");

    const system = `Você é um assistente de vendas e CRM sênior.
Sua missão é ler o histórico recente da conversa no WhatsApp e gerar uma ficha resumo EXECUTIVA e ESTRUTURADA para o atendente humano.
Responda em português (PT-BR) de forma objetiva no seguinte formato markdown:

### 👤 Perfil & Interesse do Cliente
(Descreva brevemente quem é o cliente e o que ele está buscando/qual o problema dele)

### 📋 Principais Pontos Acordados
(O que já foi discutido, valores mencionados, condições ou dúvidas levantadas)

### 🎯 Próxima Ação Recomendada
(O que o atendente deve fazer imediatamente para avançar na conversa ou fechar a venda)`;

    const user = `HISTÓRICO DA CONVERSA:\n${conversaTxt}\n\nGere o resumo executivo agora:`;

    const summary = await lovableAiChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      "google/gemini-2.5-flash-lite",
    );

    return { summary };
  });

export const transcribeAudioMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // `base64`: áudio já disponível na tela (nota recém-gravada), evita baixar do WhatsApp.
  .inputValidator((d: { messageId?: string; texto?: string; base64?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    if (!data.messageId) throw new Error("Mensagem de áudio não informada.");

    const { data: row } = await (supabase as any)
      .from("mensagens")
      .select("id, direcao, whatsapp_message_id")
      .eq("id", data.messageId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!row) throw new Error("Mensagem não encontrada.");
    if (!data.base64 && !row.whatsapp_message_id) {
      throw new Error("Este áudio não tem referência no WhatsApp para ser baixado.");
    }

    const { data: inst } = await supabase
      .from("whatsapp_instances").select("instance_name").eq("company_id", companyId).maybeSingle();
    if (!data.base64 && !inst?.instance_name) throw new Error("WhatsApp não conectado");

    const { transcribeAndUpdateMessage, AUDIO_RECEBIDO, AUDIO_ENVIADO, audioTranscribedText } = await import("./audio-transcription.server");
    const label = row.direcao === "saida" ? AUDIO_ENVIADO : AUDIO_RECEBIDO;
    const transcricao = await transcribeAndUpdateMessage({
      db: supabase,
      companyId,
      messageId: row.id,
      label,
      instanceName: inst?.instance_name,
      whatsappMedia: row.whatsapp_message_id,
      base64: data.base64,
    });
    if (!transcricao) throw new Error("A IA não conseguiu transcrever este áudio. Tente novamente em instantes.");

    return { transcricao, texto: audioTranscribedText(label, transcricao) };
  });


