-- Interruptor geral da IA e marca da última sincronização.
--
-- Até aqui não existia forma de desligar a IA: no instante em que um WhatsApp conectava,
-- ela já respondia quem escrevesse. Foi assim que a Lia atendeu 6 mensagens de 3 clientes
-- reais num número particular conectado por engano. `ia_ativa` é a trava que faltava.

ALTER TABLE public.agent_config
  ADD COLUMN IF NOT EXISTS ia_ativa boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ia_pausada_motivo text;

-- Guarda qual número está conectado para detectar troca de aparelho. Se o número mudar,
-- a IA é pausada sozinha e alguém precisa conferir antes de religar.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS ultimo_numero text,
  ADD COLUMN IF NOT EXISTS sincronizado_em timestamptz;

NOTIFY pgrst, 'reload schema';
