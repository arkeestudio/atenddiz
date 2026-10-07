-- Reengajamento antes de a janela de 24h fechar: ~22h depois da última mensagem do cliente,
-- se ele ficou em silêncio após a nossa resposta, a IA pergunta se ficou alguma dúvida e
-- oferece ligação da equipe. Começa desligado: a empresa liga em Agente > Ajustes finos.
ALTER TABLE public.agent_config
  ADD COLUMN IF NOT EXISTS reengajamento_ativo boolean NOT NULL DEFAULT false;
