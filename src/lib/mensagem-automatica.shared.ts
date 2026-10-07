// Saudação e mensagem de ausência do WhatsApp Business: o celular responde sozinho, no mesmo
// segundo em que o cliente escreve, com o mesmo texto para todo mundo. Chega pelo webhook como
// mensagem "fromMe", igual à de um atendente — e era contada como resposta da equipe, o que
// calava a IA justo no primeiro contato de quem vinha do anúncio. O marcador separa as duas
// coisas sem mexer na coluna `autor`, que o banco restringe a ia/humano/contato.
export const MSG_AUTOMATICA = "⚙️ [AUTOMÁTICA]:";

export function ehMensagemAutomatica(texto: string | null | undefined): boolean {
  return typeof texto === "string" && texto.startsWith(MSG_AUTOMATICA);
}

/** Texto como o cliente viu, sem o marcador interno. */
export function semMarcadorAutomatica(texto: string): string {
  return ehMensagemAutomatica(texto) ? texto.slice(MSG_AUTOMATICA.length).trim() : texto;
}

export function comMarcadorAutomatica(texto: string): string {
  return ehMensagemAutomatica(texto) ? texto : `${MSG_AUTOMATICA} ${texto}`;
}
