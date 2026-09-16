// SERVER ONLY. Ficha do atendimento: a IA lê a conversa, preenche os campos configurados
// e a transferência para humano fica registrada no próprio sistema (sem WhatsApp para terceiros).
import { normalizeFichaCampos, type FichaCampo } from "./ficha-campos";

export type FichaIaResult = {
  ficha: Record<string, string>;
  resumo: string;
  proximoPasso: string;
};

// Sem chamada de IA a cada mensagem: a ficha é atualizada no máximo a cada 30 min por contato
// (e sempre na transferência ou quando a equipe pede).
const FICHA_AUTO_INTERVAL_MS = 30 * 60_000;

function parseJsonLoose(raw: string): any {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function loadCampos(admin: any, companyId: string): Promise<FichaCampo[]> {
  const { data } = await admin.from("agent_config").select("ficha_campos").eq("company_id", companyId).maybeSingle();
  return normalizeFichaCampos(data?.ficha_campos);
}

/** Lê a conversa e atualiza a ficha do contato. Retorna null se não houver card/conversa. */
export async function atualizarFichaComIa(opts: {
  admin: any;
  companyId: string;
  numero: string;
  motivo?: string;
}): Promise<FichaIaResult | null> {
  const { admin, companyId, numero } = opts;

  const [campos, { data: card }, { data: histDesc }] = await Promise.all([
    loadCampos(admin, companyId),
    admin
      .from("crm_cards")
      .select("id, nome, status, ficha, ficha_resumo, ficha_proximo_passo")
      .eq("company_id", companyId)
      .eq("numero", numero)
      .maybeSingle(),
    admin
      .from("mensagens")
      .select("autor, direcao, texto, created_at")
      .eq("company_id", companyId)
      .eq("numero", numero)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (!card) return null;

  const historico = ((histDesc ?? []) as any[]).slice().reverse();
  if (!historico.length) return null;

  const atual: Record<string, string> = card.ficha && typeof card.ficha === "object" ? card.ficha : {};
  const conversa = historico
    .map((m) => {
      const quem = m.direcao === "entrada" ? "CLIENTE" : m.autor === "humano" ? "EQUIPE" : "ATENDENTE VIRTUAL";
      return `[${quem}] ${m.texto}`;
    })
    .join("\n");

  const camposTxt = campos
    .map((c) => `- "${c.id}": ${c.label}${c.dica ? ` (${c.dica})` : ""} — valor atual: ${JSON.stringify(atual[c.id] ?? "")}`)
    .join("\n");

  const system = `Você organiza a ficha de atendimento de um contato do WhatsApp para a equipe humana.
Leia a conversa e devolva SOMENTE um JSON válido, sem texto antes ou depois, no formato:
{"campos": {"<id>": "<valor>"}, "resumo": "<texto>", "proximo_passo": "<texto>"}

Regras:
- Use apenas informações ditas na conversa. Nunca invente nem deduza. Se não souber, use "" (nada de "filho", "não informado" ou similares).
- Cada campo só recebe o que foi dito especificamente sobre ele. O nome do contato no WhatsApp é de quem está conversando: não use esse nome para outra pessoa (ex: a criança) sem que a conversa diga isso.
- Sugestões do atendente não são decisões do cliente: só registre algo como combinado se o cliente confirmou.
- Os valores atuais podem ter sido corrigidos pela equipe: mantenha-os, a menos que a conversa traga informação mais nova e explícita.
- Valores curtos e objetivos (ex: "8 meses", "Integral").
- "resumo": 2 a 4 frases com o que o contato quer, o que já foi combinado e o que está pendente.
- "proximo_passo": uma frase com o que a equipe deve fazer agora.`;

  const user = `CAMPOS DA FICHA:
${camposTxt}

CONTATO: ${card.nome || numero} (${numero}) — etapa: ${card.status || "Conversas"}
${opts.motivo ? `MOTIVO DA TRANSFERÊNCIA PARA HUMANO: ${opts.motivo}\n` : ""}
CONVERSA:
${conversa}`;

  const { lovableAiChat } = await import("./lovable-ai.server");
  const raw = await lovableAiChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    "google/gemini-2.5-flash-lite",
  );
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error("A IA não devolveu a ficha em formato válido.");

  const ficha: Record<string, string> = { ...atual };
  const mudancas: string[] = [];
  for (const c of campos) {
    const novo = String(parsed?.campos?.[c.id] ?? "").trim();
    if (novo && novo !== (atual[c.id] ?? "")) {
      ficha[c.id] = novo;
      mudancas.push(c.label);
    }
  }
  const resumo = String(parsed?.resumo ?? "").trim() || card.ficha_resumo || "";
  const proximoPasso = String(parsed?.proximo_passo ?? "").trim() || card.ficha_proximo_passo || "";

  const { error } = await admin
    .from("crm_cards")
    .update({
      ficha,
      ficha_resumo: resumo || null,
      ficha_proximo_passo: proximoPasso || null,
      ficha_atualizada_em: new Date().toISOString(),
    })
    .eq("id", card.id);
  if (error) throw new Error(error.message);

  if (mudancas.length) {
    await admin.from("lead_evento").insert({
      company_id: companyId,
      card_id: card.id,
      tipo: "ficha_ia",
      descricao: `IA atualizou a ficha: ${mudancas.join(", ")}`,
    });
  }

  return { ficha, resumo, proximoPasso };
}

/** Atualiza a ficha em segundo plano da conversa, respeitando o intervalo mínimo. */
export async function atualizarFichaSeNecessario(opts: { admin: any; companyId: string; numero: string }) {
  try {
    const { data: card } = await opts.admin
      .from("crm_cards")
      .select("ficha_atualizada_em, ultima_em")
      .eq("company_id", opts.companyId)
      .eq("numero", opts.numero)
      .maybeSingle();
    if (!card) return;
    const last = card.ficha_atualizada_em ? new Date(card.ficha_atualizada_em).getTime() : 0;
    if (Date.now() - last < FICHA_AUTO_INTERVAL_MS) return;
    // Nada novo desde a última leitura: não gasta uma chamada de IA à toa.
    if (last && card.ultima_em && new Date(card.ultima_em).getTime() <= last) return;
    await atualizarFichaComIa(opts);
  } catch (e: any) {
    console.warn("[ficha] atualização automática falhou:", e?.message);
  }
}

/**
 * Transferência para humano dentro do sistema: pausa a IA para o contato, marca como
 * "aguardando humano" (a equipe é avisada no painel) e atualiza a ficha com o motivo.
 */
export async function registrarTransferenciaHumano(opts: {
  admin: any;
  companyId: string;
  userId?: string | null;
  numero: string;
  motivo: string;
}) {
  const { admin, companyId, numero, motivo } = opts;

  try {
    await admin
      .from("contact_pause")
      .upsert(
        { company_id: companyId, user_id: opts.userId || null, numero, pausado: true },
        { onConflict: "company_id,numero" },
      );
  } catch (e: any) {
    console.warn("[transferencia] falha ao pausar IA:", e?.message);
  }

  const { data: card } = await admin
    .from("crm_cards")
    .select("id, aguardando_humano")
    .eq("company_id", companyId)
    .eq("numero", numero)
    .maybeSingle();
  if (!card) {
    console.warn("[transferencia] contato sem card no CRM", companyId, numero);
    return;
  }

  const { error } = await admin
    .from("crm_cards")
    .update({
      aguardando_humano: true,
      // Mantém a hora da primeira transferência enquanto ninguém atender.
      ...(card.aguardando_humano ? {} : { aguardando_desde: new Date().toISOString() }),
      transferencia_motivo: motivo,
    })
    .eq("id", card.id);
  if (error) {
    console.error("[transferencia] falha ao marcar aguardando humano:", error.message);
    return;
  }

  await admin.from("lead_evento").insert({
    company_id: companyId,
    card_id: card.id,
    tipo: "transferencia",
    descricao: `Transferido para atendimento humano: ${motivo}`,
  });

  try {
    await atualizarFichaComIa({ admin, companyId, numero, motivo });
  } catch (e: any) {
    console.warn("[transferencia] ficha não atualizada:", e?.message);
  }
}
