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

export const generateSuggestedReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { numero: string; tone?: "vendas" | "curto" | "consultivo"; contactName?: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { lovableAiChat } = await import("./lovable-ai.server");

    const [{ data: cfg }, { data: histDesc }, { data: prodRows }] = await Promise.all([
      supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
      supabase
        .from("mensagens")
        .select("autor, direcao, texto, created_at")
        .eq("company_id", companyId)
        .eq("numero", data.numero)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("produto")
        .select("nome, preco, descricao")
        .eq("company_id", companyId)
        .eq("ativo", true)
        .limit(10),
    ]);

    const historico = (histDesc ?? []).slice().reverse();
    const histFormatted = historico
      .map((m: any) => `[${m.direcao === "entrada" ? "CLIENTE" : "ATENDENTE"}]: ${m.texto}`)
      .join("\n");

    const tone = data.tone || "vendas";
    let tomInstrucao = "";
    if (tone === "vendas") {
      tomInstrucao = "FOCO EM FECHAMENTO E VENDAS: conduza para o pagamento, proposta ou agendamento, destacando valor do produto/serviço.";
    } else if (tone === "curto") {
      tomInstrucao = "FOCO EM RAPIDEZ E OBJETIVIDADE: resposta curta (1 a 2 frases), direta e acolhedora, estilo WhatsApp.";
    } else {
      tomInstrucao = "FOCO CONSULTIVO E EMPÁTICO: esclareça as dúvidas com calma, ofereça suporte e transmita segurança e autoridade.";
    }

    const produtosTxt = (prodRows || [])
      .map((p: any) => `- ${p.nome}: R$ ${Number(p.preco || 0).toFixed(2)}${p.descricao ? ` (${p.descricao})` : ""}`)
      .join("\n");

    const systemPrompt = `Você é o Copiloto de Atendimento Inteligente da empresa "${cfg?.nome_empresa || "nossa loja"}".
O atendente humano está com a conversa aberta no WhatsApp e pediu sua sugestão de resposta para enviar ao cliente.
Nome do cliente: ${data.contactName || "Cliente"}.
Telefone: ${data.numero}.

Diretriz de Tom:
${tomInstrucao}

Catálogo de produtos da empresa:
${produtosTxt || "(Sem catálogo específico)"}

Instruções fundamentais:
- Responda em Português do Brasil de forma extremamente natural, humana e educada.
- Não use saudações repetitivas se a conversa já estiver em andamento.
- Vá direto ao ponto abordando a última fala ou dúvida do cliente.
- Retorne APENAS o texto da mensagem sugerida para o atendente enviar, sem aspas, sem prefixos, sem justificativas.`;

    const userPrompt = `Histórico recente da conversa:
---
${histFormatted || "(Nenhuma mensagem anterior)"}
---

Gere a melhor resposta sugerida agora:`;

    const reply = await lovableAiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        provider: (cfg as any)?.ai_provider || "gemini",
        model: (cfg as any)?.ai_model || "google/gemini-2.5-flash",
        openaiKey: (cfg as any)?.openai_api_key || "",
        anthropicKey: (cfg as any)?.anthropic_api_key || "",
      },
    );

    const cleanReply = reply.replace(/^["']|["']$/g, "").trim();
    return { suggestion: cleanReply };
  });

export const polishDraftMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { draftText: string; contactName?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { lovableAiChat } = await import("./lovable-ai.server");

    if (!data.draftText || !data.draftText.trim()) {
      return { polished: "" };
    }

    const { data: cfg } = await supabase
      .from("agent_config")
      .select("nome_empresa")
      .eq("company_id", companyId)
      .maybeSingle();

    const system = `Você é um especialista em comunicação comercial e atendimento de elite no WhatsApp.
Sua função é pegar o rascunho rápido digitado pelo atendente e transformá-lo em uma mensagem impecável:
- Corrija erros gramaticais e de pontuação.
- Deixe o tom mais simpático, profissional e acolhedor (estilo WhatsApp humanizado).
- Mantenha exatamente o sentido e as informações originais do atendente.
- Retorne APENAS o texto polido final, sem aspas e sem explicações.`;

    const polished = await lovableAiChat(
      [
        { role: "system", content: system },
        { role: "user", content: `Rascunho do atendente:\n"${data.draftText.trim()}"` },
      ],
      "google/gemini-2.5-flash-lite",
    );

    return { polished: polished.replace(/^["']|["']$/g, "").trim() };
  });

export const sendPixPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { numero: string; valor: number; descricao?: string; contatoNome?: string | null }) => d,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);
    const { getWhatsAppProvider } = await import("./whatsapp-provider");
    const { generatePixCopyPaste } = await import("./pix");

    const valor = Number(data.valor);
    if (isNaN(valor) || valor <= 0) {
      throw new Error("Informe um valor válido maior que zero.");
    }

    const [{ data: inst }, { data: cfg }] = await Promise.all([
      supabase.from("whatsapp_instances").select("instance_name, status").eq("company_id", companyId).limit(1).maybeSingle(),
      supabase.from("agent_config").select("*").eq("company_id", companyId).maybeSingle(),
    ]);

    if (!inst?.instance_name) {
      throw new Error("WhatsApp não está conectado.");
    }

    const chavePix = (cfg as any)?.chave_pix;
    if (!chavePix) {
      throw new Error("Chave PIX não configurada. Configure sua Chave PIX na aba Agente.");
    }

    const pixCode = generatePixCopyPaste({
      chave: chavePix,
      nome: (cfg as any)?.nome_titular_pix || (cfg as any)?.nome_empresa || "Atendimento",
      cidade: (cfg as any)?.cidade_pix || "BRASIL",
      valor,
      infoAdicional: data.descricao || "Pedido WhatsApp",
    });

    const valorFormatado = valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const msgText = `💰 *Pagamento via PIX: ${valorFormatado}*\n\n` +
      `${data.descricao ? `📦 *Referente a:* ${data.descricao}\n\n` : ""}` +
      `Toque no código abaixo para copiar:\n\n` +
      `\`\`\`${pixCode}\`\`\`\n\n` +
      `_Assim que realizar o pagamento, basta enviar o comprovante por aqui que confirmamos imediatamente!_ ⚡`;

    const provider = getWhatsAppProvider();
    const sent: any = await provider.sendText(companyId, inst.instance_name, data.numero, msgText);

    const { data: inserted } = await supabase.from("mensagens").insert({
      company_id: companyId,
      user_id: userId,
      numero: data.numero,
      contato_nome: data.contatoNome ?? null,
      direcao: "saida",
      autor: "humano",
      texto: msgText,
      whatsapp_message_id: sent?.messageId ?? null,
      status_entrega: "enviado",
    } as any).select("*").single();

    // Atualiza valor no CRM card
    await supabase
      .from("crm_cards")
      .update({
        valor,
        ultima_em: new Date().toISOString(),
        ultima_mensagem: `Cobrança PIX enviada: ${valorFormatado}`,
      } as any)
      .eq("company_id", companyId)
      .eq("numero", data.numero);

    return { ok: true, pixCode, mensagem: inserted };
  });

export const assignConversationOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { numero: string; ownerId: string | null }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const companyId = await resolveCompanyId(supabase, userId);

    const { error } = await supabase
      .from("crm_cards")
      .update({ owner_id: data.ownerId || null })
      .eq("company_id", companyId)
      .eq("numero", data.numero);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
