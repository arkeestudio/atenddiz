-- Nome e foto do contato vindos do WhatsApp.
-- nome_whatsapp guarda o nome do perfil do contato sem sobrescrever o nome editado pela equipe (crm_cards.nome).
ALTER TABLE public.crm_cards
  ADD COLUMN IF NOT EXISTS nome_whatsapp text,
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS foto_em timestamptz;

-- Correção: mensagens enviadas pelo celular gravavam o nome do PRÓPRIO número como nome do contato,
-- e isso renomeou cards. Recupera o nome real a partir da última mensagem recebida de cada contato.
UPDATE public.crm_cards c
SET nome = sub.nome, nome_whatsapp = sub.nome
FROM (
  SELECT DISTINCT ON (company_id, numero) company_id, numero, contato_nome AS nome
  FROM public.mensagens
  WHERE direcao = 'entrada' AND autor = 'contato' AND contato_nome IS NOT NULL AND btrim(contato_nome) <> ''
  ORDER BY company_id, numero, created_at DESC
) sub
WHERE c.company_id = sub.company_id
  AND c.numero = sub.numero
  AND c.nome IS DISTINCT FROM sub.nome;

NOTIFY pgrst, 'reload schema';
