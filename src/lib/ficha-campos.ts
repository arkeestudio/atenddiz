// Ficha do atendimento: campos que a IA coleta na conversa e a equipe vê/edita no painel.
// Client-safe (usado no prompt, no painel e no servidor).

export type FichaCampo = {
  id: string; // chave estável: o valor fica salvo em crm_cards.ficha[id]
  label: string;
  dica?: string; // orienta a IA sobre o que colocar
};

export const FICHA_CAMPOS_PADRAO: FichaCampo[] = [
  { id: "responsavel", label: "Nome do responsável", dica: "Mãe, pai ou quem está conversando" },
  { id: "crianca", label: "Nome da criança" },
  { id: "idade", label: "Idade / data de nascimento", dica: "Ex: 8 meses, nasceu em 03/2026" },
  { id: "turma", label: "Turma de interesse", dica: "Berçário I, Berçário II ou Maternal" },
  { id: "turno", label: "Turno", dica: "Integral ou meio período (manhã/tarde)" },
  { id: "inicio", label: "Quando pretende começar" },
  { id: "visita", label: "Visita", dica: "Se quer visitar, data e horário combinados" },
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
    campos.push({ id, label, ...(dica ? { dica } : {}) });
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
