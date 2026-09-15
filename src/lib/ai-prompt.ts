export interface ProdutoBrief {
  nome: string;
  preco?: number | string | null;
  descricao?: string | null;
  imagem_url?: string | null;
}

export interface StageBrief {
  nome: string;
  tipo?: "normal" | "ganho" | "perda";
}

export interface AgentConfig {
  // IA provider
  ai_provider?: string;
  ai_model?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;


  // Identidade
  nome_agente: string;
  nome_empresa: string;
  papel_objetivo: string;
  estilo_comunicacao: string;
  sobre_empresa: string;
  produtos_servicos: string;
  pode_fazer: string;
  nao_pode_fazer: string;
  telefone_transferencia: string;
  palavra_pausar: string;
  palavra_despausar: string;

  // Buffer / partes
  segundos_buffer?: number;
  responder_em_partes?: boolean;

  // Negócio (novos)
  segmento?: string;
  descricao_negocio?: string;
  diferenciais?: string;
  publico_alvo?: string;
  regiao_horario?: string;
  ofertas?: string;
  cupom?: string;
  como_vender?: string;
  objecoes?: string;
  formas_pagamento?: string;
  ticket_medio?: string;
  faq?: string;
  base_conhecimento?: string;
  politicas?: string;
  posvenda_msg?: string;
  pedir_avaliacao?: boolean;
  reativar_cliente?: boolean;

  // Vendas e Pagamento (PIX)
  chave_pix?: string;
  titular_pix?: string;
  instrucoes_pagamento?: string;

  // Personalidade
  tom?: number;            // 0-100 (sério→caloroso)
  formalidade?: number;    // 0-100
  usar_emojis?: boolean;   // legado
  tamanho_resposta?: string; // 'curtas' | 'medias' | 'longas'
  apresentacao?: string;

  // Personalidade avançada
  personalidade?: string | null;
  foco_atendimento?: string | null;
  emoji_intensidade?: string | null;
  usar_girias?: boolean | null;
  chamar_por_nome?: boolean | null;
  perguntar_uma_por_vez?: boolean | null;
  pode_brincar?: boolean | null;
  assinar_mensagens?: boolean | null;
  proatividade?: number | null;
  velocidade_resposta?: string | null;
  evitar_palavras?: string | null;
  idioma?: string | null;


  // Agendamento
  agendamento_ativo?: boolean;
  servicos_agendaveis?: string;
  duracao_padrao?: string;
  horarios_disponiveis?: string;
  antecedencia_min?: string;
}


export const PART_SEPARATOR = "|||";

const DEFAULT_STAGES: StageBrief[] = [
  { nome: "Conversas", tipo: "normal" },
  { nome: "Negociando", tipo: "normal" },
  { nome: "Ganho", tipo: "ganho" },
  { nome: "Perda", tipo: "perda" },
];

function describeTom(tom?: number | null) {
  const n = typeof tom === "number" ? tom : 70;
  if (n <= 25) return "tom mais sério e contido";
  if (n <= 55) return "tom equilibrado, atencioso";
  if (n <= 80) return "tom caloroso e simpático";
  return "tom muito caloroso, próximo, quase de amigo";
}

function describeFormalidade(f?: number | null) {
  const n = typeof f === "number" ? f : 40;
  if (n <= 25) return "linguagem informal (você, oi, beleza)";
  if (n <= 55) return "linguagem semi-formal (você, com cordialidade)";
  if (n <= 80) return "linguagem formal (senhor/senhora, prezado)";
  return "linguagem muito formal (cerimoniosa)";
}

function describeTamanho(t?: string | null) {
  switch ((t || "curtas").toLowerCase()) {
    case "longas": return "respostas mais longas e explicativas quando fizer sentido";
    case "medias":
    case "médias": return "respostas de tamanho médio";
    default: return "respostas curtas, no estilo WhatsApp";
  }
}

function describePersonalidade(p?: string | null): string {
  switch ((p || "padrao").toLowerCase()) {
    case "extrovertido":
      return "personalidade EXTROVERTIDA: animado, entusiasmado, usa exclamações com naturalidade, transmite energia positiva sem soar artificial";
    case "serio":
    case "sério":
      return "personalidade SÉRIA: postura profissional, objetivo, direto ao ponto, sem brincadeiras, transmite competência e segurança";
    case "divertido":
      return "personalidade DIVERTIDA: bem-humorado, leve, pode fazer brincadeiras inteligentes sem perder o profissionalismo";
    case "consultivo":
      return "personalidade CONSULTIVA: age como especialista/consultor, faz perguntas inteligentes, recomenda com fundamento";
    case "amigavel":
    case "amigável":
      return "personalidade AMIGÁVEL: acolhedor, próximo, demonstra interesse genuíno, parece um amigo prestativo";
    default:
      return "personalidade EQUILIBRADA: simpático sem exageros, profissional sem ser frio";
  }
}

function describeFoco(f?: string | null): string {
  switch ((f || "ambos").toLowerCase()) {
    case "vendas":
      return "FOCO PRINCIPAL = VENDEDOR FECHADOR DE ELITE (MODO VENDAS ATIVO). Conduza com proatividade para a venda, apresente os benefícios, quebre objeções com segurança, sugere combos e use perguntas de fechamento assertivas.";
    case "suporte":
      return "FOCO PRINCIPAL = ASSISTENTE DE ATENDIMENTO E SUPORTE (MODO CONSULTIVO & CORDIAL). Atenda com acolhimento, cordialidade e paciência. Esclareça todas as dúvidas com base no FAQ e regras da empresa. NÃO force compras, NÃO faça pressão de vendas e NÃO envie PIX ou cobrança sem que o cliente tenha pedido explicitamente.";
    default:
      return "FOCO HÍBRIDO (EQUILIBRADO): Responda dúvidas primeiro com clareza e empatia. Quando o cliente demonstrar intenção de compra, oriente e conduza para o fechamento com naturalidade.";
  }
}

function describeEmojis(intensidade?: string | null, legacy?: boolean | null): string {
  const i = (intensidade || (legacy === false ? "nenhum" : "pouco")).toLowerCase();
  switch (i) {
    case "nenhum": return "NUNCA use emojis";
    case "moderado": return "use emojis com frequência moderada (1 por mensagem quando combinar)";
    case "muito": return "use emojis com liberdade pra dar vida à conversa, sem exagerar";
    default: return "use no máximo 1 emoji ocasional, só quando combinar muito";
  }
}

function describeProatividade(p?: number | null): string {
  const n = typeof p === "number" ? p : 50;
  if (n <= 25) return "seja REATIVO: só responda o que o cliente perguntar, não antecipe ofertas";
  if (n <= 60) return "seja MODERADAMENTE PROATIVO: sugira o próximo passo quando fizer sentido";
  return "seja MUITO PROATIVO: antecipe necessidades, sugira upsell/cross-sell, conduza ativamente pro fechamento";
}

function safeText(val: any): string {
  if (!val) return "";
  if (typeof val === "string") return val.trim();
  if (Array.isArray(val)) {
    return val
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (item?.objecao && item?.resposta) return `• ${item.objecao}: ${item.resposta}`;
        if (item?.pergunta && item?.resposta) return `• P: ${item.pergunta}\n  R: ${item.resposta}`;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function montaPersonalidade(c: Partial<AgentConfig>): string {
  return [
    describePersonalidade(c.personalidade),
    describeTom(c.tom),
    describeFormalidade(c.formalidade),
    describeTamanho(c.tamanho_resposta),
    describeEmojis(c.emoji_intensidade, c.usar_emojis),
    describeProatividade(c.proatividade),
    c.usar_girias ? "pode usar gírias leves do cotidiano brasileiro" : "evite gírias e expressões muito informais",
    c.pode_brincar ? "pode fazer brincadeiras pontuais e leves" : "evite brincadeiras",
    c.chamar_por_nome === false ? "NÃO chame o cliente pelo nome a cada mensagem" : "chame o cliente pelo nome quando souber, sem repetir em toda mensagem",
    c.perguntar_uma_por_vez === false ? "" : "faça SEMPRE uma pergunta por vez (nunca dispare várias juntas)",
  ].filter(Boolean).join("; ");
}

export function buildSystemPrompt(
  c: Partial<AgentConfig>,
  opts?: {
    responderEmPartes?: boolean;
    estagioAtual?: string;
    resumoContato?: string;
    produtos?: ProdutoBrief[];
    stages?: StageBrief[];
    googleConectado?: boolean;
  },
): string {
  const partes = opts?.responderEmPartes ?? c.responder_em_partes ?? true;
  const stages = (opts?.stages && opts.stages.length > 0) ? opts.stages : DEFAULT_STAGES;
  const produtos = opts?.produtos ?? [];

  const personalidade = montaPersonalidade(c);

  const produtosBloco = produtos.length
    ? "CATÁLOGO DE PRODUTOS / SERVIÇOS (itens reais e preços):\n" +
      produtos
        .map((p) => {
          // Preço zerado/vazio fica de fora: evita a IA repetir "R$ 0" (a descrição diz se é gratuito ou sob consulta).
          const precoNum = Number(String(p.preco ?? "").replace(",", "."));
          const preco = Number.isFinite(precoNum) && precoNum > 0 ? ` — R$ ${p.preco}` : "";
          const desc = p.descricao ? ` (${p.descricao})` : "";
          const foto = p.imagem_url ? ` [FOTO DISPONÍVEL: ${p.imagem_url}]` : "";
          return `• ${p.nome}${preco}${desc}${foto}`;
        })
        .join("\n") +
      "\n\nREGRA DE ENVIO DE FOTO: Se o cliente pedir para ver o produto, pedir fotos ou demonstrar interesse em um item que possui [FOTO DISPONÍVEL: url], inclua exatamente [ENVIAR_FOTO: url] na sua resposta. O sistema enviará a foto automaticamente ao cliente!"
    : "";

  // Marcadores como [nome] na apresentação viram o nome do agente.
  const apresentacao = c.apresentacao?.replace(/\[\s*nome\s*\]|\{\s*nome\s*\}/gi, c.nome_agente || "assistente virtual");
  // Instruções de PIX só fazem sentido se a empresa cadastrou chave (senão contradizem "não cobramos por WhatsApp").
  const temPix = !!c.chave_pix?.trim();

  const stageNames = stages.map((s) => s.nome).join(" | ");
  const stagesFinaisNomes = stages.filter((s) => s.tipo === "ganho" || s.tipo === "perda").map((s) => s.nome);

  const blocos = [
    `Você é ${c.nome_agente || "um consultor de vendas virtual"}, atendendo no WhatsApp da empresa ${c.nome_empresa || "(empresa)"}.`,
    apresentacao ? `Como se apresenta na primeira mensagem: ${apresentacao}` : "",
    `Objetivo: ${c.papel_objetivo || "atender clientes com excelência, descobrir suas necessidades, recomendar produtos/serviços e fechar vendas de forma ativa e consultiva."}`,
    describeFoco(c.foco_atendimento),
    `Personalidade: ${personalidade}.`,
    c.evitar_palavras ? `PALAVRAS / EXPRESSÕES PROIBIDAS (nunca use): ${c.evitar_palavras}` : "",
    c.assinar_mensagens ? `Assine a primeira mensagem do dia com "— ${c.nome_agente || "Atendente"}".` : "",
    c.estilo_comunicacao ? `Estilo de comunicação extra: ${c.estilo_comunicacao}` : "",

    ...(c.foco_atendimento === "suporte"
      ? [
          "DIRETRIZES DE ATENDIMENTO E SUPORTE (ASSISTENTE CONSULTIVO):",
          "1. Priorize a dúvida ou problema do cliente com clareza, empatia e cordialidade.",
          "2. Esclareça horários, localização, serviços, produtos e regras da empresa sem pressionar o cliente a comprar.",
          "3. NÃO force vendas nem insista em pagamentos/PIX a menos que o cliente solicite explicitamente a compra ou contratação.",
          "4. Se o cliente solicitar compra ou contratação, forneça os valores e as instruções de forma tranquila e prestativa.",
        ]
      : [
          "DIRETRIZES DE CONDUÇÃO E FECHAMENTO:",
          "1. NUNCA finalize uma mensagem de forma passiva como 'fico à disposição' ou 'qualquer dúvida me chame'. Termine conduzindo para o próximo passo definido no COMO VENDER da empresa, com uma pergunta (ex: 'Quer que eu já deixe isso reservado para você?').",
          "2. QUEBRA DE OBJEÇÕES: Se o cliente hesitar, use as respostas de objeções da empresa e destaque os diferenciais reais. Se houver oferta ativa, use com naturalidade, sem pressionar.",
          ...(c.foco_atendimento === "vendas"
            ? ["3. COMPLEMENTARES: Quando o cliente escolher um item, se houver outro item do catálogo que realmente combine, sugira UM complemento com naturalidade e apenas uma vez."]
            : []),
          ...(temPix
            ? [
                "FECHAMENTO COM PIX COPIA E COLA: Quando o cliente fechar o pedido, confirme o valor total. Se você souber o valor exato, inclua na mesma resposta o marcador [PIX_COPIA_E_COLA: valor] (exemplo: [PIX_COPIA_E_COLA: 120.00]). O sistema gerará e enviará automaticamente o código oficial do PIX Copia e Cola para o cliente pagar em 1 toque no app do banco.",
                "COMPROVANTE: Ao passar os dados de pagamento, lembre o cliente de enviar a foto do comprovante aqui para validação instantânea.",
              ]
            : ["PAGAMENTO: não envie chave PIX, código de pagamento nem dados bancários. Siga as instruções de pagamento da empresa."]),
        ]),

    c.segmento ? `Segmento da empresa: ${c.segmento}.` : "",
    c.sobre_empresa ? `Sobre a empresa:\n${c.sobre_empresa}` : "",
    c.descricao_negocio ? `Descrição do negócio:\n${c.descricao_negocio}` : "",
    c.diferenciais ? `Diferenciais:\n${c.diferenciais}` : "",
    c.publico_alvo ? `Público-alvo: ${c.publico_alvo}` : "",
    c.regiao_horario ? `Região / horário de atendimento: ${c.regiao_horario}` : "",
    c.produtos_servicos ? `Produtos/serviços (descrição livre):\n${c.produtos_servicos}` : "",
    produtosBloco,
    c.ofertas ? `OFERTAS ATIVAS:\n${c.ofertas}` : "",
    c.cupom ? `Cupom disponível: ${c.cupom} (só ofereça quando fizer sentido pra fechar)` : "",
    c.formas_pagamento ? `Formas de pagamento aceitas: ${c.formas_pagamento}` : "",
    temPix
      ? `DADOS OFICIAIS PARA PAGAMENTO VIA PIX / FECHAMENTO:
• Chave PIX: ${c.chave_pix}
${c.titular_pix ? `• Titular / Beneficiário: ${c.titular_pix}` : ""}
Ao passar a chave PIX, envie o valor total exato e a chave de forma limpa em uma linha destacada para que o cliente consiga copiar com facilidade no WhatsApp. Solicite o envio do comprovante para separação do pedido.`
      : "",
    c.instrucoes_pagamento ? `INSTRUÇÕES DE PAGAMENTO / ENTREGA (siga exatamente):\n${c.instrucoes_pagamento}` : "",
    c.ticket_medio ? `Ticket médio de referência: ${c.ticket_medio}` : "",
    safeText(c.como_vender) ? `COMO VENDER (passo a passo de vendas da empresa):\n${safeText(c.como_vender)}` : "",
    safeText(c.objecoes) ? `OBJEÇÕES COMUNS E COMO RESPONDER:\n${safeText(c.objecoes)}` : "",
    safeText(c.faq) ? `FAQ:\n${safeText(c.faq)}` : "",
    safeText(c.base_conhecimento) ? `BASE DE CONHECIMENTO / REGRAS DE NEGÓCIO:\n${safeText(c.base_conhecimento)}` : "",
    safeText(c.politicas) ? `POLÍTICAS (troca/cancelamento/garantia):\n${safeText(c.politicas)}` : "",
    c.posvenda_msg ? `Mensagem padrão de pós-venda: ${c.posvenda_msg}` : "",
    c.pedir_avaliacao ? "Quando uma venda for concluída, peça uma avaliação de forma natural." : "",
    c.reativar_cliente ? "Pode reativar clientes inativos com mensagens leves e relevantes." : "",
    safeText(c.pode_fazer) ? `O QUE VOCÊ PODE FAZER:\n${safeText(c.pode_fazer)}` : "",
    safeText(c.nao_pode_fazer) ? `O QUE VOCÊ NÃO PODE FAZER:\n${safeText(c.nao_pode_fazer)}` : "",
    c.agendamento_ativo
      ? `AGENDAMENTO ATIVO: você pode propor horários para ${c.servicos_agendaveis || "os serviços agendáveis"}. ` +
        `Duração padrão: ${c.duracao_padrao || "30 min"}. ` +
        `Janelas disponíveis: ${c.horarios_disponiveis || "(não informado)"}. ` +
        `Antecedência mínima: ${c.antecedencia_min || "2 horas"}. ` +
        `Sempre confirme nome e o melhor horário antes de fechar o agendamento.`
      : "",
    c.telefone_transferencia
      ? `TRANSBORDO HUMANO: Se o cliente pedir atendimento humano, reclamar de algo delicado ou solicitar algo fora do escopo, avise educadamente que está transferindo. Em seguida, inclua o marcador [ENCAMINHAR_HUMANO: motivo] na resposta. O sistema encaminhará automaticamente um resumo executivo da conversa para ${c.telefone_transferencia}.`
      : "TRANSBORDO HUMANO: Se o cliente pedir atendimento humano ou for algo sensível, diga educadamente que vai chamar alguém do time e inclua [ENCAMINHAR_HUMANO: motivo].",
    opts?.resumoContato ? `Contexto do contato: ${opts.resumoContato}` : "",
    opts?.estagioAtual ? `Estágio atual no CRM: ${opts.estagioAtual}.` : "",
    `MÉTODO DE ATENDIMENTO (siga sempre):
1. Cumprimente com naturalidade só na PRIMEIRA mensagem da conversa. Depois NÃO repita saudação.
2. Antes de oferecer qualquer coisa, ENTENDA a necessidade do cliente. Faça UMA pergunta por vez (nunca várias juntas).
3. Qualifique aos poucos: nome (se não souber), o que precisa, para quando, contexto/urgência.
4. Só fale de produto/serviço/preço/condição quando o cliente perguntar OU quando você já souber o suficiente pra recomendar com sentido.
5. NUNCA invente preço, prazo, política, estoque, endereço ou qualquer info que não está no prompt. Se não tiver a info: diga que vai confirmar e, se fizer sentido, transfira pro humano.
6. Conduza pro próximo passo concreto: agendar, enviar proposta, confirmar pedido, marcar visita, etc.
7. Respeite SEMPRE o que está em "NÃO pode fazer".

ESTILO DE MENSAGEM (WhatsApp humano):
- Português do Brasil, tom próximo, sem ser formal demais e sem ser infantil.
- Mensagens CURTAS, frases naturais, como gente digita no WhatsApp. Nada de textão.
- Sem markdown pesado, sem listas com bullets, sem emojis em excesso.
- Não repita o nome do cliente em toda mensagem. Não repita o que ele acabou de dizer.
- Não soe como robô ("Como posso ajudá-lo hoje?"). Soe como um atendente real e atencioso.`,
  ];

  if (partes) {
    blocos.push(
      `FORMATO DA RESPOSTA (OBRIGATÓRIO):
Responda em 1 a 3 mensagens curtas, separadas pelo marcador "${PART_SEPARATOR}" (três pipes).
Cada parte é uma "bolha" curta, como se você estivesse digitando uma de cada vez no WhatsApp.
Exemplo: "oi, tudo bem? ${PART_SEPARATOR} aqui é a Ana da Padaria do Bairro ${PART_SEPARATOR} me conta, é pra retirar ou entrega?"
Se uma frase só já resolve, use UMA parte e pronto (sem o marcador). Nunca mais de 3 partes.`,
    );
  } else {
    blocos.push(`FORMATO DA RESPOSTA: uma mensagem só, curta e natural.`);
  }

  if (c.agendamento_ativo && opts?.googleConectado) {
    const nowIso = new Date().toISOString();
    blocos.push(
      `AGENDAMENTO REAL (Google Agenda conectado):
Hoje é ${nowIso} (UTC, fuso America/Sao_Paulo). Quando o cliente CONFIRMAR um horário específico (dia + hora) para um serviço agendável, ` +
        `na MESMA resposta, em uma nova linha, escreva exatamente:
[AGENDAR: AAAA-MM-DDTHH:MM | AAAA-MM-DDTHH:MM | título curto]
A primeira data é o início, a segunda é o fim (use ${c.duracao_padrao || "30 min"} se o cliente não disser). ` +
        `Use o fuso -03:00 nos horários (ex.: 2026-06-20T15:00:00-03:00). Esse marcador é interno e NÃO aparece pro cliente. ` +
        `Só emita o marcador quando o cliente confirmou claramente. Nunca invente horários que o cliente não disse.`,
    );
  }

  blocos.push(
    `AO FINAL DA RESPOSTA, em uma nova linha, escreva exatamente:
[ESTAGIO: ${stageNames}]
Escolha 1 entre as etapas reais do CRM da empresa listadas acima que melhor reflete o momento da negociação:
` +
      (temPix ? `- Se enviou a chave PIX ou aguarda comprovante/pagamento: escolha a etapa mais condizente (ex: "Aguardando Pagamento" ou "Negociando").\n` : "") +
      (stagesFinaisNomes.length
        ? `- Use uma etapa final (${stagesFinaisNomes.join(" / ")}) APENAS se o cliente confirmou o pagamento/pedido (ganho) ou recusou/desistiu claramente (perda).\n`
        : "") +
      `Esse marcador é interno, NÃO aparece pro cliente.`,
  );

  return blocos.filter(Boolean).join("\n\n");
}

export interface AgendarBrief { inicio: string; fim: string; titulo: string; }

export function parseAiOutput(
  raw: string,
  stages?: StageBrief[],
): {
  parts: string[];
  stage: string | null;
  agendar: AgendarBrief | null;
  fotoUrl: string | null;
  pixValor: number | null;
  encaminharHumano: string | null;
} {
  let text = raw || "";
  let stage: string | null = null;
  let agendar: AgendarBrief | null = null;
  let fotoUrl: string | null = null;
  let encaminharHumano: string | null = null;

  const handoverMatch = text.match(/\[\s*(?:ENCAMINHAR_HUMANO|TRANSBORDO|TRANSFERIR_HUMANO)\s*:\s*([^\]]+)\]/i);
  if (handoverMatch) {
    encaminharHumano = handoverMatch[1].trim();
    text = text.replace(handoverMatch[0], "").trim();
  }

  const fotoMatch = text.match(/\[\s*(?:ENVIAR_FOTO|FOTO)\s*:\s*([^\]]+)\]/i);
  if (fotoMatch) {
    fotoUrl = fotoMatch[1].trim();
    text = text.replace(fotoMatch[0], "").trim();
  }

  let pixValor: number | null = null;
  const pixMatch = text.match(/\[\s*(?:PIX_COPIA_E_COLA|GERAR_PIX|PIX)\s*:\s*([^\]]+)\]/i);
  if (pixMatch) {
    const rawVal = pixMatch[1].replace(/[^\d.,]/g, "").replace(",", ".");
    const parsed = parseFloat(rawVal);
    if (!isNaN(parsed) && parsed > 0) pixValor = parsed;
    text = text.replace(pixMatch[0], "").trim();
  }

  const agMatch = text.match(/\[\s*AGENDAR\s*:\s*([^\]]+)\]/i);
  if (agMatch) {
    const parts = agMatch[1].split("|").map((s) => s.trim());
    if (parts.length >= 2) {
      agendar = {
        inicio: parts[0],
        fim: parts[1],
        titulo: (parts[2] || "Agendamento").slice(0, 120),
      };
    }
    text = text.replace(agMatch[0], "").trim();
  }

  const stageMatch = text.match(/\[\s*ESTAGIO\s*:\s*([^\]]+)\]/i);
  if (stageMatch) {
    const candidate = stageMatch[1].trim().toLowerCase();
    if (stages && stages.length) {
      const found = stages.find((s) => s.nome.toLowerCase() === candidate);
      if (found) stage = found.nome;
      else {
        const starts = stages.find((s) => candidate.startsWith(s.nome.toLowerCase()));
        if (starts) stage = starts.nome;
      }
    } else {
      stage = stageMatch[1].trim();
    }
    text = text.replace(stageMatch[0], "").trim();
  }
  const parts = text
    .split(PART_SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, 3);
  return { parts: parts.length ? parts : [text.trim()].filter(Boolean), stage, agendar, fotoUrl, pixValor, encaminharHumano };
}

export function classifyStagePromptInstruction(): string {
  return (
    "Você é um classificador. Dado o histórico curto de mensagens entre um vendedor e um lead pelo WhatsApp, " +
    "responda APENAS com UMA palavra correspondente ao nome de uma etapa do CRM."
  );
}
