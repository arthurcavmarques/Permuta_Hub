-- Reverte 20261010000002_distributions_append_only.sql. Rodar ANTES do down da 000001.
-- ATENÇÃO: apaga o registro de apresentações (distributions/distribution_events). Exporte antes
-- (ver docs/runbook.md). Uso: psql "$DB_URL" -f supabase/rollbacks/<arquivo>.down.sql
begin;

drop table if exists public.integration_settings;
drop function if exists public.has_valid_agreement(uuid);

-- Dossiê cego volta à regra da Fase 0 (só curadoria).
create or replace function public.can_view_blind(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin();
$$;

drop function if exists public.import_legacy_distributions();
drop view if exists public.distribution_status;

-- Triggers append-only impedem DROP? Não: DROP TABLE não dispara triggers de linha/TRUNCATE.
drop table if exists public.distribution_events;
drop table if exists public.distributions;
drop type if exists public.distribution_event_type;
drop type if exists public.distribution_source;

-- Organizações criadas só pelo legado (sem membros) ficam: são dados da rede, não do schema.

drop trigger if exists access_log_chain on public.access_log;
drop index if exists public.access_log_seq_idx;
alter table public.access_log drop column if exists seq, drop column if exists prev_hash, drop column if exists row_hash;

drop function if exists public.verify_hash_chain(text);
drop function if exists public.chain_hash();
drop function if exists public.chain_row_payload(jsonb);
drop function if exists public.is_admin_or_backend();

delete from supabase_migrations.schema_migrations where version = '20261010000002';
commit;
