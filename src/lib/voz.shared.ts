// Voz da IA: o que a tela do Agente e o servidor precisam saber em comum.

export type ModoVoz = "nunca" | "sempre" | "quando_audio";

export const MODOS_VOZ: Array<{ id: ModoVoz; rotulo: string; ajuda: string }> = [
  { id: "nunca", rotulo: "Desligado (só texto)", ajuda: "A IA responde sempre por escrito." },
  { id: "sempre", rotulo: "Sempre que der", ajuda: "Respostas curtas viram nota de voz. Valores, datas, endereço e links continuam em texto." },
  { id: "quando_audio", rotulo: "Só quando o cliente mandar áudio", ajuda: "Responde áudio com áudio e texto com texto." },
];

export const VOZ_PADRAO = "Zephyr";

// Vozes do Gemini TTS que soam bem em português do Brasil. A descrição é a do Google.
export const VOZES: Array<{ id: string; rotulo: string }> = [
  { id: "Zephyr", rotulo: "Zephyr — clara e animada" },
  { id: "Kore", rotulo: "Kore — firme" },
  { id: "Leda", rotulo: "Leda — jovem" },
  { id: "Aoede", rotulo: "Aoede — leve" },
  { id: "Despina", rotulo: "Despina — suave" },
  { id: "Sulafat", rotulo: "Sulafat — calorosa" },
  { id: "Achird", rotulo: "Achird — amigável (masculina)" },
  { id: "Puck", rotulo: "Puck — animada (masculina)" },
];
