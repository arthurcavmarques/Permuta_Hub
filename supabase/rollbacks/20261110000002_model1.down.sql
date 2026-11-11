-- Reverte 20261110000002_model1.sql (Fase 3B). Apaga a lista de exclusão; tipos de ativo NÃO voltam aos valores
-- antigos (galpão vira "terreno"; o resto, como estava antes da 2B): revise as áreas depois.
-- Os valores de enum de 20261110000001 ficam (Postgres não remove valor de enum).
drop trigger if exists opportunity_exclusions_recompute on public.opportunity_exclusions;
drop table if exists public.opportunity_exclusions;
drop function if exists public.matches_on_exclusion_change();
drop function if exists public.prepare_opportunity_exclusion();
drop function if exists public.is_excluded_org(uuid, uuid);
drop function if exists public.set_area_mandate(uuid, public.mandate_status);
drop function if exists public.suspend_opportunity(uuid, text);
drop function if exists public.reinstate_opportunity(uuid, text);
drop function if exists public.get_opportunity_broker_contact(uuid);
drop function if exists public.normalize_project_types(text[]);  -- vocações normalizadas ficam como estão

drop function if exists public.match_evaluate(public.opportunities, public.buyer_theses);
alter function public.match_evaluate_base(public.opportunities, public.buyer_theses) rename to match_evaluate;
revoke execute on function public.match_evaluate(public.opportunities, public.buyer_theses) from public, anon, authenticated;

-- Tipos de ativo e configurações
update public.platform_settings
   set value = '[{"value": "terreno", "label": "Terreno urbano"}, {"value": "gleba", "label": "Gleba"},
     {"value": "area_rural", "label": "Área rural"}, {"value": "galpao", "label": "Galpão / área industrial"},
     {"value": "imovel_retrofit", "label": "Imóvel para retrofit ou demolição"}, {"value": "outro", "label": "Outro"}]'
 where key = 'asset_types';
update public.opportunities
   set asset_type = case when has_building then 'galpao' else 'terreno' end
 where asset_type = 'area_urbana';
update public.buyer_theses
   set asset_types = array(select case when x = 'area_urbana' then (case when building_filter = 'only' then 'galpao' else 'terreno' end) else x end
                             from unnest(asset_types) x)
 where cardinality(asset_types) > 0;
update public.platform_settings
   set value = '["city", "neighborhood", "area_m2", "zoning", "negotiation_models", "blind_photo", "geometry", "asset_type"]'
 where key = 'publishable_required_fields';
update public.platform_settings set value = jsonb_set(value, '{auto_approve_score}', 'null') where key = 'match_config';
delete from public.platform_settings
 where key in ('buyer_sees_registry_and_address', 'require_owner_authorization_file', 'project_type_options');

-- Termos: reativa o do comprador e a versão anterior da autorização por área (a v0.2 fica inativa: é imutável).
update public.agreement_templates set active = false where type = 'broker_area_authorization' and active;
update public.agreement_templates set active = true where type = 'broker_area_authorization' and version = '2026-10-v0.1';
update public.agreement_templates set active = true where type = 'non_circumvention' and version = '2026-10-v0.1'
  and not exists (select 1 from public.agreement_templates t where t.type = 'non_circumvention' and t.active);

-- Políticas de mídia e documentos
drop policy if exists opportunity_media_viewer_select on public.opportunity_media;
create policy opportunity_media_blind_select on public.opportunity_media for select to authenticated
  using (is_blind_safe and public.can_view_blind(opportunity_id));
drop policy if exists opportunity_media_objects_select on storage.objects;
create policy opportunity_media_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'opportunity-media'
    and ((select public.is_admin())
      or exists (select 1 from public.opportunity_media m
                  where m.storage_path = storage.objects.name and m.is_blind_safe
                    and public.can_view_blind(m.opportunity_id))));
drop policy if exists opportunity_documents_recipient_select on public.opportunity_documents;
create policy opportunity_documents_recipient_select on public.opportunity_documents for select to authenticated
  using (kind <> 'owner_authorization' and (
    (sensitivity = 'blind' and public.can_view_blind(opportunity_id))
    or (sensitivity = 'restricted' and public.sensitive_access_state(opportunity_id) = 'allowed')));

-- Funções na versão anterior

-- Guard da escrita do corretor na versão da Fase 1
create or replace function public.guard_opportunity_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.status <> 'captured' or new.published_at is not null then
        raise exception 'Área nova entra como captada, sem publicação' using errcode = '42501';
      end if;
    elsif new.status is distinct from old.status
       or new.responsible_party_user_id is distinct from old.responsible_party_user_id
       or new.responsible_party_org_id is distinct from old.responsible_party_org_id
       or new.mandate_status is distinct from old.mandate_status
       or new.published_at is distinct from old.published_at
       or new.memorial_number is distinct from old.memorial_number then
      raise exception 'Somente a curadoria altera status, responsável, mandato ou número do MD' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.sensitive_access_state(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then 'allowed'
    when public.is_approved_broker() and exists (
           select 1 from public.opportunities o
            where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid()) then 'allowed'
    when public.can_accept_agreement('non_circumvention', p_opportunity_id) then
      case when public.has_valid_agreement(p_opportunity_id) then 'allowed' else 'needs_agreement' end
    else 'denied'
  end;
$$;

create or replace function public.get_opportunity_sensitive(p_opportunity_id uuid)
returns table (
  registry_number text,
  exact_address text,
  owner_name text,
  owner_contacts jsonb,
  notes text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.sensitive_access_state(p_opportunity_id) <> 'allowed' then
    raise exception 'Acesso negado ao dado sensível' using errcode = '42501';
  end if;

  -- Log ANTES de devolver (regra 1 / seção 9.4).
  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), 'read_sensitive', 'opportunity_sensitive', p_opportunity_id, p_opportunity_id,
          public.request_ip(), public.request_user_agent());

  return query
    select s.registry_number, s.exact_address, s.owner_name, s.owner_contacts, s.notes
    from public.opportunity_sensitive s
    where s.opportunity_id = p_opportunity_id;
end;
$$;

drop function if exists public.get_opportunity_geometry(uuid);
create function public.get_opportunity_geometry(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or exists (
      select 1 from public.opportunities o
       where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid() and public.is_approved_broker())) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return (select extensions.st_asgeojson(o.geometry)::jsonb from public.opportunities o where o.id = p_opportunity_id);
end;
$$;
revoke execute on function public.get_opportunity_geometry(uuid) from public, anon;
grant execute on function public.get_opportunity_geometry(uuid) to authenticated;

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
  if not (public.is_admin_or_backend() or public.can_edit_opportunity(o.id)) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_required ? 'city' and coalesce(trim(o.city), '') = '' then return next 'missing_city'; end if;
  if v_required ? 'neighborhood' and coalesce(trim(o.neighborhood), '') = '' then return next 'missing_neighborhood'; end if;
  if v_required ? 'area_m2' and o.area_m2 is null then return next 'missing_area'; end if;
  if v_required ? 'asset_type' and o.asset_type is null then return next 'missing_asset_type'; end if;
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
  if o.mandate_status = 'unknown' then
    return next 'mandate_unknown';
  elsif not v_allow_no_mandate and o.mandate_status not in ('exclusive', 'non_exclusive') then
    return next 'no_mandate';
  end if;
end;
$$;

drop function if exists public.publish_blockers_core(public.opportunities);
drop function if exists public.is_recipient(uuid);

create or replace function public.publish_opportunity(p_opportunity_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers text[];
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria publica' using errcode = '42501';
  end if;
  v_blockers := array(select public.opportunity_publish_blockers(p_opportunity_id));
  if cardinality(v_blockers) > 0 then
    raise exception 'Área ainda não publicável: %', array_to_string(v_blockers, ', ')
      using errcode = '23514', hint = array_to_string(v_blockers, ',');
  end if;
  perform set_config('app.event_note', coalesce(p_note, ''), true);
  update public.opportunities
     set status = case when status in ('captured', 'qualifying') then 'qualified' else status end,
         published_at = coalesce(published_at, now())
   where id = p_opportunity_id;
end;
$$;

create or replace function public.recompute_matches(p_opportunity_id uuid default null, p_thesis_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce((select value from public.platform_settings where key = 'match_config'), '{}');
  v_min int := coalesce((v_cfg ->> 'min_score')::int, 0);
  v_auto int := (v_cfg ->> 'auto_approve_score')::int;
  v_count int := 0;
  r record;
  v_eval jsonb;
  v_score int;
begin
  for r in
    select o as opp, t as thesis
      from public.opportunities o
      cross join public.buyer_theses t
      join public.organizations org on org.id = t.organization_id
     where (p_opportunity_id is null or o.id = p_opportunity_id)
       and (p_thesis_id is null or t.id = p_thesis_id)
       and org.active
       and (o.status in ('qualified', 'distributing')
            or exists (select 1 from public.matches m where m.opportunity_id = o.id and m.thesis_id = t.id))
  loop
    v_eval := public.match_evaluate(r.opp, r.thesis);
    v_score := (v_eval ->> 'score')::int;
    if (v_eval ->> 'passed')::boolean and v_score >= v_min then
      insert into public.matches (opportunity_id, thesis_id, organization_id, score, reasons, status, decided_at, decision_note)
      values ((r.opp).id, (r.thesis).id, (r.thesis).organization_id, v_score, v_eval -> 'reasons',
              case when v_auto is not null and v_score >= v_auto then 'approved' else 'suggested' end::public.match_status,
              case when v_auto is not null and v_score >= v_auto then now() end,
              case when v_auto is not null and v_score >= v_auto then 'Aprovado automaticamente (nota ≥ ' || v_auto || ')' end)
      on conflict (opportunity_id, thesis_id) do update
        set score = excluded.score, reasons = excluded.reasons, still_matches = true, computed_at = now(),
            status = case when public.matches.status = 'suggested' and excluded.status = 'approved'
                          then 'approved'::public.match_status else public.matches.status end,
            decided_at = case when public.matches.status = 'suggested' and excluded.status = 'approved'
                              then now() else public.matches.decided_at end,
            decision_note = case when public.matches.status = 'suggested' and excluded.status = 'approved'
                                 then excluded.decision_note else public.matches.decision_note end;
      v_count := v_count + 1;
    else
      delete from public.matches
       where opportunity_id = (r.opp).id and thesis_id = (r.thesis).id and status = 'suggested';
      update public.matches set still_matches = false, reasons = v_eval -> 'reasons', computed_at = now()
       where opportunity_id = (r.opp).id and thesis_id = (r.thesis).id and still_matches;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.recompute_matches(uuid, uuid) from public, anon, authenticated;

-- View volta à definição da Fase 3 (sem has_building): drop, porque remove coluna.
drop view public.opportunities_blind;
create view public.opportunities_blind
with (security_barrier = true)
as
select
  o.id,
  o.memorial_number,
  coalesce(
    o.title_blind,
    'Área de ' || replace(to_char(public.round_area(o.area_m2), 'FM999,999,999'), ',', '.') || ' m²'
      || coalesce(' – ' || case when public.setting_text('blind_location_level', 'neighborhood') = 'neighborhood'
                                then o.neighborhood || ', ' || o.city else o.city end, '')
  ) as title,
  o.asset_type,
  o.status,
  o.land_type,
  public.round_area(o.area_m2) as area_m2_approx,
  o.city,
  case when public.setting_text('blind_location_level', 'neighborhood') = 'neighborhood'
       then o.neighborhood end as neighborhood,
  o.state,
  o.region_tags,
  o.zoning,
  o.master_plan_notes,
  o.buildable_potential_notes,
  o.coefficient,
  o.project_types,
  o.negotiation_conditions,
  o.asking_value,
  o.negotiation_models,
  o.mandate_status,
  extensions.st_x(public.blind_center(o.id, o.geometry)) as approx_lng,
  extensions.st_y(public.blind_center(o.id, o.geometry)) as approx_lat,
  public.setting_numeric('blind_map_radius_m', 500) as approx_radius_m,
  o.published_at,
  o.updated_at,
  o.estimated_units,
  o.cash_share_pct
from public.opportunities o
where public.can_view_blind(o.id)
  and o.status <> 'archived';
grant select on public.opportunities_blind to authenticated;
revoke all on public.opportunities_blind from anon;

alter table public.buyer_theses drop column if exists building_filter;
alter table public.opportunities
  drop column if exists has_building,
  drop column if exists suspended_at,
  drop column if exists suspended_reason;

select public.recompute_matches(null, null);
