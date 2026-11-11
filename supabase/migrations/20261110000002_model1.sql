-- Fase 3B — Modelo 1 (D030): acesso do comprador sem termo, declaração do corretor, lista de exclusão,
-- tipo de ativo urbana/rural + edificação, vocação, corretor publica sozinho, suspensão pela curadoria e
-- auto-aprovação dos matches.
-- Reverter: supabase/rollbacks/20261110000002_model1.down.sql

-- ---------------------------------------------------------------------------
-- Configurações (regra 5/10: tudo editável, o que é jurídico com padrão seguro)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, description) values
  ('buyer_sees_registry_and_address', 'false',
   'Comprador que recebeu a área vê matrícula e endereço exato (D030). Proprietário nunca. DEPENDE DO JURÍDICO.'),
  ('require_owner_authorization_file', 'true',
   'Além da declaração do corretor, exigir o anexo da autorização escrita do proprietário para publicar (L3). '
   || 'DEPENDE DO JURÍDICO.'),
  ('project_type_options',
   '[{"value": "mcmv", "label": "MCMV"},
     {"value": "loteamento_condominio_horizontal", "label": "Loteamento / condomínio horizontal"},
     {"value": "chacreamento", "label": "Chacreamento"},
     {"value": "loteamento_industrial", "label": "Loteamento industrial"},
     {"value": "vertical", "label": "Vertical"}]',
   'Vocação da área (tipos de projeto) oferecida no editor e nas teses (D030). O match compara estes valores.')
on conflict (key) do nothing;

-- Tipo de ativo do Modelo 1 (D030): urbana ou rural; galpão/edificação vira característica (has_building).
update public.platform_settings
   set value = '[{"value": "area_urbana", "label": "Área urbana"}, {"value": "area_rural", "label": "Área rural"}]',
       description = 'Tipos de ativo aceitos (D030): área urbana ou rural. "Galpão/edificação" é a característica '
                     || 'has_building. O match filtra por este campo.'
 where key = 'asset_types';

-- Campos mínimos revistos: foto qualquer (não há mais versão cega para o comprador) e vocação. Bairro e
-- zoneamento só se exigem de área urbana.
update public.platform_settings
   set value = '["city", "neighborhood", "area_m2", "asset_type", "zoning", "negotiation_models", "photo", "geometry", "project_types"]',
       description = 'Campos mínimos para publicar (D030/D032). Itens possíveis: city, neighborhood*, area_m2, '
                     || 'asset_type, zoning*, coefficient, negotiation_models, photo, geometry, asking_value, '
                     || 'project_types. (*) não se exigem de área rural.'
 where key = 'publishable_required_fields';

-- Distribuição automática (D030): aprova sozinho tudo que passa na nota mínima.
update public.platform_settings
   set value = jsonb_set(value, '{auto_approve_score}', coalesce(value -> 'min_score', '40'))
 where key = 'match_config';

-- ---------------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column has_building boolean not null default false,
  add column suspended_at timestamptz,
  add column suspended_reason text;

-- Corretor não muda status, responsável, mandato (só pela RPC da declaração), publicação nem suspensão.
create or replace function public.guard_opportunity_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.status <> 'captured' or new.published_at is not null or new.suspended_at is not null then
        raise exception 'Área nova entra como captada, sem publicação' using errcode = '42501';
      end if;
    elsif new.status is distinct from old.status
       or new.responsible_party_user_id is distinct from old.responsible_party_user_id
       or new.responsible_party_org_id is distinct from old.responsible_party_org_id
       or new.mandate_status is distinct from old.mandate_status
       or new.published_at is distinct from old.published_at
       or new.suspended_at is distinct from old.suspended_at
       or new.suspended_reason is distinct from old.suspended_reason
       or new.memorial_number is distinct from old.memorial_number then
      raise exception 'Somente a curadoria altera status, responsável, mandato, publicação, suspensão ou número do MD'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on column public.opportunities.has_building is 'Característica filtrável "galpão/edificação" (D030).';
comment on column public.opportunities.suspended_at is 'Suspensa pela curadoria: não publica nem dá match até ser reabilitada.';

alter table public.buyer_theses
  add column building_filter text not null default 'any' check (building_filter in ('any', 'only', 'exclude'));

comment on column public.buyer_theses.building_filter is
  'Galpão/edificação: any = indiferente, only = só com edificação, exclude = só sem edificação.';

-- ---------------------------------------------------------------------------
-- Migração dos tipos antigos (terreno, gleba, galpao, imovel_retrofit, outro → area_urbana; area_rural fica)
-- ---------------------------------------------------------------------------
update public.opportunities
   set has_building = (asset_type in ('galpao', 'imovel_retrofit')),
       asset_type = case when asset_type = 'area_rural' then 'area_rural' else 'area_urbana' end
 where asset_type is not null and asset_type not in ('area_urbana');

update public.buyer_theses
   set building_filter = case when asset_types <@ array['galpao', 'imovel_retrofit'] and cardinality(asset_types) > 0
                              then 'only' else building_filter end,
       asset_types = array(select distinct case when x = 'area_rural' then 'area_rural' else 'area_urbana' end
                             from unnest(asset_types) x)
 where cardinality(asset_types) > 0;

-- Vocação: texto livre antigo → valores da lista (o que não reconhece fica como está, para a curadoria rever).
create or replace function public.normalize_project_types(p text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v), '{}') from (
    select case
      when n ~ 'mcmv|minha casa' then 'mcmv'
      when n ~ 'chacr' then 'chacreamento'
      when n ~ 'industrial|logist|galpao' then 'loteamento_industrial'
      when n ~ 'lotea|condominio horizontal|horizontal' then 'loteamento_condominio_horizontal'
      when n ~ 'vertical|edificio|predio' then 'vertical'
      else x end as v
      from unnest(p) x, lateral (select public.norm_text(x) as n) nn
     where coalesce(trim(x), '') <> '') s;
$$;

update public.opportunities set project_types = public.normalize_project_types(project_types)
 where cardinality(project_types) > 0;
update public.buyer_theses set project_types = public.normalize_project_types(project_types)
 where cardinality(project_types) > 0;

update public.import_mappings
   set mapping = jsonb_set(mapping, '{asset_type_map}', coalesce(
         (select jsonb_object_agg(k, case when v = 'area_rural' then 'area_rural' else 'area_urbana' end)
            from jsonb_each_text(mapping -> 'asset_type_map') as e(k, v)), '{}'))
 where kind = 'landbank' and mapping ? 'asset_type_map';

-- ---------------------------------------------------------------------------
-- View do catálogo: mesma da Fase 3 + has_building no fim
-- ---------------------------------------------------------------------------
create or replace view public.opportunities_blind
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
  o.cash_share_pct,
  o.has_building
from public.opportunities o
where public.can_view_blind(o.id)
  and o.status <> 'archived';

-- ---------------------------------------------------------------------------
-- Regra 1 revisada (D030): quem recebeu a área vê o dossiê completo, nunca o proprietário
-- ---------------------------------------------------------------------------
-- Destinatário = conta aprovada que recebeu a área pela plataforma (ela ou a organização dela).
create or replace function public.is_recipient(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1 from public.distributions d
     where d.opportunity_id = p_opportunity_id and d.source = 'platform'
       and (d.recipient_user_id = auth.uid() or d.recipient_org_id in (select public.user_org_ids())));
$$;

-- allowed = tudo (curadoria e corretor responsável); limited = destinatário com matrícula/endereço liberados
-- pela configuração (sem proprietário); denied = o resto. 'needs_agreement' deixou de existir (sem termo do comprador).
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
    when public.is_recipient(p_opportunity_id)
         and coalesce(public.setting_text('buyer_sees_registry_and_address', 'false')::boolean, false) then 'limited'
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
declare
  v_state text := public.sensitive_access_state(p_opportunity_id);
begin
  if v_state not in ('allowed', 'limited') then
    raise exception 'Acesso negado ao dado sensível' using errcode = '42501';
  end if;

  -- Log ANTES de devolver (regra 1 / seção 9.4).
  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), case when v_state = 'limited' then 'read_sensitive_limited' else 'read_sensitive' end,
          'opportunity_sensitive', p_opportunity_id, p_opportunity_id,
          public.request_ip(), public.request_user_agent());

  -- Destinatário: proprietário, contatos e notas internas NUNCA saem do banco.
  return query
    select s.registry_number, s.exact_address,
           case when v_state = 'allowed' then s.owner_name end,
           case when v_state = 'allowed' then s.owner_contacts else '{}'::jsonb end,
           case when v_state = 'allowed' then s.notes end
    from public.opportunity_sensitive s
    where s.opportunity_id = p_opportunity_id;
end;
$$;

-- Polígono exato: também para quem recebeu (D030). Leitura do destinatário fica no access_log.
drop function public.get_opportunity_geometry(uuid);
create function public.get_opportunity_geometry(p_opportunity_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_editor boolean := public.is_admin() or (public.is_approved_broker() and exists (
    select 1 from public.opportunities o
     where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid()));
begin
  if not v_editor then
    if not public.is_recipient(p_opportunity_id) then
      raise exception 'Sem permissão' using errcode = '42501';
    end if;
    insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
    values (auth.uid(), 'read_geometry', 'opportunities', p_opportunity_id, p_opportunity_id,
            public.request_ip(), public.request_user_agent());
  end if;
  return (select extensions.st_asgeojson(o.geometry)::jsonb from public.opportunities o where o.id = p_opportunity_id);
end;
$$;
revoke execute on function public.get_opportunity_geometry(uuid) from public, anon;
grant execute on function public.get_opportunity_geometry(uuid) to authenticated;

-- Contato do corretor responsável, para quem recebeu a área (o comprador fala com o corretor, D030).
create or replace function public.get_opportunity_broker_contact(p_opportunity_id uuid)
returns table (full_name text, email text, phone text, creci text, organization_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_blind(p_opportunity_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
    select p.full_name, u.email::text, p.phone, b.creci_number || '-' || b.creci_state,
           (select org.name from public.organization_members m join public.organizations org on org.id = m.organization_id
             where m.user_id = o.responsible_party_user_id and org.type = 'brokerage'
             order by m.created_at limit 1)
      from public.opportunities o
      join public.profiles p on p.user_id = o.responsible_party_user_id
      join auth.users u on u.id = o.responsible_party_user_id
      left join public.brokers b on b.user_id = o.responsible_party_user_id
     where o.id = p_opportunity_id;
end;
$$;
revoke execute on function public.get_opportunity_broker_contact(uuid) from public, anon;
grant execute on function public.get_opportunity_broker_contact(uuid) to authenticated;

revoke execute on function public.is_recipient(uuid) from public, anon;
grant execute on function public.is_recipient(uuid) to authenticated;

-- Fotos: quem vê o dossiê vê todas (não há mais versão cega para o comprador). is_blind_safe passa a
-- significar "pode ir para material de divulgação" (resumo do e-mail, Fase 4).
drop policy opportunity_media_blind_select on public.opportunity_media;
create policy opportunity_media_viewer_select on public.opportunity_media for select to authenticated
  using (public.can_view_blind(opportunity_id));

drop policy opportunity_media_objects_select on storage.objects;
create policy opportunity_media_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'opportunity-media'
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.opportunity_media m
        where m.storage_path = storage.objects.name
          and public.can_view_blind(m.opportunity_id)
      )
    )
  );

-- Documentos: técnicos ("blind") com o dossiê; restritos só com acesso total, salvo a matrícula quando a
-- configuração libera. Autorização do proprietário, nunca.
drop policy opportunity_documents_recipient_select on public.opportunity_documents;
create policy opportunity_documents_recipient_select on public.opportunity_documents for select to authenticated
  using (kind <> 'owner_authorization' and (
    (sensitivity = 'blind' and public.can_view_blind(opportunity_id))
    or (sensitivity = 'restricted' and (
          public.sensitive_access_state(opportunity_id) = 'allowed'
       or (kind = 'registry' and public.sensitive_access_state(opportunity_id) = 'limited')))));

-- Termo do comprador desativado (D030). Aceites antigos ficam (append-only); nada novo pode ser aceito.
update public.agreement_templates set active = false where type = 'non_circumvention' and active;

-- Declaração de autorização (nova versão do termo por área). Aceites da versão anterior continuam valendo.
update public.agreement_templates set active = false where type = 'broker_area_authorization' and active;
insert into public.agreement_templates (type, version, title, scope, validity_months, active, body_markdown) values
  ('broker_area_authorization', '2026-11-v0.2', 'Declaração de autorização e divulgação da área', 'opportunity', null, true,
   E'[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]\n\n'
   'Eu, {{party_name}}, declaro, sob as penas da lei, que tenho autorização do proprietário da área {{memorial_number}} '
   'para oferecê-la, nos termos do mandato que informei, e autorizo {{platform_legal_name}} '
   '({{platform_document_id}}) a divulgá-la aos compradores cadastrados. Declaro também que a lista de empresas a quem '
   'já ofereci esta área está completa, e me comprometo a manter as informações atualizadas.');

-- ---------------------------------------------------------------------------
-- Lista de exclusão por área ("já ofereci a…"): empresas que não recebem a área
-- ---------------------------------------------------------------------------
create table public.opportunity_exclusions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  company_name text not null check (length(trim(company_name)) between 2 and 200),
  normalized_name text generated always as (lower(trim(regexp_replace(company_name, '\s+', ' ', 'g')))) stored,
  source text not null default 'broker' check (source in ('broker', 'curation')),
  note text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (opportunity_id, normalized_name)
);

create index opportunity_exclusions_org_idx on public.opportunity_exclusions (organization_id);

-- Liga o nome digitado à organização cadastrada com o mesmo nome (ou o contrário), e marca a origem.
create or replace function public.prepare_opportunity_exclusion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_org_name text;
begin
  if new.organization_id is not null then
    select o.name into new.company_name from public.organizations o where o.id = new.organization_id;
  else
    new.company_name := trim(regexp_replace(new.company_name, '\s+', ' ', 'g'));
    select o.id, o.name into v_org_id, v_org_name from public.organizations o
     where o.normalized_name = lower(new.company_name)
     order by o.created_at limit 1;
    if v_org_id is not null then
      new.organization_id := v_org_id;
      new.company_name := v_org_name;
    end if;
  end if;
  new.source := case when public.is_admin() then 'curation' else 'broker' end;
  return new;
end;
$$;

create trigger opportunity_exclusions_prepare before insert on public.opportunity_exclusions
  for each row execute function public.prepare_opportunity_exclusion();

create or replace function public.matches_on_exclusion_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_matches(coalesce(new.opportunity_id, old.opportunity_id), null);
  return null;
end;
$$;

create trigger opportunity_exclusions_recompute after insert or delete on public.opportunity_exclusions
  for each row execute function public.matches_on_exclusion_change();

alter table public.opportunity_exclusions enable row level security;
-- Curadoria e corretor responsável (sempre lê; escreve enquanto edita). O comprador nunca lê.
create policy opportunity_exclusions_select on public.opportunity_exclusions for select to authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.opportunities o
     where o.id = opportunity_exclusions.opportunity_id and o.responsible_party_user_id = (select auth.uid())));
create policy opportunity_exclusions_insert on public.opportunity_exclusions for insert to authenticated
  with check (public.can_edit_opportunity(opportunity_id));
create policy opportunity_exclusions_delete on public.opportunity_exclusions for delete to authenticated
  using (public.can_edit_opportunity(opportunity_id));
revoke all on public.opportunity_exclusions from anon;
revoke update, truncate on public.opportunity_exclusions from authenticated;

-- Excluída? Lista da área (por organização ou nome) ou apresentação legada (planilha) para a organização.
create or replace function public.is_excluded_org(p_opportunity_id uuid, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.opportunity_exclusions x
       where x.opportunity_id = p_opportunity_id
         and (x.organization_id = p_organization_id
              or x.normalized_name = (select o.normalized_name from public.organizations o where o.id = p_organization_id)))
    or exists (
      select 1 from public.distributions d
       where d.opportunity_id = p_opportunity_id and d.recipient_org_id = p_organization_id and d.source = 'legacy');
$$;

-- ---------------------------------------------------------------------------
-- Mandato declarado pelo corretor responsável (parte da declaração; antes só a curadoria mudava)
-- ---------------------------------------------------------------------------
create or replace function public.set_area_mandate(p_opportunity_id uuid, p_mandate public.mandate_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or (public.can_edit_opportunity(p_opportunity_id) and exists (
            select 1 from public.opportunities o
             where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid()))) then
    raise exception 'Sem permissão para editar esta área' using errcode = '42501';
  end if;
  if p_mandate = 'unknown' then
    raise exception 'Informe o mandato real' using errcode = '22023';
  end if;
  perform set_config('app.event_note', 'Mandato declarado pelo corretor', true);
  update public.opportunities set mandate_status = p_mandate where id = p_opportunity_id;
  perform set_config('app.event_note', '', true);
end;
$$;
revoke execute on function public.set_area_mandate(uuid, public.mandate_status) from public, anon;
grant execute on function public.set_area_mandate(uuid, public.mandate_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Travas de publicação (versão do Modelo 1). O núcleo não checa permissão: o match o chama de dentro de
-- triggers disparados por qualquer usuário. A versão pública continua checando.
-- ---------------------------------------------------------------------------
create or replace function public.publish_blockers_core(o public.opportunities)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required jsonb := coalesce((select value from public.platform_settings where key = 'publishable_required_fields'), '[]');
  v_allow_no_mandate boolean := coalesce(public.setting_text('allow_distribution_without_mandate', 'false')::boolean, false);
  v_require_file boolean := coalesce(public.setting_text('require_owner_authorization_file', 'true')::boolean, true);
  v_urban boolean := o.asset_type is distinct from 'area_rural';
begin
  if o.suspended_at is not null then return next 'suspended'; end if;
  if v_required ? 'city' and coalesce(trim(o.city), '') = '' then return next 'missing_city'; end if;
  if v_required ? 'neighborhood' and v_urban and coalesce(trim(o.neighborhood), '') = '' then
    return next 'missing_neighborhood';
  end if;
  if v_required ? 'area_m2' and o.area_m2 is null then return next 'missing_area'; end if;
  if v_required ? 'asset_type' and o.asset_type is null then return next 'missing_asset_type'; end if;
  if v_required ? 'zoning' and v_urban and coalesce(trim(o.zoning), '') = '' then return next 'missing_zoning'; end if;
  if v_required ? 'coefficient' and o.coefficient is null then return next 'missing_coefficient'; end if;
  if v_required ? 'asking_value' and o.asking_value is null then return next 'missing_asking_value'; end if;
  if v_required ? 'negotiation_models' and cardinality(o.negotiation_models) = 0 then return next 'missing_models'; end if;
  if v_required ? 'project_types' and cardinality(o.project_types) = 0 then return next 'missing_project_types'; end if;
  if v_required ? 'geometry' and o.geometry is null then return next 'missing_geometry'; end if;
  if v_required ? 'photo' and not exists (select 1 from public.opportunity_media m where m.opportunity_id = o.id) then
    return next 'missing_photo';
  end if;
  -- Compatibilidade: a configuração antiga ainda pode pedir foto da versão cega.
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
    -- A declaração de autorização do proprietário é o aceite por área (append-only).
    if not exists (select 1 from public.valid_agreements a
                    where a.party_user_id = o.responsible_party_user_id and a.type = 'broker_area_authorization'
                      and a.opportunity_id = o.id) then
      return next 'no_area_term';
    end if;
  end if;
  -- Anexo: basta estar enviado (sem curadoria prévia, D030); se a curadoria recusar, volta a travar.
  if v_require_file and not exists (
       select 1 from public.opportunity_documents d
        where d.opportunity_id = o.id and d.kind = 'owner_authorization' and d.review_status <> 'rejected') then
    return next 'no_owner_authorization';
  end if;
  if o.mandate_status = 'unknown' then
    return next 'mandate_unknown';
  elsif not v_allow_no_mandate and o.mandate_status not in ('exclusive', 'non_exclusive') then
    return next 'no_mandate';
  end if;
end;
$$;

create or replace function public.publish_blockers_of(o public.opportunities)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin_or_backend() or public.can_edit_opportunity(o.id)) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query select public.publish_blockers_core(o);
end;
$$;

revoke execute on function public.publish_blockers_core(public.opportunities) from public, anon, authenticated;
revoke execute on function public.is_excluded_org(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Corretor publica sozinho quando não há trava (D030); curadoria suspende e reabilita
-- ---------------------------------------------------------------------------
create or replace function public.publish_opportunity(p_opportunity_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers text[];
begin
  if not (public.is_admin() or (public.can_edit_opportunity(p_opportunity_id) and exists (
            select 1 from public.opportunities o
             where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid()))) then
    raise exception 'Somente o corretor responsável ou a curadoria publica' using errcode = '42501';
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

create or replace function public.suspend_opportunity(p_opportunity_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe o motivo da suspensão' using errcode = '22023';
  end if;
  insert into public.opportunity_events (opportunity_id, kind, note, actor_id)
  values (p_opportunity_id, 'suspended', trim(p_reason), auth.uid());
  -- Volta para qualificando: o corretor pode corrigir, mas só republica depois de reabilitada.
  perform set_config('app.event_note', 'Suspensa: ' || trim(p_reason), true);
  update public.opportunities
     set suspended_at = now(), suspended_reason = trim(p_reason), published_at = null,
         status = case when status in ('qualified', 'distributing') then 'qualifying' else status end
   where id = p_opportunity_id;
  if not found then
    raise exception 'Área não encontrada' using errcode = 'P0002';
  end if;
  perform set_config('app.event_note', '', true);
end;
$$;

create or replace function public.reinstate_opportunity(p_opportunity_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  update public.opportunities set suspended_at = null, suspended_reason = null
   where id = p_opportunity_id and suspended_at is not null;
  if not found then
    raise exception 'Área não está suspensa' using errcode = 'P0002';
  end if;
  insert into public.opportunity_events (opportunity_id, kind, note, actor_id)
  values (p_opportunity_id, 'reinstated', nullif(trim(p_note), ''), auth.uid());
end;
$$;

revoke execute on function public.suspend_opportunity(uuid, text), public.reinstate_opportunity(uuid, text)
  from public, anon;
grant execute on function public.suspend_opportunity(uuid, text), public.reinstate_opportunity(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Match: filtros novos (publicada e não suspensa, edificação, lista de exclusão) sobre a avaliação da Fase 3
-- ---------------------------------------------------------------------------
alter function public.match_evaluate(public.opportunities, public.buyer_theses) rename to match_evaluate_base;

create or replace function public.match_evaluate(o public.opportunities, t public.buyer_theses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb := public.match_evaluate_base(o, t);
  v_extra jsonb := '[]';
  v_fail boolean := false;
begin
  if o.published_at is null or o.suspended_at is not null then
    v_fail := true;
    v_extra := v_extra || jsonb_build_object('criterion', 'published', 'kind', 'hard', 'result', 'fail',
      'detail', case when o.suspended_at is not null then 'Área suspensa pela curadoria' else 'Área não publicada' end);
  end if;

  if public.is_excluded_org(o.id, t.organization_id) then
    v_fail := true;
    v_extra := v_extra || jsonb_build_object('criterion', 'exclusion', 'kind', 'hard', 'result', 'fail',
      'detail', 'Empresa já recebeu esta área por fora (lista de exclusão)');
  end if;

  if t.building_filter = 'only' and not o.has_building then
    v_fail := true;
    v_extra := v_extra || jsonb_build_object('criterion', 'building', 'kind', 'hard', 'result', 'fail',
      'detail', 'Tese pede galpão/edificação e a área não tem');
  elsif t.building_filter = 'exclude' and o.has_building then
    v_fail := true;
    v_extra := v_extra || jsonb_build_object('criterion', 'building', 'kind', 'hard', 'result', 'fail',
      'detail', 'Tese exclui áreas com galpão/edificação');
  elsif t.building_filter = 'only' then
    v_extra := v_extra || jsonb_build_object('criterion', 'building', 'kind', 'hard', 'result', 'pass',
      'detail', 'Compatível: área com galpão/edificação');
  end if;

  return jsonb_build_object(
    'passed', (v_base ->> 'passed')::boolean and not v_fail,
    'score', (v_base ->> 'score')::int,
    'reasons', v_extra || (v_base -> 'reasons'));
end;
$$;

revoke execute on function
  public.match_evaluate(public.opportunities, public.buyer_theses),
  public.match_evaluate_base(public.opportunities, public.buyer_theses),
  public.matches_on_exclusion_change(),
  public.prepare_opportunity_exclusion()
from public, anon, authenticated;

-- Auto-aprovação só para área sem trava de publicação (as legadas publicadas ficam para a curadoria).
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
  v_approve boolean;
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
      v_approve := v_auto is not null and v_score >= v_auto
                   and not exists (select 1 from public.publish_blockers_core(r.opp));
      insert into public.matches (opportunity_id, thesis_id, organization_id, score, reasons, status, decided_at, decision_note)
      values ((r.opp).id, (r.thesis).id, (r.thesis).organization_id, v_score, v_eval -> 'reasons',
              case when v_approve then 'approved' else 'suggested' end::public.match_status,
              case when v_approve then now() end,
              case when v_approve then 'Aprovado automaticamente (nota ≥ ' || v_auto || ')' end)
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

-- Recalcula tudo com as regras novas (tipos migrados, exclusões legadas, publicada).
select public.recompute_matches(null, null);
