-- Hora em que a sessão do WhatsApp (re)conectou. Nos 15 minutos seguintes a IA atende só
-- primeiro contato: quem já tinha conversa pode ter sido atendido pelo celular durante a
-- queda, e responder por cima é pior do que esperar a equipe olhar.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS conectado_em timestamptz;
