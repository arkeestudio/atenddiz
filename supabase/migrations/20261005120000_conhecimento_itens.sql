-- Informações avulsas para a IA, adicionadas pela equipe uma a uma (título + texto, com
-- quem/quando). Complementa a base de conhecimento em texto corrido: acrescentar "a visita
-- de novembro é só às terças" não pode exigir editar um textão inteiro.
ALTER TABLE public.agent_config
  ADD COLUMN IF NOT EXISTS conhecimento_itens jsonb NOT NULL DEFAULT '[]'::jsonb;
