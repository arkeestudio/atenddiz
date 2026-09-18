// Motivos de perda de um lead. Lista fixa e curta de propósito: texto livre não vira
// relatório. Depois de alguns meses, é isto que responde se a escola perde matrícula
// por preço, por horário ou por falta de vaga — e cada resposta leva a uma decisão
// diferente da direção.
// Client-safe: usado no painel e no servidor.

export type MotivoPerda = {
  id: string;
  label: string;
  dica?: string;
};

export const MOTIVOS_PERDA: MotivoPerda[] = [
  { id: "preco", label: "Preço", dica: "Achou caro ou não coube no orçamento" },
  { id: "concorrente", label: "Concorrente", dica: "Escolheu outra escola" },
  { id: "localizacao", label: "Localização", dica: "Longe de casa ou do trabalho" },
  { id: "horario", label: "Horário", dica: "Nenhum período atende a rotina da família" },
  { id: "falta_de_vaga", label: "Falta de vaga", dica: "Não tínhamos vaga na turma" },
  { id: "estrutura", label: "Estrutura", dica: "Espaço físico não atendeu" },
  { id: "proposta_pedagogica", label: "Proposta pedagógica", dica: "Buscava outra linha de ensino" },
  { id: "nao_respondeu", label: "Não respondeu", dica: "Sumiu sem dar retorno" },
  { id: "adiou_decisao", label: "Adiou a decisão", dica: "Ficou para mais para frente" },
  { id: "desistiu", label: "Desistiu", dica: "Não vai mais matricular em lugar nenhum" },
  { id: "outro", label: "Outro", dica: "Descreva no campo ao lado" },
];

export function labelMotivoPerda(id: string | null | undefined): string {
  if (!id) return "Motivo não informado";
  return MOTIVOS_PERDA.find((m) => m.id === id)?.label ?? id;
}
