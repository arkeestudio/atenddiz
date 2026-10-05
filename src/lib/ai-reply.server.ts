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
  /** O cliente mandou nota de voz (o texto aqui é a transcrição). Decide se a resposta volta em áudio. */
  entradaFoiAudio?: boolean;
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
  // Notas internas (da equipe ou do sistema) ficam fora: a IA leria como fala dela própria.
  const { data: histDesc } = await supabaseAdmin
    .from("mensagens")
    .select("autor,direcao,texto,created_at")
    .eq("company_id", companyId)
    .eq("numero", number)
    .not("texto", "like", `${NOTA_INTERNA}%`)
    .order("created_at", { ascending: false })
    .limit(12);
  const historico = ((histDesc ?? []) as any[]).slice().reverse();

  let { data: cardRow } = await supabaseAdmin
    .from("crm_cards")
    .select("id, status, nome, stage_id, ficha, ficha_resumo")
    .eq("company_id", companyId)
    .eq("numero", number)
    .maybeSingle();
  if (!cardRow) {
    // Banco ainda sem a migração da ficha: segue sem ela.
    ({ data: cardRow } = await supabaseAdmin
      .from("crm_cards")
      .select("id, status, nome, stage_id")
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

  // A IA só pode oferecer horário que a agenda não tenha: os ocupados dos próximos dias vão
  // no prompt. Se o Google falhar, segue sem a lista — o conflito é conferido de novo na hora
  // de marcar, então o pior caso é a IA propor um horário que o sistema vai recusar.
  const googleConectado = !!googleIntegration?.conectado;
  const agendaLigada = !!cfg?.agendamento_ativo;
  let ocupados: Array<{ inicio: string; fim: string }> | null = null;
  if (agendaLigada) {
    try {
      const { DIAS_OCUPADOS_NO_PROMPT, ocupadosLocais } = await import("@/lib/agenda.server");
      const agora = new Date();
      const ate = new Date(agora.getTime() + DIAS_OCUPADOS_NO_PROMPT * 86_400_000).toISOString();
      // Locais sempre (a equipe marca visita à mão pela Agenda); Google por cima, quando há.
      ocupados = await ocupadosLocais(supabaseAdmin, companyId, agora.toISOString(), ate);
      if (googleConectado) {
        const { listarOcupados } = await import("@/lib/google.server");
        ocupados = [...ocupados, ...(await listarOcupados(supabaseAdmin, companyId, agora.toISOString(), ate))];
      }
    } catch (e: any) {
      console.warn("[agenda] não foi possível ler os ocupados:", e?.message);
    }
  }

  const responderEmPartes = cfg?.responder_em_partes ?? true;
  const { descreverOcupados } = await import("@/lib/agenda.server");
  const system = buildSystemPrompt(cfg ?? {}, {
    responderEmPartes,
    estagioAtual,
    resumoContato,
    produtos,
    stages: stages.map((s) => ({ nome: s.nome, tipo: s.tipo })),
    googleConectado: !!googleIntegration?.conectado,
    ocupados: ocupados ? descreverOcupados(ocupados) : undefined,
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
    await registrarSemResposta(supabaseAdmin, companyId, number, "créditos de IA esgotados");
    return "no_credits";
  }
  const throttleReason = await getAiThrottleReason(supabaseAdmin, companyId, number);
  if (throttleReason) {
    await upsertCard(supabaseAdmin, companyId, userId, number, pushName, text, stages);
    console.warn("[whatsapp.safety] resposta pausada", throttleReason, companyId, number);
    await registrarSemResposta(supabaseAdmin, companyId, number, throttleReason);
    return "throttled";
  }
  const plan = await getCompanyPlan(companyId);
  let providerChoice = ((cfg as any)?.ai_provider || "gemini") as string;
  let modelChoice = ((cfg as any)?.ai_model || "google/gemini-2.5-flash") as string;
  if (!allowsProvider(plan.slug, providerChoice)) {
    providerChoice = "gemini";
    modelChoice = "google/gemini-2.5-flash";
  }

  let rawReply = "";
  const inicioIa = Date.now();
  try {
    rawReply = await lovableAiChat(messages, {
      provider: providerChoice,
      model: modelChoice,
      openaiKey: (cfg as any)?.openai_api_key || "",
      anthropicKey: (cfg as any)?.anthropic_api_key || "",
      fallbackToGemini: true,
      // Atendimento é literal: preço, horário e política vêm do prompt, não da imaginação.
      temperature: 0.3,
      // Resposta de WhatsApp em até 3 bolhas + marcadores internos cabe folgado aqui.
      maxTokens: 1500,
    });
  } catch (e: any) {
    console.error("[ai]", e?.message);
  }

  const { parts, stage, agendar, fotoUrl, pixValor, encaminharHumano, segmento, cancelarVisita } = parseAiOutput(rawReply, stages.map((s) => ({ nome: s.nome, tipo: s.tipo })));
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

  // [AGENDAR: ...] é proposta da IA, não decisão. Antes de virar evento: a data faz sentido?
  // a agenda está livre naquele intervalo (lida de novo agora, não a de minutos atrás)?
  // já não foi marcado? Qualquer "não" vira um aviso honesto ao cliente, em vez de um
  // "agendado!" que a coordenação descobriria em cima da hora que não existia.
  // E, em cada desfecho, a equipe fica sabendo: nota interna na conversa (só a equipe vê),
  // próxima ação no card do funil e, se deu certo, a visita registrada — com ou sem Google.
  // Uma IA atendendo 30 pessoas não pode decidir sozinha sem deixar rastro para o humano.
  let agendaResultado: string | null = null;

  // Cliente desmarcou (respondendo à confirmação do dia anterior, ou por conta própria): as
  // visitas futuras dele saem da agenda, a equipe é avisada e o card pede remarcação. Se a IA
  // marcou outra na mesma resposta, o bloco abaixo cria a nova em seguida.
  if (cancelarVisita && (cardRow as any)?.id) {
    try {
      const { descreverHorario } = await import("@/lib/agenda.server");
      const { data: futuras } = await supabaseAdmin
        .from("agendamento")
        .select("id, inicio, google_event_id")
        .eq("company_id", companyId)
        .eq("card_id", (cardRow as any).id)
        .eq("status", "agendado")
        .gte("fim", new Date().toISOString());
      const lista = (futuras ?? []) as Array<{ id: string; inicio: string; google_event_id: string | null }>;
      if (lista.length) {
        await supabaseAdmin.from("agendamento").update({ status: "cancelado" }).in("id", lista.map((f) => f.id));
        const quando = lista.map((f) => descreverHorario(new Date(f.inicio))).join(", ");
        const noGoogle = lista.some((f) => f.google_event_id);
        const nome = (cardRow as any)?.nome || pushName || number;
        const fichaAtual = (cardRow as any)?.ficha && typeof (cardRow as any).ficha === "object" ? (cardRow as any).ficha : {};
        const chaveVisita = Object.keys(fichaAtual).find((k) => /visita/i.test(k)) || "visita";
        await supabaseAdmin
          .from("crm_cards")
          .update({ ficha: { ...fichaAtual, [chaveVisita]: "" }, proxima_acao: "Remarcar visita", follow_up: null } as any)
          .eq("id", (cardRow as any).id);
        await notaInterna(
          supabaseAdmin, companyId, userId, number,
          `🔁 ${nome} desmarcou a visita de ${quando}. A IA ofereceu outro horário.${noGoogle ? " O evento continua no Google Agenda — remova lá." : ""}`,
        );
        agendaResultado = `cancelada ${quando}`;
      }
    } catch (e: any) {
      console.warn("[cancelar-visita]", e?.message);
    }
  }

  if (agendar && agendaLigada) {
    const { validarAgendamento, conflita, jaAgendado, descreverHorario, ocupadosLocais } = await import("@/lib/agenda.server");
    const v = validarAgendamento(agendar);
    const nome = (cardRow as any)?.nome || pushName || number;
    if (!v.ok) {
      agendaResultado = `recusado: ${v.motivo}`;
      finalParts.push(`Só um ajuste: não consegui registrar esse horário, ${v.motivo}. Pode me confirmar o dia e a hora de novo?`);
      await notaInterna(supabaseAdmin, companyId, userId, number, `⚠️ A IA tentou marcar uma visita, mas ${v.motivo}. Pediu outro horário ao cliente.`);
    } else {
      const quando = descreverHorario(v.inicio);
      try {
        let ocupadosAgora = await ocupadosLocais(supabaseAdmin, companyId, v.inicio.toISOString(), v.fim.toISOString());
        if (googleConectado) {
          const { listarOcupados } = await import("@/lib/google.server");
          ocupadosAgora = [...ocupadosAgora, ...(await listarOcupados(supabaseAdmin, companyId, v.inicio.toISOString(), v.fim.toISOString()))];
        }
        if (conflita(ocupadosAgora, v.inicio, v.fim)) {
          agendaResultado = `conflito em ${quando}`;
          finalParts.push(`Ih, ${quando} acabou de ficar ocupado na agenda. Tem outro horário que fica bom para você?`);
          await notaInterna(supabaseAdmin, companyId, userId, number, `⚠️ ${nome} pediu visita ${quando}, mas o horário está ocupado. A IA pediu outro horário.`);
        } else if (await jaAgendado(supabaseAdmin, companyId, (cardRow as any)?.id ?? null, v.inicio)) {
          agendaResultado = "já existia, não duplicou";
        } else {
          if (googleConectado) {
            const { createCalendarEventForCompany } = await import("@/lib/google.server");
            await createCalendarEventForCompany(supabaseAdmin, companyId, {
              titulo: agendar.titulo,
              inicio: v.inicio.toISOString(),
              fim: v.fim.toISOString(),
              descricao: `Agendado via WhatsApp — ${nome}`,
              cardId: (cardRow as any)?.id ?? null,
            });
          } else {
            await supabaseAdmin.from("agendamento").insert({
              company_id: companyId,
              card_id: (cardRow as any)?.id ?? null,
              titulo: agendar.titulo,
              inicio: v.inicio.toISOString(),
              fim: v.fim.toISOString(),
              status: "agendado",
            });
          }
          agendaResultado = agendaResultado ? `${agendaResultado}; criado ${quando}` : `criado ${quando}`;
          // O card do funil mostra a próxima ação e a data: quem olha o Kanban vê "Visita
          // sex., 03/10 às 10:00" sem abrir a conversa.
          await supabaseAdmin
            .from("crm_cards")
            .update({ proxima_acao: `${agendar.titulo} — ${quando}`, follow_up: v.inicio.toISOString() } as any)
            .eq("company_id", companyId)
            .eq("numero", number);
          await notaInterna(
            supabaseAdmin, companyId, userId, number,
            `📅 Visita marcada pela IA — ${quando} (${agendar.titulo}). ` +
              (googleConectado ? "Já está no Google Agenda." : "Google Agenda não conectado: confira a agenda e confirme com a família."),
          );
        }
      } catch (e: any) {
        agendaResultado = `erro: ${e?.message}`;
        console.error("[agendar]", e?.message);
        finalParts.push("Não consegui confirmar na agenda agora. Vou pedir para a equipe confirmar esse horário com você.");
        await notaInterna(supabaseAdmin, companyId, userId, number, `⚠️ ${nome} confirmou visita ${quando}, mas o sistema não conseguiu registrar (${e?.message}). Confirme manualmente.`);
      }
    }
  }

  // Nota de voz: a resposta inteira numa fala só, quando a empresa ligou e o conteúdo
  // permite (curto, sem valor/data/link). O texto fica salvo na conversa do mesmo jeito,
  // para a equipe ler e a IA lembrar. Se não der, cai no envio em texto logo abaixo.
  const modoVoz = String(cfg?.voz_resposta || "nunca");
  const querVoz = modoVoz === "sempre" || (modoVoz === "quando_audio" && !!opts.entradaFoiAudio);
  let vozResultado: string | null = null;
  let enviouVoz = false;
  if (querVoz && finalParts.length && provider.sendVoice) {
    const { deveVirarAudio, gerarNotaDeVoz } = await import("@/lib/voz.server");
    const falado = finalParts.filter(Boolean).join(" ");
    const decisao = deveVirarAudio(falado);
    if (!decisao.ok) {
      vozResultado = `texto (${decisao.motivo})`;
    } else {
      // "Gravando áudio…" aparece no celular do cliente enquanto o TTS gera (5-6 s) e segura
      // mais um pouco em função da duração do áudio, como alguém que grava de verdade.
      // Não espera a duração toda: 13 s de "gravando" antes de responder é lento demais.
      const presenca = (p: "recording" | "paused") =>
        provider.sendPresence ? provider.sendPresence(companyId, instanceName, number, p).catch(() => {}) : Promise.resolve();
      await presenca("recording");
      const dataUrl = await gerarNotaDeVoz(falado, cfg?.voz_nome);
      if (!dataUrl) {
        vozResultado = "texto (TTS falhou)";
        await presenca("paused");
      } else {
        // WAV 24 kHz, 16 bits, mono: 48.000 bytes por segundo. Base64 ocupa 4/3 do tamanho.
        const bytes = (dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75;
        const segundosAudio = Math.max(0, (bytes - 44) / 48000);
        await new Promise((r) => setTimeout(r, Math.min(4000, Math.max(1000, segundosAudio * 300))));

        // A linha da nota de voz entra ANTES do envio: o WhatsApp devolve o eco (fromMe) em
        // segundos, e o webhook só reconhece o eco se a mensagem da IA já estiver gravada.
        // Se o envio falhar de verdade, a linha é apagada e a resposta vai em texto.
        const { AUDIO_ENVIADO, audioTranscribedText } = await import("@/lib/audio-labels");
        const { data: linhaVoz } = await supabaseAdmin
          .from("mensagens")
          .insert({
            company_id: companyId,
            user_id: userId,
            numero: number,
            contato_nome: pushName ?? null,
            direcao: "saida",
            autor: "ia",
            texto: audioTranscribedText(AUDIO_ENVIADO, falado),
            status_entrega: "enviado",
          } as any)
          .select("id")
          .maybeSingle();

        try {
          const sent: any = await provider.sendVoice(companyId, instanceName, number, dataUrl);
          await presenca("paused");
          // O sendPtt do open-wa nem sempre devolve o id como texto; não guarda lixo na coluna.
          if (typeof sent?.messageId === "string" && linhaVoz?.id) {
            await supabaseAdmin.from("mensagens").update({ whatsapp_message_id: sent.messageId } as any).eq("id", linhaVoz.id);
          }
          enviouVoz = true;
          vozResultado = sent?.semAck ? `áudio (${cfg?.voz_nome || "Zephyr"}, sem confirmação)` : `áudio (${cfg?.voz_nome || "Zephyr"})`;
        } catch (e: any) {
          await presenca("paused");
          // Erro de rede/timeout chega DEPOIS de o áudio já ter saído do servidor na maioria
          // das vezes (foi assim que o cliente recebeu o áudio e, 3 min depois, o mesmo texto).
          // Só cai para texto quando o servidor recusou na hora.
          const msg = String(e?.message || "");
          const recusou = /Áudio vazio|ffmpeg|Session not connected|400|500/i.test(msg) && !/indisponível|timeout|504|502/i.test(msg);
          if (recusou) {
            console.error("[voz] servidor recusou o áudio, indo em texto:", msg);
            if (linhaVoz?.id) await supabaseAdmin.from("mensagens").delete().eq("id", linhaVoz.id);
            vozResultado = "texto (servidor recusou o áudio)";
          } else {
            console.warn("[voz] sem resposta do servidor; áudio provavelmente entregue, não reenvia em texto:", msg);
            enviouVoz = true;
            vozResultado = `áudio (${cfg?.voz_nome || "Zephyr"}, sem confirmação do servidor)`;
          }
        }
      }
    }
  }

  for (let i = 0; i < finalParts.length && !enviouVoz; i++) {
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

  // Segmento do lead gravado na hora, na ficha do card. Só vale se casar com uma opção real
  // da empresa — a IA não cria categoria nova. Troca de segmento no meio da conversa (a
  // família passou a falar do outro filho) é aceita: a ficha reflete o assunto atual.
  let segmentoAplicado: string | null = null;
  if (segmento) {
    try {
      const { normalizeFichaCampos, campoSegmento, normalizarOpcao } = await import("@/lib/ficha-campos");
      const campoSeg = campoSegmento(normalizeFichaCampos(cfg?.ficha_campos));
      const opcao = campoSeg ? normalizarOpcao(segmento, campoSeg.opcoes!) : null;
      if (campoSeg && opcao) {
        const { data: atual } = await supabaseAdmin
          .from("crm_cards").select("id, ficha").eq("company_id", companyId).eq("numero", number).maybeSingle();
        const fichaAtual = (atual as any)?.ficha && typeof (atual as any).ficha === "object" ? (atual as any).ficha : {};
        if (fichaAtual[campoSeg.id] !== opcao) {
          await supabaseAdmin
            .from("crm_cards")
            .update({ ficha: { ...fichaAtual, [campoSeg.id]: opcao } } as any)
            .eq("company_id", companyId)
            .eq("numero", number);
          if ((atual as any)?.id) {
            await supabaseAdmin.from("lead_evento").insert({
              company_id: companyId, card_id: (atual as any).id, tipo: "segmento",
              descricao: fichaAtual[campoSeg.id] ? `Segmento mudou de ${fichaAtual[campoSeg.id]} para ${opcao}` : `Segmento identificado: ${opcao}`,
            });
          }
        }
        segmentoAplicado = opcao;
      } else if (segmento) {
        console.warn("[segmento] IA escreveu fora das opções:", segmento);
      }
    } catch (e: any) {
      console.warn("[segmento] não gravou:", e?.message);
    }
  }

  // Contato novo: busca nome e foto de perfil depois que o card existe.
  const { sincronizarPerfilContato } = await import("@/lib/contato-perfil.server");
  await sincronizarPerfilContato({ admin: supabaseAdmin, companyId, instanceName, numero: number });

  // Rastro de cada resposta no histórico do lead: é o que permite explicar depois "por que a
  // IA disse isso" — qual modelo, quanto demorou, que marcadores emitiu, o que a agenda fez.
  // Sem isso a investigação de um preço errado era console.log perdido.
  try {
    const { data: cardLog } = await supabaseAdmin
      .from("crm_cards").select("id").eq("company_id", companyId).eq("numero", number).maybeSingle();
    if (cardLog?.id) {
      const segundos = ((Date.now() - inicioIa) / 1000).toFixed(1);
      const pedacos = [
        `${finalParts.length} bolha(s), ${modelChoice.replace(/^google\//, "")}, ${segundos}s`,
        stage ? `etapa: ${stage}` : "sem etapa",
        segmentoAplicado ? `segmento: ${segmentoAplicado}` : null,
        agendaResultado ? `agenda: ${agendaResultado}` : null,
        vozResultado ? `voz: ${vozResultado}` : null,
        encaminharHumano ? `transferiu: ${encaminharHumano}` : null,
        pixValor ? `pix: R$ ${pixValor}` : null,
        fotoUrl ? "enviou foto" : null,
        !rawReply ? "SEM RESPOSTA DO MODELO" : null,
      ].filter(Boolean);
      await supabaseAdmin.from("lead_evento").insert({
        company_id: companyId, card_id: cardLog.id, tipo: "ia_resposta", descricao: pedacos.join(" · "),
      });
    }
  } catch (e: any) {
    console.warn("[ia_resposta] não registrou o rastro:", e?.message);
  }

  // Ficha do atendimento: na transferência a equipe é avisada no painel (sem WhatsApp para terceiros);
  // fora dela, a ficha é mantida atualizada em intervalos.
  const ficha = await import("@/lib/ficha-atendimento.server");
  if (encaminharHumano) {
    await ficha.registrarTransferenciaHumano({
      admin: supabaseAdmin, companyId, userId, numero: number, motivo: encaminharHumano,
    });
    await notaInterna(supabaseAdmin, companyId, userId, number, `🙋 A IA transferiu para a equipe: ${encaminharHumano}. O contato está na fila Aguardando Humano.`);
    await supabaseAdmin
      .from("crm_cards")
      .update({ proxima_acao: `Equipe: ${encaminharHumano}` } as any)
      .eq("company_id", companyId)
      .eq("numero", number);
  } else {
    await ficha.atualizarFichaSeNecessario({ admin: supabaseAdmin, companyId, numero: number });
  }

  return "ok";
}

// Reduz a frase ao seu conteúdo: sem acento, emoji, pontuação nem caixa. Serve só para
// comparar duas partes — "Fico aqui te aguardando 💙" e "Fico aqui te aguardando." viram
// a mesma coisa.
function essencia(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sanitizeAiParts(parts: string[]) {
  const limpas = parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((part) => (part.length > 700 ? `${part.slice(0, 697).trim()}...` : part));

  // O modelo às vezes devolve duas partes dizendo a mesma coisa, e o cliente recebia as
  // duas seguidas. Mantém a primeira e descarta a que repete (igual ou contida na outra).
  const saida: string[] = [];
  for (const parte of limpas) {
    const e = essencia(parte);
    if (!e) continue;
    const iguais = saida.findIndex((j) => {
      const a = essencia(j);
      return a === e || (a.length > 12 && e.length > 12 && (a.includes(e) || e.includes(a)));
    });
    if (iguais === -1) { saida.push(parte); continue; }
    // Quando uma repete a outra, fica com a mais completa: "Temos vaga sim, para o
    // berçário e o maternal" vale mais que "Temos vaga sim".
    if (essencia(parte).length > essencia(saida[iguais]).length) saida[iguais] = parte;
  }
  return saida.slice(0, 2);
}

/**
 * Freio contra loop (a IA respondendo a si mesma ou disparando em rajada), não contra
 * conversa animada. A regra antiga — 6 mensagens da IA em 10 min — contava BOLHAS, e com
 * 1 a 3 bolhas por resposta duas ou três respostas já paravam a IA no meio do papo, sem
 * aviso. Agora só barra quando a IA fala muito mais do que o cliente escreve, que é a
 * assinatura do loop; quem conversa de verdade nunca encosta nisso.
 */
async function getAiThrottleReason(admin: any, companyId: string, numero: string): Promise<string | null> {
  const now = Date.now();
  const desde10 = new Date(now - 10 * 60_000).toISOString();
  const [saidasContato, entradasContato, saidasEmpresa] = await Promise.all([
    admin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("numero", numero)
      .eq("direcao", "saida")
      .eq("autor", "ia")
      .gte("created_at", desde10),
    admin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("numero", numero)
      .eq("direcao", "entrada")
      .gte("created_at", desde10),
    admin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("direcao", "saida")
      .eq("autor", "ia")
      .gte("created_at", new Date(now - 60_000).toISOString()),
  ]);

  const saidas = saidasContato.count ?? 0;
  const entradas = entradasContato.count ?? 0;
  // 18 bolhas ≈ 6 respostas. Só é loop se, além disso, a IA mandou mais de 3x o que recebeu.
  if (saidas >= 18 && saidas > entradas * 3 + 3) {
    return `limite de segurança: ${saidas} mensagens da IA para ${entradas} do cliente em 10 min (parece loop)`;
  }
  // Teto da empresa por minuto: 60 bolhas ≈ 20 respostas. Protege contra disparo em massa.
  if ((saidasEmpresa.count ?? 0) >= 60) return "limite da empresa: mais de 60 mensagens da IA em 1 min";
  return null;
}

// Mesmo prefixo das notas da equipe (evolution.functions.ts / conversas.tsx): o painel mostra
// como cartão âmbar "só a equipe vê" e o WhatsApp nunca recebe.
const NOTA_INTERNA = "🔒 [NOTA INTERNA]:";

/**
 * Aviso da IA para a equipe, dentro da conversa. É o que falta quando a IA atende 30 pessoas
 * e decide coisas (marca visita, transfere): o humano precisa ver onde e quando aconteceu.
 * O painel também transforma essas notas em alerta em tempo real.
 */
async function notaInterna(admin: any, companyId: string, userId: string, numero: string, texto: string) {
  try {
    await admin.from("mensagens").insert({
      company_id: companyId,
      user_id: userId,
      numero,
      direcao: "saida",
      autor: "sistema",
      texto: `${NOTA_INTERNA} ${texto}`,
    });
  } catch (e: any) {
    console.warn("[nota-interna] não gravou:", e?.message);
  }
}

/** Quando a IA decide NÃO responder, isso precisa aparecer no histórico do lead — "parou do nada" é o pior diagnóstico. */
async function registrarSemResposta(admin: any, companyId: string, numero: string, motivo: string) {
  try {
    const { data: card } = await admin.from("crm_cards").select("id").eq("company_id", companyId).eq("numero", numero).maybeSingle();
    if (card?.id) {
      await admin.from("lead_evento").insert({ company_id: companyId, card_id: card.id, tipo: "ia_nao_respondeu", descricao: motivo });
    }
  } catch (e: any) {
    console.warn("[ia_nao_respondeu] não registrou:", e?.message);
  }
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
    .select("id, status, nome, stage_id, valor, observacao, origem, utm_source")
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

  // Origem só no nascimento do lead: depois disso é a equipe que manda. Sem isso não dá
  // para responder qual campanha virou matricula -- e o campo existia sem ninguem preencher.
  if (!existing?.origem) {
    payload.origem = (existing as any)?.utm_source?.trim() || "WhatsApp";
  }
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
