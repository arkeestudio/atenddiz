-- Foto do produto: usada pelo painel (URL da foto) e pela IA ([ENVIAR_FOTO: url])
ALTER TABLE public.produto
  ADD COLUMN IF NOT EXISTS imagem_url text;

NOTIFY pgrst, 'reload schema';
