// Geração e envio da resposta da IA para um contato do WhatsApp.
// Usado pelo webhook (mensagem nova) e ao religar a IA de um contato com mensagem pendente.

export type CrmStage = { id: string; nome: string; tipo: "normal" | "ganho" | "perda" };

export async function loadCrmStages(admin: any, companyId: string): Promise<CrmStage[]> {
  const { data: stagesRows } = await admin
    .from("crm_stage")
    .select("id, nome, tipo, ordem")
    .eq("company_id", companyId)
    .order("ordem", { ascending: true });
  return (stagesRows ?? []) as CrmStage[];
}

export async function runAiReply(opts: {
  admin: any;
  companyId: string;
  userId: string;
  instanceName: string;
  number: string;
  pushName?: string;
  text: string;
  stages: CrmStage[];
  cfg?: any;
  isReceipt?: boolean;
  receiptAnalysis?: any;
}): Promise<string> {
  const { admin: supabaseAdmin, companyId, userId, instanceName, number, pushName, text, stages } = opts;
  const isReceipt = !!opts.isReceipt;
  const receiptAnalysis = opts.receiptAnalysis ?? null;

  const { getWhatsAppProvider } = await import("@/lib/whatsapp-provider");
  const { lovableAiChat } = await import("@/lib/lovable-ai.server");
  const { buildSystemPrompt, parseAiOutput } = await import("@/lib/ai-prompt");
  const { textoSemMarcadorMidia } = await import("@/lib/midia-conversa.shared");
  const provider = getWhatsAppProvider();

  let cfg = opts.cfg;
  if (cfg === undefined) {
    const { data } = await supabaseAdmin
      .from("agent_config")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    cfg = data;
  }

  const { data: produtosRows } = await supabaseAdmin
    .from("produto")
    .select("*") // "*" em vez de listar imagem_url: não quebra o catálogo se a coluna faltar no banco
    .eq("company_id", companyId)
    .eq("ativo", true)
    .order("ordem", { ascending: true });
  const produtos = (produtosRows ?? []).map((p: any) => ({
    nome: p.nome,
    preco: p.preco,
    descricao: p.descricao,
    imagem_url: (p as any).imagem_url ?? null,
  }));

  // 12 mensagens em vez do histórico inteiro: o que é antigo já está resumido na ficha,
  // que vai no prompt. Menos tokens por resposta, sem perder o contexto do contato.
  const { data: histDesc } = await supabaseAdmin
    .from("mensagens")
    .select("autor,direcao,texto,created_at")
    .eq("company_id", companyId)
    .eq("numero", number)
    .order("created_at", { ascending: false })
    .limit(12);
  const historico = ((histDesc ?? []) as any[]).slice().reverse();

  let { data: cardRow } = await supabaseAdmin
    .from("crm_cards")
    .select("status, nome, stage_id, ficha, ficha_resumo")
    .eq("company_id", companyId)
    .eq("numero", number)
    .maybeSingle();
  if (!cardRow) {
    // Banco ainda sem a migração da ficha: segue sem ela.
    ({ data: cardRow } = await supabaseAdmin
      .from("crm_cards")
      .select("status, nome, stage_id")
      .eq("company_id", companyId)
      .eq("numero", number)
      .maybeSingle());
  }
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
    ficha: { campos: (cardRow as any)?.ficha ?? null, resumo: (cardRow as any)?.ficha_resumo ?? null },
  });

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...historico.map((m) => ({
      role: (m.direcao === "entrada" ? "user" : "assistant") as "user" | "assistant",
      // O caminho do arquivo no bucket não diz nada para a IA e só gasta token.
      content: textoSemMarcadorMidia(m.texto),
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
    return "no_credits";
  }
  const throttleReason = await getAiThrottleReason(supabaseAdmin, companyId, number);
  if (throttleReason) {
    await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
    console.warn("[whatsapp.safety] resposta pausada", throttleReason, companyId, number);
    return throttleReason;
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
      fallbackToGemini: true,
    });
  } catch (e: any) {
    console.error("[ai]", e?.message);
  }

  const { parts, stage, agendar, fotoUrl, pixValor, encaminharHumano } = parseAiOutput(rawReply, stages.map((s) => ({ nome: s.nome, tipo: s.tipo })));
  const finalParts = sanitizeAiParts(responderEmPartes ? parts : [parts.join(" ")]);

  // Gera PIX Copia e Cola instantâneo se a IA definiu valor de pagamento
  const chavePix = (cfg as any)?.chave_pix;
  if (pixValor && chavePix) {
    try {
      const { generatePixCopyPaste } = await import("@/lib/pix");
      const pixCode = generatePixCopyPaste({
        chave: chavePix,
        nome: (cfg as any)?.titular_pix || (cfg as any)?.nome_empresa || "Atendimento",
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
      isReceipt,
      observacao: receiptAnalysis?.resumo ? `Comprovante validado por IA: ${receiptAnalysis.resumo}` : undefined,
    },
  );

  // Contato novo: busca nome e foto de perfil depois que o card existe.
  const { sincronizarPerfilContato } = await import("@/lib/contato-perfil.server");
  await sincronizarPerfilContato({ admin: supabaseAdmin, companyId, instanceName, numero: number });

  // Ficha do atendimento: na transferência a equipe é avisada no painel (sem WhatsApp para terceiros);
  // fora dela, a ficha é mantida atualizada em intervalos.
  const ficha = await import("@/lib/ficha-atendimento.server");
  if (encaminharHumano) {
    await ficha.registrarTransferenciaHumano({
      admin: supabaseAdmin, companyId, userId, numero: number, motivo: encaminharHumano,
    });
  } else {
    await ficha.atualizarFichaSeNecessario({ admin: supabaseAdmin, companyId, numero: number });
  }

  return "ok";
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

export async function upsertCard(
  admin: any,
  companyId: string,
  userId: string,
  numero: string,
  nome: string | undefined,
  ultimaMensagem: string,
  stages: CrmStage[],
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

  // `nome` aqui é o nome do perfil de quem ESCREVEU. Só chega preenchido em mensagem recebida
  // (mensagem enviada pelo celular traz o nome do próprio número e renomearia o contato).
  const nomeWhatsapp = nome?.trim() || null;
  let cardName = existing?.nome || null;
  const nomeGenerico = !cardName || cardName === numero || /^\d+$/.test(cardName.replace(/\D/g, ""));
  if (nomeWhatsapp && nomeGenerico) cardName = nomeWhatsapp;

  const payload: any = {
    company_id: companyId,
    user_id: userId,
    numero,
    nome: cardName,
    ultima_mensagem: ultimaMensagem.slice(0, 240),
    ultima_em: new Date().toISOString(),
  };
  if (nomeWhatsapp) payload.nome_whatsapp = nomeWhatsapp;
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

  let { data: savedCard, error: upsertErr } = await admin
    .from("crm_cards")
    .upsert(payload, { onConflict: "company_id,numero" })
    .select("id")
    .maybeSingle();
  if (upsertErr && payload.nome_whatsapp && /nome_whatsapp/i.test(upsertErr.message || "")) {
    // Banco ainda sem a migração de nome/foto do contato: grava o resto.
    delete payload.nome_whatsapp;
    ({ data: savedCard } = await admin
      .from("crm_cards")
      .upsert(payload, { onConflict: "company_id,numero" })
      .select("id")
      .maybeSingle());
  } else if (upsertErr) {
    console.error("[upsertCard]", upsertErr.message);
  }

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
