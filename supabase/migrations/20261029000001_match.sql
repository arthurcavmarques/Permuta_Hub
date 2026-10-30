-- Fase 3 — Teses de interesse e matchmaking por regras (seção 9.2), mais:
--   * dossiê no formato da apresentação de referência: nº estimado de unidades e divisão dinheiro × permuta;
--   * corretor padrão para as áreas que o proprietário cadastra (D028).
-- Reverter: supabase/rollbacks/20261029000001_match.down.sql

-- ---------------------------------------------------------------------------
-- Dossiê: unidades estimadas e divisão do pagamento
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column estimated_units integer check (estimated_units is null or estimated_units > 0),
  add column cash_share_pct numeric(5, 2) check (cash_share_pct is null or (cash_share_pct >= 0 and cash_share_pct <= 100));

comment on column public.opportunities.estimated_units is 'Estudo preliminar: nº máximo estimado de unidades (sujeito a aprovação).';
comment on column public.opportunities.cash_share_pct is 'Parte do valor pretendido paga em dinheiro (%); o restante em permuta/adesão.';

-- Mesma view da Fundação, com as duas colunas novas no fim.
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
  o.cash_share_pct
from public.opportunities o
where public.can_view_blind(o.id)
  and o.status <> 'archived';

-- ---------------------------------------------------------------------------
-- Corretor padrão para áreas do proprietário (lead sem corretor recebe este)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, description) values
  ('owner_lead_default_broker', 'null',
   'Corretor que atende as áreas cadastradas pelo proprietário (user_id). Vazio = a curadoria atribui à mão.')
on conflict (key) do nothing;

create or replace function public.owner_lead_default_broker()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.user_id
    from public.brokers b
    join public.profiles p on p.user_id = b.user_id and p.account_status = 'approved'
   where b.verification_status = 'approved'
     and b.user_id::text = public.setting_text('owner_lead_default_broker', '');
$$;

create or replace function public.assign_default_broker_to_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is null then
    new.assigned_to := public.owner_lead_default_broker();
  end if;
  return new;
end;
$$;

create trigger owner_leads_default_broker before insert on public.owner_leads
  for each row execute function public.assign_default_broker_to_lead();

create or replace function public.set_owner_lead_default_broker(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if p_user_id is not null and not exists (
       select 1 from public.brokers b where b.user_id = p_user_id and b.verification_status = 'approved') then
    raise exception 'Corretor sem CRECI verificado' using errcode = '23514';
  end if;
  update public.platform_settings
     set value = coalesce(to_jsonb(p_user_id::text), 'null'::jsonb)
   where key = 'owner_lead_default_broker';
  -- Leads ainda sem corretor passam para o padrão.
  if p_user_id is not null then
    update public.owner_leads set assigned_to = p_user_id
     where assigned_to is null and status in ('new', 'qualifying');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Teses de interesse (o que cada empresa compradora procura)
-- ---------------------------------------------------------------------------
create table public.buyer_theses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  active boolean not null default true,
  -- Filtros obrigatórios (vazio/nulo = sem restrição)
  asset_types text[] not null default '{}',
  states text[] not null default '{}',
  cities text[] not null default '{}',
  region_tags text[] not null default '{}',
  min_area_m2 numeric(14, 2) check (min_area_m2 is null or min_area_m2 >= 0),
  max_area_m2 numeric(14, 2) check (max_area_m2 is null or max_area_m2 >= 0),
  negotiation_models public.negotiation_model[] not null default '{}',
  min_ticket numeric(16, 2) check (min_ticket is null or min_ticket >= 0),
  max_ticket numeric(16, 2) check (max_ticket is null or max_ticket >= 0),
  -- Preferências (pontuação)
  zonings text[] not null default '{}',
  min_coefficient numeric(6, 2) check (min_coefficient is null or min_coefficient >= 0),
  project_types text[] not null default '{}',
  neighborhoods text[] not null default '{}',
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_area_m2 is null or max_area_m2 is null or min_area_m2 <= max_area_m2),
  check (min_ticket is null or max_ticket is null or min_ticket <= max_ticket)
);

create index buyer_theses_org_idx on public.buyer_theses (organization_id);

create trigger buyer_theses_updated_at before update on public.buyer_theses
  for each row execute function public.set_updated_at();

-- Quem escreve: curadoria, ou membro aprovado (admin/buyer) da própria organização.
create or replace function public.can_manage_thesis(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.is_approved() and exists (
    select 1 from public.organization_members m
     where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.role in ('admin', 'buyer')));
$$;

alter table public.buyer_theses enable row level security;
create policy buyer_theses_select on public.buyer_theses for select to authenticated
  using ((select public.is_admin()) or ((select public.is_approved()) and organization_id in (select public.user_org_ids())));
create policy buyer_theses_insert on public.buyer_theses for insert to authenticated
  with check (public.can_manage_thesis(organization_id));
create policy buyer_theses_update on public.buyer_theses for update to authenticated
  using (public.can_manage_thesis(organization_id)) with check (public.can_manage_thesis(organization_id));
create policy buyer_theses_delete on public.buyer_theses for delete to authenticated
  using ((select public.is_admin()));
revoke all on public.buyer_theses from anon;

-- ---------------------------------------------------------------------------
-- Configuração do match (pesos, limiar, auto-aprovação) — editável pela curadoria
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, description) values
  ('match_config',
   '{"weights": {"zoning": 20, "coefficient": 15, "project_types": 20, "proximity": 15, "freshness": 15, "response_history": 15},
     "min_score": 40, "auto_approve_score": null, "fresh_days": 30, "stale_days": 120}',
   'Match (Fase 3): pesos da pontuação, nota mínima para sugerir e nota para aprovar sozinho (null = sempre a curadoria).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Matches: sugestão área × tese, com motivos legíveis. Só a curadoria vê (o comprador só vê o que recebe).
-- ---------------------------------------------------------------------------
create type public.match_status as enum ('suggested', 'approved', 'rejected');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  thesis_id uuid not null references public.buyer_theses (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  score integer not null check (score between 0 and 100),
  manual_score integer check (manual_score is null or manual_score between 0 and 100),
  reasons jsonb not null default '[]',
  status public.match_status not null default 'suggested',
  -- false = a área ou a tese mudou e o par deixou de combinar (aprovado/recusado fica para histórico).
  still_matches boolean not null default true,
  computed_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, thesis_id)
);

create index matches_status_idx on public.matches (status, still_matches);
create index matches_org_idx on public.matches (organization_id);

create trigger matches_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

alter table public.matches enable row level security;
create policy matches_admin_select on public.matches for select to authenticated using ((select public.is_admin()));
revoke all on public.matches from anon;
revoke insert, update, delete, truncate on public.matches from authenticated;

alter table public.distributions
  add constraint distributions_thesis_fk foreign key (thesis_id) references public.buyer_theses (id),
  add constraint distributions_match_fk foreign key (match_id) references public.matches (id);

-- ---------------------------------------------------------------------------
-- Avaliação de um par (área, tese): filtros obrigatórios + pontuação 0–100 + motivos
-- ---------------------------------------------------------------------------
create or replace function public.norm_text(p text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent(regexp_replace(trim(p), '\s+', ' ', 'g')));
$$;

create or replace function public.norm_array(p text[])
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(public.norm_text(x)), '{}') from unnest(p) x where coalesce(trim(x), '') <> '';
$$;

create or replace function public.fmt_int(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(to_char(round(p), 'FM999,999,999,999'), ',', '.');
$$;

create or replace function public.fmt_money(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p >= 1000000 then 'R$ ' || replace(to_char(round(p / 1000000, 1), 'FM999990.0'), '.', ',') || ' mi'
              else 'R$ ' || public.fmt_int(p) end;
$$;

create or replace function public.match_evaluate(o public.opportunities, t public.buyer_theses)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce((select value from public.platform_settings where key = 'match_config'), '{}');
  v_w jsonb := coalesce(v_cfg -> 'weights', '{}');
  v_reasons jsonb := '[]';
  v_hard_fail boolean := false;
  v_sum numeric := 0;
  v_wsum numeric := 0;
  v_f numeric;
  v_detail text;
  v_label text;
  v_age int;
  v_interested int;
  v_declined int;
  v_overlap text[];
  v_city_ok boolean;
begin
  -- Elegibilidade: só área qualificada/em distribuição e tese ativa.
  if o.status not in ('qualified', 'distributing') then
    v_hard_fail := true;
    v_reasons := v_reasons || jsonb_build_object('criterion', 'status', 'kind', 'hard', 'result', 'fail',
      'detail', 'Área fora de qualificada/em distribuição');
  end if;
  if not t.active then
    v_hard_fail := true;
    v_reasons := v_reasons || jsonb_build_object('criterion', 'thesis', 'kind', 'hard', 'result', 'fail',
      'detail', 'Tese pausada');
  end if;

  -- 1. Tipo de ativo
  select e ->> 'label' into v_label
    from jsonb_array_elements(coalesce((select value from public.platform_settings where key = 'asset_types'), '[]')) e
   where e ->> 'value' = o.asset_type;
  if cardinality(t.asset_types) = 0 then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'asset_type', 'kind', 'hard', 'result', 'pass',
      'detail', 'Tese aceita qualquer tipo de ativo');
  elsif o.asset_type is null then
    v_hard_fail := true;
    v_reasons := v_reasons || jsonb_build_object('criterion', 'asset_type', 'kind', 'hard', 'result', 'fail',
      'detail', 'Área sem tipo de ativo classificado');
  elsif o.asset_type = any (t.asset_types) then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'asset_type', 'kind', 'hard', 'result', 'pass',
      'detail', 'Compatível: tipo ' || coalesce(v_label, o.asset_type));
  else
    v_hard_fail := true;
    v_reasons := v_reasons || jsonb_build_object('criterion', 'asset_type', 'kind', 'hard', 'result', 'fail',
      'detail', 'Tipo ' || coalesce(v_label, o.asset_type) || ' fora da tese');
  end if;

  -- 2. Região: cidade, UF ou contexto urbano (qualquer um que a tese definir)
  if cardinality(t.cities) + cardinality(t.states) + cardinality(t.region_tags) = 0 then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'region', 'kind', 'hard', 'result', 'pass',
      'detail', 'Tese sem restrição de região');
  else
    v_city_ok := (public.norm_text(o.city) = any (public.norm_array(t.cities)))
              or (upper(o.state) = any (select upper(x) from unnest(t.states) x))
              or (public.norm_array(o.region_tags) && public.norm_array(t.region_tags));
    if coalesce(v_city_ok, false) then
      v_reasons := v_reasons || jsonb_build_object('criterion', 'region', 'kind', 'hard', 'result', 'pass',
        'detail', 'Compatível: ' || concat_ws(' · ', o.city, o.state) || ' dentro da região da tese');
    else
      v_hard_fail := true;
      v_reasons := v_reasons || jsonb_build_object('criterion', 'region', 'kind', 'hard', 'result', 'fail',
        'detail', coalesce(concat_ws(' · ', o.city, o.state), 'Local não informado') || ' fora da região da tese');
    end if;
  end if;

  -- 3. Metragem
  if t.min_area_m2 is null and t.max_area_m2 is null then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'area', 'kind', 'hard', 'result', 'pass',
      'detail', 'Tese sem faixa de metragem');
  else
    v_detail := case when t.min_area_m2 is not null and t.max_area_m2 is not null
                       then public.fmt_int(t.min_area_m2) || '–' || public.fmt_int(t.max_area_m2) || ' m²'
                     when t.min_area_m2 is not null then 'mín. ' || public.fmt_int(t.min_area_m2) || ' m²'
                     else 'máx. ' || public.fmt_int(t.max_area_m2) || ' m²' end;
    if o.area_m2 is null then
      v_hard_fail := true;
      v_reasons := v_reasons || jsonb_build_object('criterion', 'area', 'kind', 'hard', 'result', 'fail',
        'detail', 'Área sem metragem informada (tese pede ' || v_detail || ')');
    elsif (t.min_area_m2 is null or o.area_m2 >= t.min_area_m2) and (t.max_area_m2 is null or o.area_m2 <= t.max_area_m2) then
      v_reasons := v_reasons || jsonb_build_object('criterion', 'area', 'kind', 'hard', 'result', 'pass',
        'detail', 'Compatível: metragem ' || public.fmt_int(o.area_m2) || ' m² dentro de ' || v_detail);
    else
      v_hard_fail := true;
      v_reasons := v_reasons || jsonb_build_object('criterion', 'area', 'kind', 'hard', 'result', 'fail',
        'detail', 'Metragem ' || public.fmt_int(o.area_m2) || ' m² fora de ' || v_detail);
    end if;
  end if;

  -- 4. Formato de negócio
  if cardinality(t.negotiation_models) = 0 then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'negotiation', 'kind', 'hard', 'result', 'pass',
      'detail', 'Tese aceita qualquer formato de negócio');
  elsif o.negotiation_models && t.negotiation_models then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'negotiation', 'kind', 'hard', 'result', 'pass',
      'detail', 'Compatível: formato ' || (select string_agg(case m when 'sale' then 'venda' when 'swap' then 'permuta'
                                                                     when 'partnership' then 'parceria' else 'outro' end, ', ')
                                             from unnest(o.negotiation_models) m where m = any (t.negotiation_models)));
  else
    v_hard_fail := true;
    v_reasons := v_reasons || jsonb_build_object('criterion', 'negotiation', 'kind', 'hard', 'result', 'fail',
      'detail', case when cardinality(o.negotiation_models) = 0 then 'Área sem formato de negócio informado'
                     else 'Formato de negócio da área não está na tese' end);
  end if;

  -- 5. Ticket: só quando a área tem valor e a tese tem faixa
  if t.min_ticket is null and t.max_ticket is null then
    null;
  elsif o.asking_value is null then
    v_reasons := v_reasons || jsonb_build_object('criterion', 'ticket', 'kind', 'hard', 'result', 'partial',
      'detail', 'Área sem valor informado: faixa de ticket não conferida');
  else
    v_detail := case when t.min_ticket is not null and t.max_ticket is not null
                       then public.fmt_money(t.min_ticket) || '–' || public.fmt_money(t.max_ticket)
                     when t.min_ticket is not null then 'mín. ' || public.fmt_money(t.min_ticket)
                     else 'máx. ' || public.fmt_money(t.max_ticket) end;
    if (t.min_ticket is null or o.asking_value >= t.min_ticket) and (t.max_ticket is null or o.asking_value <= t.max_ticket) then
      v_reasons := v_reasons || jsonb_build_object('criterion', 'ticket', 'kind', 'hard', 'result', 'pass',
        'detail', 'Compatível: valor ' || public.fmt_money(o.asking_value) || ' dentro de ' || v_detail);
    else
      v_hard_fail := true;
      v_reasons := v_reasons || jsonb_build_object('criterion', 'ticket', 'kind', 'hard', 'result', 'fail',
        'detail', 'Valor ' || public.fmt_money(o.asking_value) || ' fora de ' || v_detail);
    end if;
  end if;

  -- ---- Pontuação (1 = atende, 0,5 = parcial/sem dado, 0 = não atende)
  -- Zoneamento
  if cardinality(t.zonings) = 0 then
    v_f := 1; v_detail := 'Tese sem preferência de zoneamento';
  elsif o.zoning is null then
    v_f := 0.5; v_detail := 'Área sem zoneamento informado';
  elsif exists (select 1 from unnest(public.norm_array(t.zonings)) z where public.norm_text(o.zoning) like '%' || z || '%') then
    v_f := 1; v_detail := 'Zoneamento ' || o.zoning || ' aceito pela tese';
  else
    v_f := 0; v_detail := 'Zoneamento ' || o.zoning || ' fora dos aceitos';
  end if;
  v_sum := v_sum + v_f * coalesce((v_w ->> 'zoning')::numeric, 0); v_wsum := v_wsum + coalesce((v_w ->> 'zoning')::numeric, 0);
  v_reasons := v_reasons || jsonb_build_object('criterion', 'zoning', 'kind', 'soft',
    'result', case v_f when 1 then 'pass' when 0 then 'fail' else 'partial' end, 'detail', v_detail);

  -- Coeficiente
  if t.min_coefficient is null then
    v_f := 1; v_detail := 'Tese sem coeficiente mínimo';
  elsif o.coefficient is null then
    v_f := 0.5; v_detail := 'Área sem coeficiente informado';
  elsif o.coefficient >= t.min_coefficient then
    v_f := 1; v_detail := 'Coeficiente ' || o.coefficient || ' ≥ ' || t.min_coefficient;
  else
    v_f := 0; v_detail := 'Coeficiente ' || o.coefficient || ' abaixo de ' || t.min_coefficient;
  end if;
  v_sum := v_sum + v_f * coalesce((v_w ->> 'coefficient')::numeric, 0); v_wsum := v_wsum + coalesce((v_w ->> 'coefficient')::numeric, 0);
  v_reasons := v_reasons || jsonb_build_object('criterion', 'coefficient', 'kind', 'soft',
    'result', case v_f when 1 then 'pass' when 0 then 'fail' else 'partial' end, 'detail', v_detail);

  -- Tipos de projeto
  v_overlap := array(select x from unnest(public.norm_array(o.project_types)) x where x = any (public.norm_array(t.project_types)));
  if cardinality(t.project_types) = 0 then
    v_f := 1; v_detail := 'Tese sem preferência de projeto';
  elsif cardinality(o.project_types) = 0 then
    v_f := 0.5; v_detail := 'Área sem tipos de projeto informados';
  elsif cardinality(v_overlap) > 0 then
    v_f := 1; v_detail := 'Projetos em comum: ' || array_to_string(v_overlap, ', ');
  else
    v_f := 0; v_detail := 'Nenhum tipo de projeto em comum';
  end if;
  v_sum := v_sum + v_f * coalesce((v_w ->> 'project_types')::numeric, 0); v_wsum := v_wsum + coalesce((v_w ->> 'project_types')::numeric, 0);
  v_reasons := v_reasons || jsonb_build_object('criterion', 'project_types', 'kind', 'soft',
    'result', case v_f when 1 then 'pass' when 0 then 'fail' else 'partial' end, 'detail', v_detail);

  -- Proximidade: bairros preferidos dentro da região (D028)
  if cardinality(t.neighborhoods) = 0 then
    v_f := 1; v_detail := 'Tese sem bairros preferidos';
  elsif public.norm_text(o.neighborhood) = any (public.norm_array(t.neighborhoods)) then
    v_f := 1; v_detail := 'Bairro preferido: ' || o.neighborhood;
  else
    v_f := 0.5; v_detail := 'Na região, mas fora dos bairros preferidos';
  end if;
  v_sum := v_sum + v_f * coalesce((v_w ->> 'proximity')::numeric, 0); v_wsum := v_wsum + coalesce((v_w ->> 'proximity')::numeric, 0);
  v_reasons := v_reasons || jsonb_build_object('criterion', 'proximity', 'kind', 'soft',
    'result', case v_f when 1 then 'pass' when 0 then 'fail' else 'partial' end, 'detail', v_detail);

  -- Atualidade
  v_age := extract(day from now() - coalesce(o.published_at, o.updated_at))::int;
  if v_age <= coalesce((v_cfg ->> 'fresh_days')::int, 30) then
    v_f := 1; v_detail := 'Área recente (' || v_age || ' dias)';
  elsif v_age <= coalesce((v_cfg ->> 'stale_days')::int, 120) then
    v_f := 0.5; v_detail := 'Área publicada há ' || v_age || ' dias';
  else
    v_f := 0; v_detail := 'Área antiga (' || v_age || ' dias)';
  end if;
  v_sum := v_sum + v_f * coalesce((v_w ->> 'freshness')::numeric, 0); v_wsum := v_wsum + coalesce((v_w ->> 'freshness')::numeric, 0);
  v_reasons := v_reasons || jsonb_build_object('criterion', 'freshness', 'kind', 'soft',
    'result', case v_f when 1 then 'pass' when 0 then 'fail' else 'partial' end, 'detail', v_detail);

  -- Histórico de resposta da empresa (interessou × recusou nos envios da plataforma)
  select count(*) filter (where e.event = 'interested'), count(*) filter (where e.event = 'declined')
    into v_interested, v_declined
    from public.distributions d join public.distribution_events e on e.distribution_id = d.id
   where d.recipient_org_id = t.organization_id and d.source = 'platform';
  if v_interested + v_declined = 0 then
    v_f := 0.5; v_detail := 'Empresa ainda sem histórico de resposta';
  else
    v_f := round(v_interested::numeric / (v_interested + v_declined), 2);
    v_detail := 'Respondeu "tenho interesse" em ' || v_interested || ' de ' || (v_interested + v_declined) || ' envios';
  end if;
  v_sum := v_sum + v_f * coalesce((v_w ->> 'response_history')::numeric, 0); v_wsum := v_wsum + coalesce((v_w ->> 'response_history')::numeric, 0);
  v_reasons := v_reasons || jsonb_build_object('criterion', 'response_history', 'kind', 'soft',
    'result', case when v_f >= 0.75 then 'pass' when v_f <= 0.25 then 'fail' else 'partial' end, 'detail', v_detail);

  return jsonb_build_object(
    'passed', not v_hard_fail,
    'score', case when v_wsum = 0 then 100 else round(100 * v_sum / v_wsum)::int end,
    'reasons', v_reasons);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recálculo idempotente (por área, por tese ou tudo). Interno: só triggers e a RPC da curadoria.
-- ---------------------------------------------------------------------------
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

create or replace function public.matches_on_opportunity_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_matches(new.id, null);
  return null;
end;
$$;

create trigger opportunities_recompute_matches after insert or update on public.opportunities
  for each row execute function public.matches_on_opportunity_change();

create or replace function public.matches_on_thesis_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_matches(null, new.id);
  return null;
end;
$$;

create trigger buyer_theses_recompute_matches after insert or update on public.buyer_theses
  for each row execute function public.matches_on_thesis_change();

-- ---------------------------------------------------------------------------
-- RPCs da curadoria
-- ---------------------------------------------------------------------------
create or replace function public.admin_recompute_matches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  return public.recompute_matches(null, null);
end;
$$;

create or replace function public.admin_list_matches()
returns table (
  id uuid, opportunity_id uuid, memorial_number text, city text, neighborhood text, area_m2 numeric,
  asset_type text, asking_value numeric, organization_id uuid, organization_name text, thesis_id uuid,
  thesis_name text, score integer, manual_score integer, reasons jsonb, status public.match_status,
  still_matches boolean, computed_at timestamptz, decided_at timestamptz, decided_by_name text,
  decision_note text, publish_blockers text[])
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
    select m.id, o.id, o.memorial_number, o.city, o.neighborhood, o.area_m2, o.asset_type, o.asking_value,
           org.id, org.name, t.id, t.name, m.score, m.manual_score, m.reasons, m.status, m.still_matches,
           m.computed_at, m.decided_at, p.full_name, m.decision_note,
           coalesce((select array_agg(b) from public.publish_blockers_of(o) b), '{}')
      from public.matches m
      join public.opportunities o on o.id = m.opportunity_id
      join public.buyer_theses t on t.id = m.thesis_id
      join public.organizations org on org.id = m.organization_id
      left join public.profiles p on p.user_id = m.decided_by
     order by (m.status = 'suggested') desc, coalesce(m.manual_score, m.score) desc, o.memorial_number;
end;
$$;

create or replace function public.decide_match(
  p_match_id uuid, p_status public.match_status, p_note text default null, p_manual_score integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  update public.matches
     set status = p_status,
         manual_score = p_manual_score,
         decision_note = nullif(trim(p_note), ''),
         decided_by = case when p_status = 'suggested' then null else auth.uid() end,
         decided_at = case when p_status = 'suggested' then null else now() end
   where id = p_match_id;
  if not found then
    raise exception 'Match não encontrado' using errcode = 'P0002';
  end if;
end;
$$;

-- Organizações que podem ter tese (para o seletor da curadoria): compradoras, ativas.
create or replace function public.admin_list_buyer_organizations()
returns table (id uuid, name text, type public.organization_type, theses integer)
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
    select o.id, o.name, o.type, (select count(*)::int from public.buyer_theses t where t.organization_id = o.id)
      from public.organizations o
     where o.active and o.type <> 'brokerage'
     order by o.name;
end;
$$;

revoke execute on function
  public.recompute_matches(uuid, uuid),
  public.match_evaluate(public.opportunities, public.buyer_theses),
  public.matches_on_opportunity_change(),
  public.matches_on_thesis_change(),
  public.assign_default_broker_to_lead(),
  public.owner_lead_default_broker()
from public, anon, authenticated;

revoke execute on function
  public.admin_recompute_matches(),
  public.admin_list_matches(),
  public.decide_match(uuid, public.match_status, text, integer),
  public.admin_list_buyer_organizations(),
  public.set_owner_lead_default_broker(uuid),
  public.can_manage_thesis(uuid)
from public, anon;

grant execute on function
  public.admin_recompute_matches(),
  public.admin_list_matches(),
  public.decide_match(uuid, public.match_status, text, integer),
  public.admin_list_buyer_organizations(),
  public.set_owner_lead_default_broker(uuid),
  public.can_manage_thesis(uuid)
to authenticated;
