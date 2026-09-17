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
};

export const FICHA_CAMPOS_PADRAO: FichaCampo[] = [
  { id: "responsavel", label: "Nome do responsável", dica: "Mãe, pai ou quem está conversando" },
  { id: "crianca", label: "Nome da criança" },
  { id: "nascimento", label: "Data de nascimento", dica: "Só se a família disser. Ex: 03/2026" },
  { id: "idade", label: "Idade", dica: "Ex: 8 meses, 3 anos" },
  { id: "turma", label: "Turma de interesse", dica: "Berçário I, Berçário II ou Maternal" },
  { id: "turno", label: "Turno", dica: "Integral ou meio período (manhã/tarde)" },
  { id: "atipico", label: "Criança atípica", dica: "Só se a família mencionar. Anote o que ela contou" },
  { id: "visita", label: "Data da visita", dica: "Data e horário combinados, se houver" },
  { id: "inicio", label: "Início da adaptação", dica: "Quando pretende começar" },
  { id: "valor_combinado", label: "Valor combinado", somenteEquipe: true },
  { id: "data_pagamento", label: "Data de pagamento", somenteEquipe: true },
  { id: "como_conheceu", label: "Como conheceu" },
  { id: "duvidas", label: "Dúvidas e preocupações" },
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
    campos.push({ id, label, ...(dica ? { dica } : {}), ...(somenteEquipe ? { somenteEquipe } : {}) });
  }
  return campos;
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
