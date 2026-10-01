-- Voz da IA: a resposta pode sair como nota de voz (Gemini TTS) em vez de texto.
-- 'nunca' = só texto (padrão, para não ligar áudio em quem não pediu)
-- 'sempre' = respostas curtas viram áudio; valor, data, link e endereço ficam em texto
-- 'quando_audio' = responde áudio com áudio
ALTER TABLE public.agent_config
  ADD COLUMN IF NOT EXISTS voz_resposta text NOT NULL DEFAULT 'nunca',
  ADD COLUMN IF NOT EXISTS voz_nome text NOT NULL DEFAULT 'Zephyr';
