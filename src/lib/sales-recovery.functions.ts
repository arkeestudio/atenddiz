import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveCompanyId(supabase: any, userId: string): Promise<string> {
  const { data: member } = await supabase
    .from("company_user")
    .select("company_id")
    .eq("user_id", userId)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  if (!member?.company_id) throw new Error("Empresa não encontrada para o usuário");
  return member.company_id as string;
}

export const generateLeadFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { numero: string; cardId?: string; contactName?: string; stageName?: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { lovableAiChat } = await import("./lovable-ai.server");

    const [{ data: cfg }, { data: histDesc }] = await Promise.all([
      supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      supabase
        .from("mensagens")
        .select("autor, direcao, texto, created_at")
        .eq("company_id", companyId)
        .eq("numero", data.numero)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    const historico = (histDesc ?? []).slice().reverse();
    const histFormatted = historico
      .map((m: any) => `[${m.direcao === "entrada" ? "CLIENTE" : "EMPRESA"}]: ${m.texto}`)
      .join("\n");

    const systemPrompt = `Você é o assistente virtual de vendas consultivo da empresa "${cfg?.nome_empresa || "Empresa"}".
O cliente ${data.contactName ? `"${data.contactName}"` : ""} (${data.numero}) parou de responder durante a negociação ou fechamento.
Etapa atual no funil: ${data.stageName || "Negociando"}.

Seu objetivo é criar uma mensagem de follow-up (reativação de conversa / recuperação de venda) para enviar no WhatsApp.

Diretrizes cruciais:
- Seja extremamente natural, amigável e atencioso (estilo WhatsApp humano).
- NÃO seja insistente ou apelativo. Seja acolhedor e resolutivo.
- Mostre que você está aqui para tirar qualquer dúvida, ajudar na decisão ou facilitar o pagamento (caso estivesse aguardando PIX).
- Se houver cupom ou oferta da empresa (${cfg?.cupom || cfg?.ofertas || "não especificado"}), você pode mencionar como um benefício para fechar hoje.
- Mensagem CURTA (1 a 3 frases no máximo).
- Retorne APENAS o texto exato da mensagem para o cliente, sem aspas e sem explicações prévias.`;

    const userPrompt = `Aqui está o histórico recente de mensagens trocadas com o cliente:
---
${histFormatted || "(Nenhuma mensagem anterior registrada)"}
---

Gere a melhor mensagem de follow-up para reatar contato com este cliente agora.`;

    const reply = await lovableAiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        provider: ((cfg as any)?.ai_provider || "gemini") as string,
        model: ((cfg as any)?.ai_model || "google/gemini-2.5-flash") as string,
        openaiKey: (cfg as any)?.openai_api_key || "",
        anthropicKey: (cfg as any)?.anthropic_api_key || "",
      },
    );

    return { suggestion: reply.trim() };
  });

export const sendLeadFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; text: string; cardId?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name, status")
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();

    if (!inst?.instance_name) {
      throw new Error("Nenhuma instância WhatsApp conectada.");
    }

    const provider = getWhatsAppProvider();
    const sent: any = await provider.sendText(companyId, inst.instance_name, data.numero, data.text);

    // Registra na tabela de mensagens
    await supabase.from("mensagens").insert({
      company_id: companyId,
      user_id: userId,
      numero: data.numero,
      direcao: "saida",
      autor: "humano",
      texto: data.text,
      whatsapp_message_id: sent?.messageId ?? null,
      status_entrega: "enviado",
    } as any);

    // Registra evento no lead/card
    if (data.cardId) {
      try {
        await (supabase as any).from("lead_evento").insert({
          company_id: companyId,
          card_id: data.cardId,
          tipo: "followup_enviado",
          descricao: `Follow-up enviado: "${data.text.slice(0, 80)}${data.text.length > 80 ? "..." : ""}"`,
        });
      } catch {}

      await supabase
        .from("crm_cards")
        .update({
          ultima_em: new Date().toISOString(),
          ultima_mensagem: data.text,
        } as any)
        .eq("id", data.cardId);
    }

    return { ok: true };
  });

export const runBatchSalesRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { minInactivityHours?: number; maxLeads?: number }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const { lovableAiChat } = await import("./lovable-ai.server");

    const hours = Math.max(1, Number(data?.minInactivityHours || 2));
    const limit = Math.min(20, Math.max(1, Number(data?.maxLeads || 10)));
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const [{ data: inst }, { data: stages }, { data: cfg }] = await Promise.all([
      supabase.from("whatsapp_instances").select("instance_name, status").eq("company_id", companyId).limit(1).maybeSingle(),
      supabase.from("crm_stage").select("id, nome, tipo").eq("company_id", companyId),
      supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
    ]);

    if (!inst?.instance_name) {
      throw new Error("WhatsApp não está conectado para realizar disparos de recuperação.");
    }

    const nonFinalStageIds = (stages || [])
      .filter((s: any) => s.tipo !== "ganho" && s.tipo !== "perda")
      .map((s: any) => s.id);

    let query = supabase
      .from("crm_cards")
      .select("id, nome, numero, status, stage_id, ultima_em")
      .eq("company_id", companyId)
      .lte("ultima_em", cutoffTime)
      .order("ultima_em", { ascending: false })
      .limit(limit);

    if (nonFinalStageIds.length > 0) {
      query = query.in("stage_id", nonFinalStageIds);
    }

    const { data: candidates, error: queryErr } = await query;
    if (queryErr) throw queryErr;
    if (!candidates || candidates.length === 0) {
      return { totalFound: 0, sent: 0, skipped: 0, errors: [] };
    }

    const provider = getWhatsAppProvider();
    let sentCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const lead of candidates) {
      try {
        // Verifica se o contato pausou ou optou por sair
        const [{ data: pause }, { data: optout }] = await Promise.all([
          supabase.from("contact_pause").select("pausado").eq("company_id", companyId).eq("numero", lead.numero).maybeSingle(),
          (supabase as any).from("campaign_optout").select("numero").eq("company_id", companyId).eq("numero", lead.numero).maybeSingle(),
        ]);

        if (pause?.pausado || optout) {
          skippedCount++;
          continue;
        }

        // Busca histórico recente para contexto
        const { data: histDesc } = await supabase
          .from("mensagens")
          .select("autor, direcao, texto, created_at")
          .eq("company_id", companyId)
          .eq("numero", lead.numero)
          .order("created_at", { ascending: false })
          .limit(10);

        const historico = (histDesc ?? []).slice().reverse();
        // Se a última mensagem já foi enviada recentemente ou cliente não tem histórico
        const histFormatted = historico
          .map((m: any) => `[${m.direcao === "entrada" ? "CLIENTE" : "EMPRESA"}]: ${m.texto}`)
          .join("\n");

        const prompt = `Você é o assistente de vendas de "${cfg?.nome_empresa || "nossa loja"}".
O cliente ${lead.nome ? `"${lead.nome}"` : ""} (${lead.numero}) demonstrou interesse mas não concluiu a compra.
Etapa atual: ${lead.status || "Negociação"}.

Histórico da conversa:
${histFormatted || "(Sem mensagens anteriores)"}

Gere uma mensagem curta, calorosa e persuasiva (1 a 2 frases) de follow-up para reativar essa venda no WhatsApp hoje.
Pergunte se ficou com alguma dúvida sobre o produto ou se prefere que envie a chave PIX para finalizar.
Responda APENAS o texto exato da mensagem, sem aspas.`;

        const reply = await lovableAiChat(
          [{ role: "user", content: prompt }],
          {
            provider: (cfg as any)?.ai_provider || "gemini",
            model: (cfg as any)?.ai_model || "google/gemini-2.5-flash",
            openaiKey: (cfg as any)?.openai_api_key || "",
            anthropicKey: (cfg as any)?.anthropic_api_key || "",
          }
        );

        const cleanReply = reply.replace(/^["']|["']$/g, "").trim();
        if (!cleanReply) {
          skippedCount++;
          continue;
        }

        const sent: any = await provider.sendText(companyId, inst.instance_name, lead.numero, cleanReply);

        await supabase.from("mensagens").insert({
          company_id: companyId,
          user_id: userId,
          numero: lead.numero,
          direcao: "saida",
          autor: "ia",
          texto: cleanReply,
          whatsapp_message_id: sent?.messageId ?? null,
          status_entrega: "enviado",
        } as any);

        await supabase
          .from("crm_cards")
          .update({
            ultima_em: new Date().toISOString(),
            ultima_mensagem: cleanReply,
          } as any)
          .eq("id", lead.id);

        sentCount++;
        // Intervalo de segurança anti-ban
        await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 1000)));
      } catch (err: any) {
        errors.push(`${lead.numero}: ${err?.message || "Erro desconhecido"}`);
      }
    }

    return {
      totalFound: candidates.length,
      sent: sentCount,
      skipped: skippedCount,
      errors,
    };
  });

