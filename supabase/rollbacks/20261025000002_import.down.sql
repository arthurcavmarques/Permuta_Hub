-- Reverte 20261025000002_import.sql (e o uso de 20261025000001_import_enums.sql).
-- ATENÇÃO: apaga lotes, itens, compradores importados e o estado da mesclagem. Exporte antes.
-- Os valores de enum 'unknown' (mandato) e 'imported' (histórico) NÃO são removidos (o Postgres não remove valor de
-- enum sem recriar o tipo); ficam sem uso: mandato 'unknown' vira 'none' e o publicável volta à regra da Fase 2.
begin;

revoke execute on function
  public.import_landbank(text, text, jsonb, jsonb, jsonb, boolean),
  public.import_buyers(text, text, jsonb, jsonb, jsonb, boolean),
  public.undo_import_batch(uuid, text)
from authenticated, service_role;

drop function public.admin_import_batches();
drop function public.admin_publishable_overview();
drop function public.resolve_import_conflict(uuid, text, boolean);
drop function public.admin_import_conflicts();
drop function public.undo_import_batch(uuid, text);
drop function public.import_buyers(text, text, jsonb, jsonb, jsonb, boolean);
drop function public.buyer_dedupe_key(text, text, text, text);
drop function public.import_landbank(text, text, jsonb, jsonb, jsonb, boolean);
drop function public.import_batch_undoable(uuid);
drop function public.import_value_hash(jsonb);
drop function public.import_blank(jsonb);
drop function public.verify_import_batch(uuid);
drop function public.import_items_hash(uuid);

-- Tabelas append-only: o trigger impede apagar linhas; DROP TABLE não passa por ele.
drop table public.opportunity_import_state;
drop table public.import_sensitive_snapshots;
drop table public.buyer_prospects;
drop table public.import_batch_items;
drop table public.import_batches;
drop table public.import_mappings;
drop type public.import_kind;

-- Verificação de cadeia sem os lotes
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
  if p_table not in ('access_log', 'distributions', 'distribution_events', 'agreements', 'agreement_revocations') then
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

-- Publicável da Fase 2 (sem tipo de ativo e sem mandato desconhecido)
create or replace function public.publish_blockers_of(o public.opportunities)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required jsonb := coalesce((select value from public.platform_settings where key = 'publishable_required_fields'), '[]');
  v_allow_no_mandate boolean := coalesce(public.setting_text('allow_distribution_without_mandate', 'false')::boolean, false);
begin
  if not (public.is_admin() or public.can_edit_opportunity(o.id)) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_required ? 'city' and coalesce(trim(o.city), '') = '' then return next 'missing_city'; end if;
  if v_required ? 'neighborhood' and coalesce(trim(o.neighborhood), '') = '' then return next 'missing_neighborhood'; end if;
  if v_required ? 'area_m2' and o.area_m2 is null then return next 'missing_area'; end if;
  if v_required ? 'zoning' and coalesce(trim(o.zoning), '') = '' then return next 'missing_zoning'; end if;
  if v_required ? 'coefficient' and o.coefficient is null then return next 'missing_coefficient'; end if;
  if v_required ? 'asking_value' and o.asking_value is null then return next 'missing_asking_value'; end if;
  if v_required ? 'negotiation_models' and cardinality(o.negotiation_models) = 0 then return next 'missing_models'; end if;
  if v_required ? 'geometry' and o.geometry is null then return next 'missing_geometry'; end if;
  if v_required ? 'blind_photo' and not exists (
       select 1 from public.opportunity_media m where m.opportunity_id = o.id and m.is_blind_safe) then
    return next 'missing_blind_photo';
  end if;
  if o.responsible_party_user_id is null and o.responsible_party_org_id is null then
    return next 'no_responsible';
  elsif o.responsible_party_user_id is not null and exists (
          select 1 from public.brokers b where b.user_id = o.responsible_party_user_id) then
    if not exists (select 1 from public.brokers b
                    where b.user_id = o.responsible_party_user_id and b.verification_status = 'approved'
                      and b.creci_status = 'active') then
      return next 'responsible_creci_not_verified';
    end if;
    if not exists (select 1 from public.valid_agreements a
                    where a.party_user_id = o.responsible_party_user_id and a.type = 'broker_area_authorization'
                      and a.opportunity_id = o.id) then
      return next 'no_area_term';
    end if;
  end if;
  if not exists (select 1 from public.opportunity_documents d
                  where d.opportunity_id = o.id and d.kind = 'owner_authorization' and d.review_status = 'accepted') then
    return next 'no_owner_authorization';
  end if;
  if not v_allow_no_mandate and o.mandate_status not in ('exclusive', 'non_exclusive') then
    return next 'no_mandate';
  end if;
end;
$$;

update public.opportunities set mandate_status = 'none' where mandate_status = 'unknown';

-- Tipo de ativo volta a ter padrão e a ser obrigatório
drop trigger opportunities_asset_type on public.opportunities;
drop function public.check_asset_type();
drop function public.is_valid_asset_type(text);
update public.opportunities set asset_type = 'terreno' where asset_type is null;
alter table public.opportunities alter column asset_type set default 'terreno', alter column asset_type set not null;
update public.platform_settings set value = value - 'asset_type' where key = 'publishable_required_fields';
delete from public.platform_settings where key = 'asset_types';

commit;
