import { lovableAiChat } from "./lovable-ai.server";
import { getWhatsAppProvider } from "./whatsapp-provider";

export interface ForwardLeadSummaryParams {
  supabase: any;
  companyId: string;
  userId?: string;
  leadNumber: string;
  leadName?: string | null;
  reason?: string | null;
  stageName?: string | null;
  value?: number | null;
  destinationNumber?: string | null;
}

export interface ForwardLeadSummaryResult {
  ok: boolean;
  summary: string;
  destination: string;
  messageText: string;
  skipped?: boolean;
  error?: string;
}

/**
 * Normaliza e formata um número para o padrão internacional (E.164 sem +)
 */
export function sanitizeWhatsAppNumber(num: string): string {
  let clean = (num || "").replace(/\D/g, "");
  if (!clean) return "";
  // Se tem 10 ou 11 dígitos (DDD + número BR), adiciona o DDI 55
  if (clean.length === 10 || clean.length === 11) {
    clean = `55${clean}`;
  }
  return clean;
}

/**
 * Gera um resumo executivo inteligente do lead e o encaminha para o WhatsApp de destino
 */
export async function generateAndForwardLeadSummary({
  supabase,
  companyId,
  userId,
  leadNumber,
  leadName,
  reason,
  stageName,
  value,
  destinationNumber,
}: ForwardLeadSummaryParams): Promise<ForwardLeadSummaryResult> {
  const cleanLeadNum = (leadNumber || "").replace(/\D/g, "");

  // 1. Busca configurações do agente (especialmente telefone_transferencia)
  const { data: cfg } = await supabase
    .from("agent_config")
    .select("telefone_transferencia, nome_empresa, nome_agente")
    .eq("company_id", companyId)
    .maybeSingle();

  const targetPhone = destinationNumber || cfg?.telefone_transferencia || "";
  const cleanDest = sanitizeWhatsAppNumber(targetPhone);

  if (!cleanDest || cleanDest.length < 10) {
    return {
      ok: false,
      summary: "",
      destination: "",
      messageText: "",
      skipped: true,
      error: "Número de destino para encaminhamento não configurado ou inválido.",
    };
  }

  // 2. Busca histórico recente de mensagens com o lead
  const { data: histRows } = await supabase
    .from("mensagens")
    .select("autor, direcao, texto, created_at")
    .eq("company_id", companyId)
    .eq("numero", cleanLeadNum)
    .order("created_at", { ascending: false })
    .limit(25);

  const msgs = (histRows ?? []).slice().reverse();
  const histFormatted = msgs.length
    ? msgs
        .map((m: any) => `[${m.direcao === "entrada" ? "CLIENTE" : m.autor?.toUpperCase() || "ATENDENTE"}]: ${m.texto}`)
        .join("\n")
    : "(Sem mensagens registradas)";

  // 3. Busca detalhes do CRM se não passados
  let currentStage = stageName;
  let currentVal = value;
  let clientName = leadName;

  if (!currentStage || currentVal === undefined || !clientName) {
    const { data: card } = await supabase
      .from("crm_cards")
      .select("nome, status, valor, observacao")
      .eq("company_id", companyId)
      .eq("numero", cleanLeadNum)
      .maybeSingle();

    if (card) {
      if (!currentStage) currentStage = card.status;
      if (currentVal === undefined && card.valor) currentVal = Number(card.valor);
      if (!clientName && card.nome) clientName = card.nome;
    }
  }

  // 4. Gera resumo estruturado com Gemini
  const systemPrompt = `Você é um assistente de vendas e CRM sênior.
Sua missão é ler o histórico da conversa de um cliente pelo WhatsApp e gerar um RESUMO EXECUTIVO claro, conciso e objetivo para ser encaminhado ao atendente humano ou gerente de vendas.

Instruções para o resumo:
- Destaque o que o cliente busca, seus interesses ou itens solicitados.
- Destaque dúvidas ou objeções pendentes.
- Destaque o motivo da transferência e a urgência/próximo passo.
- Formato: use tópicos objetivos (bullet points simples), direto ao ponto, sem enrolação.
- Retorne APENAS o resumo dos pontos principais (máximo 4 a 6 linhas).`;

  const userPrompt = `DADOS DO CLIENTE:
Nome: ${clientName || "Não informado"}
Telefone: ${cleanLeadNum}
Etapa no CRM: ${currentStage || "Conversas"}
${currentVal ? `Valor aproximado: R$ ${currentVal.toFixed(2)}` : ""}
Motivo informado: ${reason || "Transferência para atendimento humano"}

HISTÓRICO DA CONVERSA:
---
${histFormatted}
---

Gere o resumo executivo em tópicos agora:`;

  let aiSummary = "";
  try {
    aiSummary = await lovableAiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      "google/gemini-2.5-flash-lite",
    );
    aiSummary = aiSummary.trim();
  } catch (e: any) {
    console.error("[generateAndForwardLeadSummary] Erro ao gerar resumo com IA:", e?.message);
    aiSummary = `• Cliente solicitou atendimento humano.\n• Última mensagem: "${msgs[msgs.length - 1]?.texto || reason || "Sem texto"}"`;
  }

  // 5. Monta a mensagem executiva para o WhatsApp de destino
  const nomeDisplay = clientName ? `${clientName}` : `Lead (${cleanLeadNum})`;
  const etapaDisplay = currentStage || "Em atendimento";
  const motivoDisplay = reason || "Solicitação de atendimento humano";
  const valorDisplay = currentVal ? `\n💰 *Valor:* R$ ${Number(currentVal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "";

  const messageText =
    `🔔 *NOVO TRANSBORDO — ATENDDIZ*\n\n` +
    `👤 *Cliente:* ${nomeDisplay}\n` +
    `📱 *WhatsApp:* +${cleanLeadNum}\n` +
    `📊 *Etapa CRM:* ${etapaDisplay}${valorDisplay}\n` +
    `📌 *Motivo:* ${motivoDisplay}\n\n` +
    `📋 *Resumo da Conversa:*\n${aiSummary}\n\n` +
    `👉 *Iniciar Atendimento no WhatsApp:*\n` +
    `https://wa.me/${cleanLeadNum}`;

  // 6. Envia a mensagem via WhatsApp provider (OpenWA)
  try {
    const provider = getWhatsAppProvider();
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name, status")
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();

    if (inst?.instance_name) {
      await provider.sendText(companyId, inst.instance_name, cleanDest, messageText);
      console.log(`[lead-handover] Resumo encaminhado com sucesso para ${cleanDest} (Lead: ${cleanLeadNum})`);
    } else {
      console.warn(`[lead-handover] Nenhuma instância WhatsApp conectada para a empresa ${companyId}`);
    }
  } catch (e: any) {
    console.error("[lead-handover] Falha ao enviar WhatsApp para destino:", e?.message);
  }

  // 7. Pausa a IA para este contato para não haver conflito com o humano
  try {
    await supabase
      .from("contact_pause")
      .upsert(
        { company_id: companyId, user_id: userId || null, numero: cleanLeadNum, pausado: true },
        { onConflict: "company_id,numero" },
      );
  } catch (e: any) {
    console.warn("[lead-handover] Falha ao pausar contato:", e?.message);
  }

  return {
    ok: true,
    summary: aiSummary,
    destination: cleanDest,
    messageText,
  };
}
