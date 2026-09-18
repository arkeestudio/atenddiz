-- Funil comercial: data de criação do lead, motivo de perda e origem retroativa.
--
-- `crm_cards` nunca teve `created_at`. Sem ela não dá para medir "leads recebidos por dia"
-- nem filtrar conversão/receita por período — e o endpoint público de contatos consultava
-- essa coluna inexistente, devolvendo lista vazia em silêncio.
--
-- `motivo_perda` é o dado que faltava para responder POR QUE a matrícula não aconteceu:
-- preço, concorrente, localização, falta de vaga. Sem ele, "perdido" é só um card parado.

ALTER TABLE public.crm_cards
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS motivo_perda text,
  ADD COLUMN IF NOT EXISTS motivo_perda_detalhe text,
  ADD COLUMN IF NOT EXISTS perdido_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_cards_created_at
  ON public.crm_cards (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_cards_motivo_perda
  ON public.crm_cards (company_id, motivo_perda)
  WHERE motivo_perda IS NOT NULL;

-- Cards antigos nasceram agora por causa do DEFAULT. Aproxima a data real pela primeira
-- mensagem trocada com aquele contato, que é o momento em que o lead de fato chegou.
UPDATE public.crm_cards c
SET created_at = sub.primeira
FROM (
  SELECT company_id, numero, min(created_at) AS primeira
  FROM public.mensagens
  GROUP BY company_id, numero
) sub
WHERE c.company_id = sub.company_id
  AND c.numero = sub.numero
  AND sub.primeira < c.created_at;

-- O UTM da primeira mensagem já era capturado, mas nunca chegava em `origem`.
UPDATE public.crm_cards
SET origem = utm_source
WHERE origem IS NULL
  AND utm_source IS NOT NULL
  AND btrim(utm_source) <> '';

NOTIFY pgrst, 'reload schema';
