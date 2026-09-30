-- Fase 0 · Fundação mínima: identidade, admins da plataforma, configurações,
-- oportunidades (dossiê cego), dado sensível isolado e log de acesso append-only.
-- Regra de ouro: RLS habilitado em TODAS as tabelas; sem política = negado.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tipos de domínio
-- ---------------------------------------------------------------------------
create type public.organization_type as enum
  ('developer', 'builder', 'urbanizer', 'land_developer', 'investor', 'brokerage', 'other');

create type public.opportunity_status as enum
  ('captured', 'qualifying', 'qualified', 'distributing', 'negotiating', 'closed', 'lost', 'archived');

create type public.mandate_status as enum ('exclusive', 'non_exclusive', 'being_obtained', 'none');

create type public.negotiation_model as enum ('sale', 'swap', 'partnership', 'other');

create type public.media_kind as enum ('photo', 'map', 'aerial', 'other');

-- ---------------------------------------------------------------------------
-- Identidade
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  whatsapp_opt_in boolean not null default false,
  opt_in_at timestamptz,
  opt_in_text_version text,
  locale text not null default 'pt-BR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.organization_type not null default 'other',
  document_id text,
  city text,
  state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin da PLATAFORMA (curadoria). Não confundir com organization_members.role = 'admin' (D007).
create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid());
$$;

-- Cria o profile automaticamente quando um usuário é criado no Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Configurações da plataforma (chave/valor tipado em jsonb)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value, description) values
  ('allow_distribution_without_mandate', 'false', 'Regra 4 — DEPENDE DO JURÍDICO. Padrão: não distribuir com mandate_status = none.'),
  ('default_tail_period_months', '24', 'Prazo de cauda padrão dos termos — DEPENDE DO JURÍDICO.'),
  ('quiet_hours', '{"timezone": "America/Sao_Paulo", "start": "08:00", "end": "19:00", "weekdays": [1,2,3,4,5]}', 'Janela de envio (Fase 4).'),
  ('weekly_send_limit_per_recipient', '5', 'Teto semanal de envios por destinatário (Fase 4).'),
  ('blind_area_rounding_m2', '100', 'Dossiê cego: arredondamento da metragem (D003).'),
  ('blind_map_radius_m', '500', 'Dossiê cego: raio do círculo de localização aproximada (D003).'),
  ('blind_location_level', '"neighborhood"', 'Dossiê cego: nível de localização exibido (neighborhood | city).');

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = p_key), p_default);
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from public.platform_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Oportunidades
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  asset_type text not null default 'terreno',
  memorial_number text not null unique,
  title_blind text,
  status public.opportunity_status not null default 'captured',
  land_type text,
  area_m2 numeric(14, 2) check (area_m2 is null or area_m2 > 0),
  city text,
  neighborhood text,
  state text default 'RS',
  region_tags text[] not null default '{}',
  zoning text,
  master_plan_notes text,
  buildable_potential_notes text,
  coefficient numeric(6, 2) check (coefficient is null or coefficient >= 0),
  project_types text[] not null default '{}',
  negotiation_conditions text,
  asking_value numeric(16, 2) check (asking_value is null or asking_value >= 0),
  negotiation_models public.negotiation_model[] not null default '{}',
  -- Geometria EXATA: é informação sensível na prática (revela o local). Só admin lê a tabela;
  -- os demais veem a localização aproximada pela view opportunities_blind.
  geometry extensions.geometry(Geometry, 4326),
  responsible_party_user_id uuid references auth.users (id),
  responsible_party_org_id uuid references public.organizations (id),
  mandate_status public.mandate_status not null default 'none',
  origin_lead_id uuid, -- FK para owner_leads na Fase 2
  extra jsonb not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_status_idx on public.opportunities (status);
create index opportunities_city_idx on public.opportunities (city, neighborhood);
create index opportunities_geometry_idx on public.opportunities using gist (geometry);

-- Dado sensível (regra 1). SEM política de SELECT: nem admin lê direto.
-- Leitura só pela RPC get_opportunity_sensitive(), que checa permissão e registra log.
create table public.opportunity_sensitive (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references public.opportunities (id) on delete cascade,
  registry_number text, -- matrícula
  exact_address text,
  owner_name text,
  owner_contacts jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.opportunity_media (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  kind public.media_kind not null default 'photo',
  storage_path text not null unique,
  caption text,
  is_blind_safe boolean not null default false, -- curadoria manual: foto pode identificar a área
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunity_media_opp_idx on public.opportunity_media (opportunity_id, sort_order);

-- ---------------------------------------------------------------------------
-- Log de acesso (append-only, regra 2)
-- ---------------------------------------------------------------------------
create table public.access_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  opportunity_id uuid,
  ip text,
  user_agent text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index access_log_opp_idx on public.access_log (opportunity_id, at desc);

-- Rejeita qualquer alteração, inclusive de service_role (que ignora RLS mas não triggers).
create or replace function public.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Tabela % é append-only: % não permitido', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create trigger access_log_append_only
  before update or delete on public.access_log
  for each row execute function public.reject_mutation();

create trigger access_log_no_truncate
  before truncate on public.access_log
  for each statement execute function public.reject_mutation();

revoke update, delete, truncate on public.access_log from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Visibilidade do dossiê cego
-- ---------------------------------------------------------------------------
-- Fase 0: só admin da plataforma. Fase 4: destinatários de distribuições. (Ampliar aqui.)
create or replace function public.can_view_blind(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin();
$$;

-- Localização aproximada determinística: o mesmo deslocamento sempre para a mesma oportunidade,
-- para que recarregar a página não permita "triangular" o ponto real.
create or replace function public.blind_center(p_id uuid, p_geometry extensions.geometry)
returns extensions.geometry
language sql
stable
set search_path = ''
as $$
  select case when p_geometry is null then null else
    extensions.st_project(
      extensions.st_pointonsurface(p_geometry)::extensions.geography,
      -- até 60% do raio: o ponto real sempre fica dentro do círculo exibido
      (get_byte(decode(md5(p_id::text), 'hex'), 0) / 255.0) * 0.6
        * public.setting_numeric('blind_map_radius_m', 500),
      radians(get_byte(decode(md5(p_id::text), 'hex'), 1) / 255.0 * 360)
    )::extensions.geometry
  end;
$$;

create or replace function public.round_area(p_area numeric)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when p_area is null then null else
    greatest(
      public.setting_numeric('blind_area_rounding_m2', 100),
      round(p_area / public.setting_numeric('blind_area_rounding_m2', 100))
        * public.setting_numeric('blind_area_rounding_m2', 100)
    )
  end;
$$;

-- View do dossiê cego. Roda com os privilégios do dono (ignora RLS da tabela base) e filtra
-- por can_view_blind(): é a ÚNICA porta de leitura para quem não é admin.
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
  o.updated_at
from public.opportunities o
where public.can_view_blind(o.id)
  and o.status <> 'archived';

-- Leitura do dado sensível: checa permissão, REGISTRA ANTES de retornar (regra 1 / seção 9.4).
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
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}');
begin
  -- Fase 0: só admin. Fase 5: or public.has_valid_agreement(p_opportunity_id).
  if not public.is_admin() then
    raise exception 'Acesso negado ao dado sensível' using errcode = '42501';
  end if;

  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (
    auth.uid(), 'read_sensitive', 'opportunity_sensitive', p_opportunity_id, p_opportunity_id,
    split_part(v_headers ->> 'x-forwarded-for', ',', 1), v_headers ->> 'user-agent'
  );

  return query
    select s.registry_number, s.exact_address, s.owner_name, s.owner_contacts, s.notes
    from public.opportunity_sensitive s
    where s.opportunity_id = p_opportunity_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger platform_admins_updated_at before update on public.platform_admins for each row execute function public.set_updated_at();
create trigger platform_settings_updated_at before update on public.platform_settings for each row execute function public.set_updated_at();
create trigger opportunities_updated_at before update on public.opportunities for each row execute function public.set_updated_at();
create trigger opportunity_sensitive_updated_at before update on public.opportunity_sensitive for each row execute function public.set_updated_at();
create trigger opportunity_media_updated_at before update on public.opportunity_media for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: habilitado em todas; políticas explícitas por perfil
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_settings enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_sensitive enable row level security;
alter table public.opportunity_media enable row level security;
alter table public.access_log enable row level security;

-- profiles: cada um vê/edita o próprio; admin vê todos.
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- organizations: admin gerencia (membros entram na Fase 1).
create policy organizations_admin_all on public.organizations for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- platform_admins: usuário sabe se é admin; só admin vê a lista. Inclusão só via service_role.
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- platform_settings: logado lê; admin altera.
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);
create policy platform_settings_admin_update on public.platform_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- opportunities (tabela completa, com geometria exata): só admin.
create policy opportunities_admin_all on public.opportunities for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- opportunity_media: admin tudo; demais só mídia marcada como segura para o dossiê cego.
create policy opportunity_media_admin_all on public.opportunity_media for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy opportunity_media_blind_select on public.opportunity_media for select to authenticated
  using (is_blind_safe and public.can_view_blind(opportunity_id));

-- access_log: admin lê; ninguém escreve direto (só funções SECURITY DEFINER).
create policy access_log_admin_select on public.access_log for select to authenticated
  using ((select public.is_admin()));

-- opportunity_sensitive: nenhuma política. Defesa extra: sem privilégio de tabela.
revoke all on public.opportunity_sensitive from anon, authenticated;

-- anon não enxerga nada do domínio na Fase 0.
revoke all on all tables in schema public from anon;
revoke execute on function public.get_opportunity_sensitive(uuid) from anon, public;
grant execute on function public.get_opportunity_sensitive(uuid) to authenticated;
grant select on public.opportunities_blind to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: bucket privado de mídia do dossiê
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('opportunity-media', 'opportunity-media', false)
on conflict (id) do nothing;

create policy opportunity_media_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'opportunity-media'
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.opportunity_media m
        where m.storage_path = storage.objects.name
          and m.is_blind_safe
          and public.can_view_blind(m.opportunity_id)
      )
    )
  );

create policy opportunity_media_objects_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'opportunity-media' and (select public.is_admin()))
  with check (bucket_id = 'opportunity-media' and (select public.is_admin()));
