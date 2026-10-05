// Ficha do atendimento: campos que a IA coleta na conversa e a equipe vê/edita no painel.
// Client-safe (usado no prompt, no painel e no servidor).

export type FichaCampo = {
  id: string; // chave estável: o valor fica salvo em crm_cards.ficha[id]
  label: string;
  dica?: string; // orienta a IA sobre o que colocar
  // Campo que só a equipe preenche. Valor negociado e data de pagamento são combinados
  // por uma pessoa: se a IA puder escrever aqui, ela inventa número — e número errado
  // sobre dinheiro, dito em nome da escola, é o pior tipo de erro.
  somenteEquipe?: boolean;
  // "opcoes": a IA escolhe UMA entre as opções e a equipe corrige num seletor. É o que
  // permite classificar sem texto livre — "Fundamental 1" nunca vira "fund. I" ou "1º ano".
  tipo?: "texto" | "opcoes";
  opcoes?: string[];
};

// Para que segmento é este lead. A IA preenche assim que sabe a idade/série e o sistema
// mostra na conversa, na lista, no Kanban e na planilha. O instituto é um; o atendimento
// precisa saber se está falando de berçário ou de fundamental.
// "Não identificado" existe para a conversa que termina antes de a IA descobrir a idade:
// sem essa opção o registro força uma classificação errada. A IA que responde NUNCA a
// escolhe (ela simplesmente não marca); quem fecha a conversa sem saber marca à mão.
export const SEGMENTO_NAO_IDENTIFICADO = "Não identificado";
export const SEGMENTO_PADRAO: FichaCampo = {
  id: "segmento",
  label: "Segmento",
  tipo: "opcoes",
  opcoes: ["Berçário", "Educação Infantil", "Fundamental 1", "Fundamental 2", SEGMENTO_NAO_IDENTIFICADO],
  dica: "Pela idade ou série da criança",
};

// Lista revisada com a escola (out/2026): entra o que a coordenação precisa receber antes
// da matrícula (necessidades específicas, unidade da visita, aceite de LGPD) e sai o que era
// resíduo de e-commerce (data de pagamento). A IA não negocia valor: o campo é "apresentado".
export const FICHA_CAMPOS_PADRAO: FichaCampo[] = [
  { id: "responsavel", label: "Nome do responsável", dica: "Mãe, pai ou quem está conversando" },
  { id: "crianca", label: "Nome da criança" },
  { id: "nascimento", label: "Data de nascimento", dica: "Só se a família disser. Ex: 03/2026" },
  { id: "idade", label: "Idade", dica: "Ex: 8 meses, 3 anos, 8 anos (3º ano)" },
  SEGMENTO_PADRAO,
  { id: "turma", label: "Turma de interesse", dica: "Berçário I, Berçário II, Maternal, Jardim ou a série do fundamental" },
  { id: "periodo", label: "Período ou horário desejado", dica: "Berçário e infantil: horário de entrada e saída. Fundamental: manhã ou tarde" },
  { id: "atipico", label: "Criança atípica", dica: "Só se a família mencionar. Anote o que ela contou" },
  { id: "necessidades", label: "Necessidades específicas", dica: "Alergia, restrição alimentar, medicamento, suporte de inclusão — só o que a família contar" },
  { id: "unidade_visita", label: "Unidade da visita", dica: "Qual unidade a família vai visitar" },
  { id: "visita", label: "Data e horário da visita", dica: "Combinados, se houver. Ex: 24/09 às 10h" },
  { id: "inicio", label: "Início da adaptação", dica: "Quando pretende começar" },
  { id: "valor_apresentado", label: "Valor apresentado", somenteEquipe: true },
  { id: "como_conheceu", label: "Como conheceu o Instituto" },
  { id: "duvidas", label: "Dúvidas e preocupações" },
  { id: "lgpd", label: "Aceite de LGPD", tipo: "opcoes", opcoes: ["Sim", "Não"], dica: "Sim quando a família autorizou o uso dos dados neste atendimento" },
];

export function normalizeFichaCampos(raw: unknown): FichaCampo[] {
  if (!Array.isArray(raw)) return FICHA_CAMPOS_PADRAO;
  const seen = new Set<string>();
  const campos: FichaCampo[] = [];
  for (const item of raw) {
    const label = String((item as any)?.label ?? "").trim();
    const id = String((item as any)?.id ?? "").trim() || slugCampo(label);
    if (!label || !id || seen.has(id)) continue;
    seen.add(id);
    const dica = String((item as any)?.dica ?? "").trim();
    const somenteEquipe = (item as any)?.somenteEquipe === true;
    const opcoes = Array.isArray((item as any)?.opcoes)
      ? Array.from(new Set(((item as any).opcoes as unknown[]).map((o) => String(o ?? "").trim()).filter(Boolean)))
      : [];
    campos.push({
      id,
      label,
      ...(dica ? { dica } : {}),
      ...(somenteEquipe ? { somenteEquipe } : {}),
      ...(opcoes.length ? { tipo: "opcoes" as const, opcoes } : {}),
    });
  }
  return campos;
}

/** O campo que classifica o lead por segmento, se a empresa tiver um (id "segmento" ou rótulo com "segmento"). */
export function campoSegmento(campos: FichaCampo[]): FichaCampo | null {
  return campos.find((c) => c.tipo === "opcoes" && c.opcoes?.length && (c.id === "segmento" || /segmento/i.test(c.label))) ?? null;
}

/** Valor do segmento gravado na ficha de um lead, sem precisar da configuração. */
export function valorSegmento(ficha: Record<string, string> | null | undefined): string | null {
  if (!ficha) return null;
  const direto = ficha.segmento?.trim();
  if (direto) return direto;
  const chave = Object.keys(ficha).find((k) => /segmento/i.test(k));
  return chave && ficha[chave]?.trim() ? ficha[chave].trim() : null;
}

/** Casa o que a IA escreveu com uma opção real (ignora caixa, aceita começo). Null se não bater. */
export function normalizarOpcao(valor: string, opcoes: string[]): string | null {
  const v = valor.trim().toLowerCase();
  if (!v) return null;
  return (
    opcoes.find((o) => o.toLowerCase() === v) ??
    opcoes.find((o) => o.toLowerCase().startsWith(v) || v.startsWith(o.toLowerCase())) ??
    null
  );
}

// Etiqueta curta e cor estável por segmento — a lista de conversas não tem espaço para
// "Educação Infantil" por extenso ao lado do nome.
export function abreviaSegmento(v: string): string {
  if (/ber[cç]/i.test(v)) return "Berç.";
  if (/infantil/i.test(v)) return "Ed. Inf.";
  if (/fund/i.test(v)) return v.replace(/fundamental/i, "Fund.").replace(/\s+/g, " ").trim();
  return v.length > 10 ? `${v.slice(0, 9)}…` : v;
}
export function estiloSegmento(v: string): string {
  if (/ber[cç]/i.test(v)) return "bg-pink-500/12 text-pink-700 dark:text-pink-300 border-pink-500/30";
  if (/infantil/i.test(v)) return "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (/fund.*1/i.test(v)) return "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30";
  if (/fund.*2/i.test(v)) return "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/30";
  return "bg-[color:var(--panel-2)] text-muted-foreground border-[color:var(--hairline)]";
}

export function slugCampo(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Id único para um campo novo (não reaproveita id de campo existente).
export function novoIdCampo(label: string, existentes: FichaCampo[]): string {
  const base = slugCampo(label) || "campo";
  const ids = new Set(existentes.map((c) => c.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
