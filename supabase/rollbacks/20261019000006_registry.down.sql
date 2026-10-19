-- Reverte 20261019000006_registry.sql. Rodar ANTES do down de 20261019000005.
-- ATENÇÃO: apaga o log de consultas (registry_lookups) e os dados da Receita das organizações. Exporte antes.
begin;

-- Responsável publicável volta a não olhar a situação do CRECI.
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
                    where b.user_id = o.responsible_party_user_id and b.verification_status = 'approved') then
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

drop function if exists public.creci_lookup_url(text);
drop function if exists public.admin_broker_queue(boolean);
drop function if exists public.review_broker(uuid, boolean, text, public.creci_status, text);
-- review_broker da Fase 1 (idêntica à de 20261010000001_identity_orgs.sql).
create or replace function public.review_broker(
  p_user_id uuid, p_approve boolean, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.user_email(p_user_id);
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria verifica CRECI' using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'Rejeição exige motivo' using errcode = '22023';
  end if;

  update public.brokers
     set verification_status = case when p_approve then 'approved' else 'rejected' end::public.verification_status,
         rejection_reason = case when p_approve then null else trim(p_reason) end,
         verified_by = auth.uid(), verified_at = now()
   where user_id = p_user_id;
  if not found then
    raise exception 'Corretor não encontrado' using errcode = 'P0002';
  end if;

  if v_email is not null then
    perform public.enqueue_email(
      v_email, case when p_approve then 'creci_approved' else 'creci_rejected' end,
      case when p_approve then 'CRECI verificado' else 'CRECI não verificado' end,
      case when p_approve then 'Seu CRECI foi verificado. Você já pode cadastrar áreas.'
           else 'Seu CRECI não foi verificado. Motivo: ' || trim(p_reason) || '. Corrija e envie novamente.' end,
      jsonb_build_object('user_id', p_user_id, 'approved', p_approve));
  end if;
end;
$$;
grant execute on function public.review_broker(uuid, boolean, text) to authenticated;

create or replace function public.is_approved_broker()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_approved() and exists (
    select 1 from public.brokers b where b.user_id = auth.uid() and b.verification_status = 'approved');
$$;

create or replace function public.guard_broker_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_app_user_call() and not public.is_admin() then
    if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
      raise exception 'user_id do corretor não muda' using errcode = '42501';
    end if;
    new.verification_status := 'pending';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

drop function if exists public.name_match_score(text, text);
alter table public.brokers
  drop column creci_type, drop column creci_status, drop column verification_method, drop column source,
  drop column verified_name, drop column name_match_score, drop column brokerage_org_id, drop column next_review_at;
drop type if exists public.creci_type;
drop type if exists public.creci_status;

drop function if exists public.review_organization_registry(uuid, boolean, text);
drop function if exists public.create_my_organization(text, public.organization_type, text, text, text, uuid);
drop function if exists public.apply_organization_cnpj(uuid, text, uuid);
-- create_my_organization da Fase 1 (sem CNPJ consultado).
create or replace function public.create_my_organization(
  p_name text,
  p_type public.organization_type,
  p_document_id text default null,
  p_city text default null,
  p_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Login necessário' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nome da organização é obrigatório' using errcode = '22023';
  end if;
  -- Conta ainda não aprovada: no máximo uma organização (evita lixo antes da revisão).
  if not public.is_approved() and exists (
    select 1 from public.organization_members m where m.user_id = auth.uid()
  ) then
    raise exception 'Conta pendente já tem organização' using errcode = '42501';
  end if;

  insert into public.organizations (name, type, document_id, city, state, created_by)
  values (trim(p_name), p_type, nullif(trim(p_document_id), ''), nullif(trim(p_city), ''),
          nullif(trim(p_state), ''), auth.uid())
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (v_org, auth.uid(), 'admin', auth.uid());
  return v_org;
end;
$$;
revoke execute on function public.create_my_organization(text, public.organization_type, text, text, text) from public, anon;
grant execute on function public.create_my_organization(text, public.organization_type, text, text, text) to authenticated;
drop function if exists public.is_valid_cnpj(text);
create or replace function public.guard_organization_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_app_user_call() and not public.is_admin()
     and (new.active is distinct from old.active or new.created_by is distinct from old.created_by) then
    raise exception 'Somente a curadoria ativa/desativa organizações' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop index if exists public.organizations_cnpj_key;
alter table public.organizations
  drop column cnpj, drop column legal_name, drop column trade_name, drop column registry_status,
  drop column opened_at, drop column legal_nature, drop column cnae_main, drop column cnae_main_description,
  drop column cnae_secondary, drop column registry_address, drop column registry_source,
  drop column registry_verified_at, drop column registry_lookup_id, drop column cnae_warning,
  drop column verification_status, drop column verification_note;
drop type if exists public.org_verification;

delete from public.integration_settings where capability = 'cnpj';
alter table public.integration_settings drop constraint integration_settings_capability_check;
alter table public.integration_settings add constraint integration_settings_capability_check
  check (capability in ('email', 'messaging', 'agreement_signer', 'broker_verifier', 'map', 'billing'));
update public.integration_settings set provider = 'manual_queue', config = '{}' where capability = 'broker_verifier';
delete from public.platform_settings where key in ('cnpj_cache_days', 'registry_lookups_per_hour',
  'cnae_real_estate_prefixes', 'creci_lookup_urls', 'creci_review_months', 'creci_review_sla_days');

drop table if exists public.registry_lookups;
drop type if exists public.registry_result;
drop type if exists public.registry_kind;

commit;
