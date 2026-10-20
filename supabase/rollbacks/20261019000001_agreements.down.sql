-- Reverte 20261019000001_agreements.sql.
-- ATENÇÃO: apaga os aceites (prova jurídica). Exporte antes (ver docs/runbook.md).
-- Uso: psql "$DB_URL" -f supabase/rollbacks/20261019000001_agreements.down.sql
begin;

-- Dado sensível volta à regra da Fase 1 (só curadoria).
create or replace function public.get_opportunity_sensitive(p_opportunity_id uuid)
returns table (registry_number text, exact_address text, owner_name text, owner_contacts jsonb, notes text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado ao dado sensível' using errcode = '42501';
  end if;
  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), 'read_sensitive', 'opportunity_sensitive', p_opportunity_id, p_opportunity_id,
          public.request_ip(), public.request_user_agent());
  return query
    select s.registry_number, s.exact_address, s.owner_name, s.owner_contacts, s.notes
    from public.opportunity_sensitive s where s.opportunity_id = p_opportunity_id;
end;
$$;

create or replace function public.has_valid_agreement(p_opportunity_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$ select false; $$;

create or replace function public.verify_hash_chain(p_table text)
returns table (broken_seq bigint, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_prev text := '';
begin
  if not public.is_admin_or_backend() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if p_table not in ('access_log', 'distributions', 'distribution_events') then
    raise exception 'Tabela sem cadeia de hashes: %', p_table using errcode = '22023';
  end if;
  for r in execute format('select seq, prev_hash, row_hash, to_jsonb(t) as j from public.%I t order by seq', p_table) loop
    if r.prev_hash is distinct from v_prev then
      return query select r.seq, 'prev_hash não confere (linha removida ou reordenada)'::text;
      return;
    end if;
    if r.row_hash is distinct from public.sha256_hex(r.prev_hash || public.chain_row_payload(r.j)) then
      return query select r.seq, 'conteúdo alterado'::text;
      return;
    end if;
    v_prev := r.row_hash;
  end loop;
end;
$$;

drop function if exists public.sensitive_access_state(uuid);
drop function if exists public.has_agreement(public.agreement_type, uuid);
drop function if exists public.revoke_agreement(uuid, text);
drop function if exists public.accept_agreement(public.agreement_type, uuid, text);
drop function if exists public.get_agreement_preview(public.agreement_type, uuid);
drop function if exists public.can_accept_agreement(public.agreement_type, uuid);
drop function if exists public.render_agreement(public.agreement_templates, uuid, uuid);
drop function if exists public.party_org_for(uuid, uuid);
drop function if exists public.publish_agreement_template(public.agreement_type, text, text, text, public.agreement_scope, integer);
drop view if exists public.valid_agreements;
drop table if exists public.agreement_revocations;
drop table if exists public.agreements;
drop table if exists public.agreement_templates;
drop function if exists public.guard_agreement_template_update();
delete from public.platform_settings where key in ('platform_legal_name', 'platform_document_id');
drop type if exists public.agreement_scope;
drop type if exists public.agreement_type;

commit;
