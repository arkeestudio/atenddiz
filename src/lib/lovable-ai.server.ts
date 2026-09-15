// Multi-provider AI chat.
// Gemini (Google): usa GEMINI_API_KEY (chave própria) chamando o Google direto;
//   se não houver, cai no gateway do Lovable (só existe no ambiente Lovable).
// OpenAI e Anthropic usam a chave da própria empresa (agent_config).

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiProviderConfig {
  provider?: "gemini" | "openai" | "anthropic" | string;
  model?: string;
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function lovableAiChat(
  messages: ChatMsg[],
  modelOrConfig: string | AiProviderConfig = "google/gemini-2.5-flash-lite",
): Promise<string> {
  const cfg: AiProviderConfig =
    typeof modelOrConfig === "string"
      ? { provider: "gemini", model: modelOrConfig }
      : modelOrConfig;
  const provider = (cfg.provider || "gemini").toLowerCase();

  if (provider === "openai") {
    const key = cfg.openaiKey?.trim();
    if (!key) throw new Error("Chave OpenAI não configurada na sua empresa.");
    const model = cfg.model || "gpt-4o-mini";
    return openAiChat(key, model, messages);
  }
  if (provider === "anthropic") {
    const key = cfg.anthropicKey?.trim();
    if (!key) throw new Error("Chave Anthropic (Claude) não configurada na sua empresa.");
    const model = cfg.model || "claude-3-5-sonnet-latest";
    return anthropicChat(key, model, messages);
  }
  // default: Gemini (Google). Prioriza SUA chave direta; só cai no gateway do Lovable se não houver.
  const googleKey = cfg.geminiKey?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (googleKey) {
    const gModel = (cfg.model || "gemini-2.5-flash-lite").replace(/^google\//, "");
    return geminiChat(googleKey, gModel, messages);
  }

  // fallback: Gemini via Lovable Gateway
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    throw new Error(
      "IA do Google não configurada: defina GEMINI_API_KEY (sua chave do Google AI Studio) no ambiente.",
    );
  }
  const model = cfg.model || "google/gemini-2.5-flash-lite";
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente em alguns minutos.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
    throw new Error(`Lovable AI: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.toString().trim() || "";
}

export async function geminiTranscribeAudio(base64: string, mimetype?: string): Promise<string> {
  // Transcreve uma nota de voz do WhatsApp usando o Gemini (multimodal).
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || !base64) return "";
  const mime = (mimetype || "audio/ogg").split(";")[0].trim() || "audio/ogg";
  const body = {
    contents: [
      {
        parts: [
          { text: "Transcreva este áudio em português do Brasil. Responda APENAS com o texto falado, sem comentários nem aspas." },
          { inline_data: { mime_type: mime, data: base64 } },
        ],
      },
    ],
    // Transcrição não precisa de raciocínio: desligar o thinking reduz a latência.
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  };
  // A transcrição precisa sair na hora: cada tentativa tem timeout curto (a Google chega a segurar
  // 60s antes de devolver 503) e o lite vem primeiro por ser o mais rápido. A cota é por modelo,
  // então alternar também contorna um 429 momentâneo.
  const attempts = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const deadline = Date.now() + 40_000;
  for (let i = 0; i < attempts.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 1000) break;
    try {
      const res = await geminiFetch(key, attempts[i], body, AbortSignal.timeout(Math.min(15_000, remaining)));
      if (res.ok) return geminiText(await res.json());
      console.warn("[gemini.transcribe]", attempts[i], res.status, (await res.text().catch(() => "")).slice(0, 160));
      if (!GEMINI_RETRYABLE.has(res.status)) return "";
    } catch (e: any) {
      console.warn("[gemini.transcribe]", attempts[i], e?.name === "TimeoutError" ? "timeout" : e?.message);
    }
    if (i < attempts.length - 1) await sleep(400);
  }
  return "";
}

export interface ReceiptAnalysis {
  e_comprovante: boolean;
  tipo?: "pix" | "ted" | "doc" | "boleto" | "cartao" | "outro";
  valor?: number | null;
  data?: string | null;
  pagador?: string | null;
  destinatario?: string | null;
  banco?: string | null;
  autenticacao?: string | null;
  resumo?: string | null;
}

export async function geminiAnalyzeReceipt(base64: string, mimetype?: string): Promise<ReceiptAnalysis | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || !base64) return null;
  const mime = (mimetype || "image/jpeg").split(";")[0].trim() || "image/jpeg";
  const prompt = `Você é um auditor financeiro especialista em conferência de comprovantes bancários (PIX, TED, Boleto).
Analise com extrema precisão esta imagem para verificar se é um comprovante real de pagamento ou transferência bancária.
Responda ESTRITAMENTE em formato JSON (sem blocos markdown adicionais e sem texto explicativo):
{
  "e_comprovante": true,
  "tipo": "pix",
  "valor": 150.00,
  "data": "2026-09-07",
  "pagador": "Nome do Pagador",
  "destinatario": "Nome de quem recebeu",
  "banco": "Nome do Banco",
  "autenticacao": "Código de autenticação/transação",
  "resumo": "Comprovante PIX de R$ 150,00 pago em 07/09/2026"
}
Se NÃO for comprovante bancário de pagamento, retorne {"e_comprovante": false, "resumo": "Não é um comprovante de pagamento"}.`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data: base64 } },
        ],
      },
    ],
  };

  const attempts = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  for (let i = 0; i < attempts.length; i++) {
    try {
      const res = await geminiFetch(key, attempts[i], body);
      if (res.ok) {
        const raw = geminiText(await res.json());
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(cleaned);
        return parsed as ReceiptAnalysis;
      }
    } catch (e: any) {
      console.warn("[gemini.receipt]", e?.message);
    }
  }
  return null;
}

async function openAiChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.toString().trim() || "";
}

async function anthropicChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conv = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: conv }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const txt = (data?.content || [])
    .filter((p: any) => p?.type === "text")
    .map((p: any) => p.text)
    .join("\n")
    .trim();
  return txt;
}

// Erros transitórios da Google: sobrecarga (503), limite momentâneo (429) e falhas de gateway.
const GEMINI_RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function geminiFetch(key: string, model: string, body: any, signal?: AbortSignal) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal,
  });
}

function geminiText(data: any): string {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function geminiChat(key: string, model: string, messages: ChatMsg[]): Promise<string> {
  // Google Generative Language API (Gemini) — chamada direta com a chave do usuário.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const body = {
    ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
    contents,
  };

  // Tenta o modelo escolhido 2x; se seguir sobrecarregado, tenta o flash-lite
  // (fila de capacidade diferente) pra não deixar o cliente sem resposta.
  const fallback = /flash(?!-lite)/.test(model) ? "gemini-2.5-flash-lite" : null;
  const attempts = fallback ? [model, model, fallback] : [model, model];
  const waits = [500, 1200];

  let lastStatus = 0;
  let lastBody = "";
  for (let i = 0; i < attempts.length; i++) {
    const m = attempts[i];
    let res: Response;
    try {
      res = await geminiFetch(key, m, body);
    } catch (e: any) {
      lastBody = e?.message || "falha de rede";
      if (i < attempts.length - 1) await sleep(waits[i] ?? 1200);
      continue;
    }
    if (res.ok) {
      if (m !== model) console.warn(`[gemini] ${model} sobrecarregado — respondido com ${m}`);
      return geminiText(await res.json());
    }
    lastStatus = res.status;
    lastBody = (await res.text().catch(() => "")).slice(0, 200);
    // Erro definitivo (ex.: 401 chave inválida, 400 modelo inexistente): não adianta repetir.
    if (!GEMINI_RETRYABLE.has(res.status)) break;
    if (i < attempts.length - 1) await sleep(waits[i] ?? 1200);
  }

  if (lastStatus === 503 || lastStatus === 429) {
    throw new Error("A IA do Google está sobrecarregada no momento (erro temporário). Tente de novo em alguns segundos.");
  }
  throw new Error(`Google Gemini: ${lastStatus} ${lastBody}`);
}
