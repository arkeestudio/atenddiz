-- Conversas dependem do Realtime pra atualizar sem F5, mas nenhuma migration
-- jamais adicionou `mensagens`/`contact_pause` à publicação supabase_realtime —
-- só crm_cards e crm_stage estavam lá. Sem estar na publicação o Postgres nem
-- emite o evento, então o REPLICA IDENTITY FULL de 20260709000004 não bastava:
-- a tela só atualizava no reload.
--
-- Idempotente de propósito: se a tabela já tiver sido adicionada pelo painel do
-- Supabase (fora do controle de versão), isto é um no-op.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mensagens'
  ) then
    alter publication supabase_realtime add table public.mensagens;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'contact_pause'
  ) then
    alter publication supabase_realtime add table public.contact_pause;
  end if;
end $$;

-- O canal escuta contact_pause com event:"*" e filtro por company_id; DELETE e
-- filtro por coluna fora da PK exigem a linha antiga completa no WAL.
alter table public.contact_pause replica identity full;
