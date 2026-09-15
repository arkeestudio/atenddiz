-- Campos usados pelo painel do Agente IA (aba Vendas e Regras) que faltavam no banco
ALTER TABLE public.agent_config
  ADD COLUMN IF NOT EXISTS chave_pix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS titular_pix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instrucoes_pagamento text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS base_conhecimento text NOT NULL DEFAULT '';

-- Recarrega o schema cache do PostgREST para as colunas ficarem visíveis na API
NOTIFY pgrst, 'reload schema';
