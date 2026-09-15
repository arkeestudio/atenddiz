-- Ficha do atendimento: a IA registra no próprio sistema o que coletou na conversa
-- (em vez de encaminhar um resumo por WhatsApp) e marca o contato como aguardando humano.

-- Campos da ficha configuráveis por empresa (NULL = campos padrão definidos no código)
ALTER TABLE public.agent_config
  ADD COLUMN IF NOT EXISTS ficha_campos jsonb;

ALTER TABLE public.crm_cards
  ADD COLUMN IF NOT EXISTS ficha jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ficha_resumo text,
  ADD COLUMN IF NOT EXISTS ficha_proximo_passo text,
  ADD COLUMN IF NOT EXISTS ficha_atualizada_em timestamptz,
  ADD COLUMN IF NOT EXISTS aguardando_humano boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aguardando_desde timestamptz,
  ADD COLUMN IF NOT EXISTS transferencia_motivo text;

CREATE INDEX IF NOT EXISTS idx_crm_cards_aguardando_humano
  ON public.crm_cards (company_id)
  WHERE aguardando_humano;

NOTIFY pgrst, 'reload schema';
