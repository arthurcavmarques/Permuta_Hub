-- Fase 2 · Bloco 2.4 — Curadoria: fila de leads, conversão em oportunidade, histórico da área
-- (opportunity_events), responsável/mandato, checagem "publicável" (regra 4) e leitura dos logs de acesso.
-- Reverter: supabase/rollbacks/20261019000005_curation.down.sql

-- ---------------------------------------------------------------------------
-- Histórico da oportunidade (append-only): toda mudança com autor e nota
-- ---------------------------------------------------------------------------
create type public.opportunity_event_kind as enum
  ('created', 'status', 'mandate', 'responsible', 'published', 'unpublished', 'note');

create table public.opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  kind public.opportunity_event_kind not null,
  from_value text,
  to_value text,
  note text,
  actor_id uuid references auth.users (id),
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index opportunity_events_opp_idx on public.opportunity_events (opportunity_id, at desc);

create trigger opportunity_events_append_only before update or delete on public.opportunity_events
  for each row execute function public.reject_mutation();
create trigger opportunity_events_no_truncate before truncate on public.opportunity_events
  for each statement execute function public.reject_mutation();

-- Nota opcional da mudança: a RPC que altera grava em app.event_note; o trigger usa e limpa.
create or replace function public.log_opportunity_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(current_setting('app.event_note', true), '');
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.opportunity_events (opportunity_id, kind, to_value, note, actor_id)
    values (new.id, 'created', new.status::text, v_note, v_actor);
  else
    if new.status is distinct from old.status then
      insert into public.opportunity_events (opportunity_id, kind, from_value, to_value, note, actor_id)
      values (new.id, 'status', old.status::text, new.status::text, v_note, v_actor);
    end if;
    if new.mandate_status is distinct from old.mandate_status then
      insert into public.opportunity_events (opportunity_id, kind, from_value, to_value, note, actor_id)
      values (new.id, 'mandate', old.mandate_status::text, new.mandate_status::text, v_note, v_actor);
    end if;
    if new.responsible_party_user_id is distinct from old.responsible_party_user_id
       or new.responsible_party_org_id is distinct from old.responsible_party_org_id then
      insert into public.opportunity_events (opportunity_id, kind, from_value, to_value, note, actor_id)
      values (new.id, 'responsible', old.responsible_party_user_id::text, new.responsible_party_user_id::text,
              v_note, v_actor);
    end if;
    if (new.published_at is null) is distinct from (old.published_at is null) then
      insert into public.opportunity_events (opportunity_id, kind, note, actor_id)
      values (new.id, case when new.published_at is null then 'unpublished' else 'published' end::public.opportunity_event_kind,
              v_note, v_actor);
    end if;
  end if;
  perform set_config('app.event_note', '', true);
  return new;
end;
$$;

create trigger opportunities_events after insert or update on public.opportunities
  for each row execute function public.log_opportunity_changes();

-- ---------------------------------------------------------------------------
-- "Publicável": o que falta para a área poder ser publicada/distribuída
-- ---------------------------------------------------------------------------
-- Campos mínimos são configuráveis (DEPENDE DO FÁBIO, pergunta 4): mudar a lista não exige deploy.
insert into public.platform_settings (key, value, description) values
  ('publishable_required_fields',
   '["city", "neighborhood", "area_m2", "zoning", "negotiation_models", "blind_photo", "geometry"]',
   'Campos mínimos para publicar (proposta; DEPENDE DO FÁBIO). Itens possíveis: city, neighborhood, area_m2, zoning, coefficient, negotiation_models, blind_photo, geometry, asking_value.');

-- Códigos (a tela traduz). Vazio = publicável. Recebe a LINHA (o trigger passa a versão nova, antes de gravar);
-- de tabelas lê só fotos, documentos, corretor e aceites.
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
  -- Chamada pelo trigger de publicação (como o usuário do app): só quem pode mexer na área.
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

  -- Regra 3: toda área tem responsável. Área de proprietário fica "aguardando corretor responsável".
  if o.responsible_party_user_id is null and o.responsible_party_org_id is null then
    return next 'no_responsible';
  elsif o.responsible_party_user_id is not null and exists (
          select 1 from public.brokers b where b.user_id = o.responsible_party_user_id) then
    if not exists (select 1 from public.brokers b
                    where b.user_id = o.responsible_party_user_id and b.verification_status = 'approved') then
      return next 'responsible_creci_not_verified';
    end if;
    -- Aceite de 1 clique do corretor para esta área.
    if not exists (select 1 from public.valid_agreements a
                    where a.party_user_id = o.responsible_party_user_id and a.type = 'broker_area_authorization'
                      and a.opportunity_id = o.id) then
      return next 'no_area_term';
    end if;
  end if;

  -- Autorização do proprietário conferida (D021: trava somada ao mandato).
  if not exists (select 1 from public.opportunity_documents d
                  where d.opportunity_id = o.id and d.kind = 'owner_authorization' and d.review_status = 'accepted') then
    return next 'no_owner_authorization';
  end if;

  -- Regra 4: mandato. Padrão: só exclusivo/não exclusivo. "Em obtenção" também não publica (pergunta 2 ao Fábio).
  if not v_allow_no_mandate and o.mandate_status not in ('exclusive', 'non_exclusive') then
    return next 'no_mandate';
  end if;
end;
$$;

create or replace function public.opportunity_publish_blockers(p_opportunity_id uuid)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.opportunities;
begin
  if not (public.is_admin() or public.can_edit_opportunity(p_opportunity_id)) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select * into o from public.opportunities where id = p_opportunity_id;
  if found then
    return query select public.publish_blockers_of(o);
  end if;
end;
$$;

-- Trava na API: pelo app, a área só entra em qualificada/distribuição/negociação ou ganha published_at sem pendências.
create or replace function public.guard_opportunity_publish()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_blockers text[];
begin
  if not public.is_app_user_call() then
    return new;
  end if;
  if (new.status in ('qualified', 'distributing', 'negotiating') and old.status in ('captured', 'qualifying'))
     or (new.published_at is not null and old.published_at is null) then
    -- Checa a linha já com a mudança (o mandato pode estar mudando junto).
    v_blockers := array(select public.publish_blockers_of(new));
    if cardinality(v_blockers) > 0 then
      raise exception 'Área ainda não publicável: %', array_to_string(v_blockers, ', ')
        using errcode = '23514', hint = array_to_string(v_blockers, ',');
    end if;
  end if;
  -- Responsável de usuário precisa ser corretor aprovado.
  if new.responsible_party_user_id is distinct from old.responsible_party_user_id
     and new.responsible_party_user_id is not null
     and not exists (select 1 from public.brokers b
                      where b.user_id = new.responsible_party_user_id and b.verification_status = 'approved') then
    raise exception 'Responsável precisa ser corretor com CRECI verificado' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger opportunities_publish_guard before update on public.opportunities
  for each row execute function public.guard_opportunity_publish();

-- Publicar = qualificada + published_at, com nota. Despublicar = volta para qualificando.
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

-- Mudanças da curadoria com nota (status, mandato, responsável) numa só chamada.
create or replace function public.curate_opportunity(
  p_opportunity_id uuid,
  p_status public.opportunity_status default null,
  p_mandate public.mandate_status default null,
  p_responsible_user_id uuid default null,
  p_clear_responsible boolean default false,
  p_unpublish boolean default false,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  perform set_config('app.event_note', coalesce(p_note, ''), true);
  -- Roda como dono: o guard de publicação só vale para o app, então reaplicamos a regra aqui.
  if p_status in ('qualified', 'distributing', 'negotiating') and exists (
       select 1 from public.opportunities where id = p_opportunity_id and status in ('captured', 'qualifying')) then
    raise exception 'Use "Publicar" para qualificar a área' using errcode = '22023';
  end if;
  if p_responsible_user_id is not null and not exists (
       select 1 from public.brokers b where b.user_id = p_responsible_user_id and b.verification_status = 'approved') then
    raise exception 'Responsável precisa ser corretor com CRECI verificado' using errcode = '23514';
  end if;
  update public.opportunities
     set status = coalesce(p_status, status),
         mandate_status = coalesce(p_mandate, mandate_status),
         responsible_party_user_id = case when p_clear_responsible then null
                                          else coalesce(p_responsible_user_id, responsible_party_user_id) end,
         published_at = case when p_unpublish then null else published_at end
   where id = p_opportunity_id;
  if not found then
    raise exception 'Área não encontrada' using errcode = 'P0002';
  end if;
  perform set_config('app.event_note', '', true);
end;
$$;

create or replace function public.add_opportunity_note(p_opportunity_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Nota vazia' using errcode = '22023';
  end if;
  insert into public.opportunity_events (opportunity_id, kind, note, actor_id)
  values (p_opportunity_id, 'note', trim(p_note), auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Fila de leads
-- ---------------------------------------------------------------------------
create or replace function public.curate_lead(
  p_lead_id uuid,
  p_status public.lead_status,
  p_note text default null,
  p_assign_to uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.owner_leads;
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if p_status = 'converted' then
    raise exception 'Use "Converter em oportunidade"' using errcode = '22023';
  end if;
  if p_status = 'discarded' and coalesce(trim(p_note), '') = '' then
    raise exception 'Descartar exige motivo' using errcode = '22023';
  end if;
  if p_status = 'forwarded' and (p_assign_to is null or not exists (
       select 1 from public.brokers b where b.user_id = p_assign_to and b.verification_status = 'approved')) then
    raise exception 'Encaminhe a um corretor com CRECI verificado' using errcode = '23514';
  end if;
  update public.owner_leads
     set status = p_status, status_note = nullif(trim(p_note), ''),
         assigned_to = case when p_status = 'forwarded' then p_assign_to else assigned_to end
   where id = p_lead_id and status <> 'converted'
  returning * into v_lead;
  if not found then
    raise exception 'Lead não encontrado ou já convertido' using errcode = 'P0002';
  end if;

  if p_status = 'forwarded' then
    v_email := public.user_email(p_assign_to);
    if v_email is not null then
      perform public.enqueue_email(v_email, 'lead_forwarded', 'Nova área para você atender',
        'A curadoria encaminhou uma área em ' || v_lead.city || coalesce(' (' || v_lead.neighborhood || ')', '')
        || ' para você. Veja em ' || coalesce(public.setting_text_or_null('app_base_url'), '') || '/areas/leads',
        jsonb_build_object('lead_id', v_lead.id));
    end if;
  elsif p_status = 'qualifying' and nullif(trim(p_note), '') is not null and v_lead.email is not null then
    -- "Pedir dados": a nota vai para quem ofereceu a área.
    perform public.enqueue_email(v_lead.email, 'lead_request_info', 'Sobre a área que você ofereceu',
      'Olá, ' || v_lead.name || '. Para seguirmos com a área em ' || v_lead.city || ', precisamos de: ' || trim(p_note),
      jsonb_build_object('lead_id', v_lead.id));
  end if;
end;
$$;

-- Converte o lead numa oportunidade "captada", pré-preenchendo o MD. Contato do proprietário vai para o
-- dado sensível (nunca para a tabela pública). Responsável = corretor que recebeu o lead, se houver.
create or replace function public.convert_lead(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.owner_leads;
  v_opp uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  select * into v_lead from public.owner_leads where id = p_lead_id for update;
  if not found or v_lead.status = 'converted' then
    raise exception 'Lead não encontrado ou já convertido' using errcode = 'P0002';
  end if;

  perform set_config('app.event_note', 'Convertida do lead de captação', true);
  insert into public.opportunities
    (city, neighborhood, state, area_m2, negotiation_models, negotiation_conditions, origin_lead_id,
     responsible_party_user_id, status)
  values
    (v_lead.city, v_lead.neighborhood, v_lead.state, v_lead.approx_area_m2, v_lead.negotiation_models,
     null, v_lead.id,
     case when exists (select 1 from public.brokers b
                        where b.user_id = v_lead.assigned_to and b.verification_status = 'approved')
          then v_lead.assigned_to end,
     'qualifying')
  returning id into v_opp;

  insert into public.opportunity_sensitive (opportunity_id, exact_address, owner_name, owner_contacts, notes)
  values (v_opp, v_lead.location_text,
          case when v_lead.respondent_relation = 'owner' then v_lead.name end,
          jsonb_strip_nulls(jsonb_build_object('phone', v_lead.phone, 'email', v_lead.email)),
          'Lead: ' || v_lead.respondent_relation::text || ' — ' || v_lead.name
            || coalesce(E'\n' || v_lead.notes, ''));

  update public.owner_leads set status = 'converted', converted_opportunity_id = v_opp where id = v_lead.id;
  return v_opp;
end;
$$;

-- Corretores aptos a receber leads/áreas (para os seletores da curadoria).
create or replace function public.admin_list_brokers()
returns table (user_id uuid, full_name text, email text, creci_number text, creci_state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  return query
    select b.user_id, p.full_name, u.email::text, b.creci_number, b.creci_state
      from public.brokers b
      join public.profiles p on p.user_id = b.user_id and p.account_status = 'approved'
      join auth.users u on u.id = b.user_id
     where b.verification_status = 'approved'
     order by p.full_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Logs de acesso (curadoria): com nome/e-mail do ator e número do MD
-- ---------------------------------------------------------------------------
create or replace function public.admin_access_log(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_action text default null,
  p_memorial text default null,
  p_limit integer default 500
)
returns table (
  seq bigint, at timestamptz, action text, actor_name text, actor_email text,
  resource_type text, memorial_number text, ip text, user_agent text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  return query
    select a.seq, a.at, a.action, p.full_name, u.email::text, a.resource_type, o.memorial_number, a.ip, a.user_agent
      from public.access_log a
      left join public.profiles p on p.user_id = a.actor_id
      left join auth.users u on u.id = a.actor_id
      left join public.opportunities o on o.id = a.opportunity_id
     where (p_from is null or a.at >= p_from)
       and (p_to is null or a.at < p_to)
       and (p_action is null or a.action = p_action)
       and (p_memorial is null or o.memorial_number ilike '%' || p_memorial || '%')
     order by a.seq desc
     limit least(greatest(coalesce(p_limit, 500), 1), 5000);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.opportunity_events enable row level security;

-- Curadoria lê tudo; corretor responsável lê o histórico das próprias áreas. Escrita só por trigger/RPC.
create policy opportunity_events_select on public.opportunity_events for select to authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.opportunities o
     where o.id = opportunity_id and o.responsible_party_user_id = (select auth.uid())));

revoke all on public.opportunity_events from anon;
revoke insert, update, delete, truncate on public.opportunity_events from authenticated, service_role;

revoke execute on function
  public.opportunity_publish_blockers(uuid),
  public.publish_blockers_of(public.opportunities),
  public.publish_opportunity(uuid, text),
  public.curate_opportunity(uuid, public.opportunity_status, public.mandate_status, uuid, boolean, boolean, text),
  public.add_opportunity_note(uuid, text),
  public.curate_lead(uuid, public.lead_status, text, uuid),
  public.convert_lead(uuid),
  public.admin_list_brokers(),
  public.admin_access_log(timestamptz, timestamptz, text, text, integer),
  public.log_opportunity_changes()
from public, anon;
grant execute on function
  public.opportunity_publish_blockers(uuid),
  public.publish_opportunity(uuid, text),
  public.curate_opportunity(uuid, public.opportunity_status, public.mandate_status, uuid, boolean, boolean, text),
  public.add_opportunity_note(uuid, text),
  public.curate_lead(uuid, public.lead_status, text, uuid),
  public.convert_lead(uuid),
  public.admin_list_brokers(),
  public.admin_access_log(timestamptz, timestamptz, text, text, integer)
to authenticated;
-- O trigger de publicação roda como o usuário do app e precisa chamar a checagem.
grant execute on function public.publish_blockers_of(public.opportunities) to authenticated;
