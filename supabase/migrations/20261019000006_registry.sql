-- Fase 2 · Bloco 2.5 — Verificação cadastral (seções 9.5 e 9.9; regras 11 e 12).
-- CNPJ: consulta pela Edge Function registry-lookup (BrasilAPI), log append-only em registry_lookups, dados
-- aplicados à organização só a partir de uma consulta registrada; CNPJ único; fonte fora do ar → manual.
-- CRECI: nível B (link da consulta oficial + comprovante + curadoria com situação e nome conferido) e nível C
-- (reverificação periódica). Nível A não existe: não há fonte legítima (D025).
-- Reverter: supabase/rollbacks/20261019000006_registry.down.sql

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Log de consultas externas (append-only, regra 2 e 11). Também serve de cache.
-- ---------------------------------------------------------------------------
create type public.registry_kind as enum ('cnpj', 'creci');
create type public.registry_result as enum ('ok', 'not_found', 'invalid', 'error', 'timeout', 'cache');

create table public.registry_lookups (
  id uuid primary key default gen_random_uuid(),
  kind public.registry_kind not null,
  query text not null,
  requested_by uuid references auth.users (id),
  provider text not null,
  result public.registry_result not null,
  -- Só dados da empresa (sem quadro societário). Na linha "cache", aponta a consulta original.
  response jsonb,
  response_hash text,
  source_lookup_id uuid references public.registry_lookups (id),
  latency_ms integer,
  error text,
  at timestamptz not null default now()
);

create index registry_lookups_query_idx on public.registry_lookups (kind, query, at desc);
create index registry_lookups_user_idx on public.registry_lookups (requested_by, at desc);

create trigger registry_lookups_append_only before update or delete on public.registry_lookups
  for each row execute function public.reject_mutation();
create trigger registry_lookups_no_truncate before truncate on public.registry_lookups
  for each statement execute function public.reject_mutation();

alter table public.registry_lookups enable row level security;
create policy registry_lookups_select on public.registry_lookups for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));
revoke all on public.registry_lookups from anon;
revoke insert, update, delete, truncate on public.registry_lookups from authenticated, service_role;
-- A Edge Function grava com service_role: só INSERT.
grant insert on public.registry_lookups to service_role;

insert into public.platform_settings (key, value, description) values
  ('cnpj_cache_days', '30', 'CNPJ: consulta reaproveitada por N dias (cache).'),
  ('registry_lookups_per_hour', '30', 'CNPJ: máximo de consultas por usuário por hora (custo e abuso).'),
  ('cnae_real_estate_prefixes', '["41", "42", "43", "68", "6462", "6463", "6470"]',
   'CNAE de construção/imobiliário/participações: fora da lista só gera AVISO à curadoria.'),
  ('creci_lookup_urls', '{"RS": "https://creci-rs.gov.br/siteNovo/pesquisaInscrito.php"}',
   'Consulta pública oficial do CRECI por UF (verificação assistida, nível B). Acrescente outras UFs aqui.'),
  ('creci_review_months', '12', 'CRECI: reverificação a cada N meses (nível C).'),
  ('creci_review_sla_days', '2', 'CRECI: prazo da curadoria para conferir um envio (dias).');

alter table public.integration_settings drop constraint integration_settings_capability_check;
alter table public.integration_settings add constraint integration_settings_capability_check
  check (capability in ('email', 'messaging', 'agreement_signer', 'broker_verifier', 'map', 'billing', 'cnpj'));
-- ReceitaWS pode entrar como secundário: avaliar termos/limites antes (D024).
insert into public.integration_settings (capability, provider, config) values
  ('cnpj', 'brasilapi', '{"providers": ["brasilapi"], "timeout_ms": 6000, "retries": 1}');
update public.integration_settings set provider = 'assisted_link', config = '{"level": "B"}'
 where capability = 'broker_verifier';

-- ---------------------------------------------------------------------------
-- Organizações: dados da Receita travados, CNPJ único
-- ---------------------------------------------------------------------------
create type public.org_verification as enum ('unverified', 'verified', 'pending_manual', 'pending_review');

alter table public.organizations
  add column cnpj text check (cnpj is null or cnpj ~ '^\d{14}$'),
  add column legal_name text,
  add column trade_name text,
  add column registry_status text,
  add column opened_at date,
  add column legal_nature text,
  add column cnae_main text,
  add column cnae_main_description text,
  add column cnae_secondary text[] not null default '{}',
  add column registry_address text,
  add column registry_source text,
  add column registry_verified_at timestamptz,
  add column registry_lookup_id uuid references public.registry_lookups (id),
  add column cnae_warning boolean not null default false,
  add column verification_status public.org_verification not null default 'unverified',
  add column verification_note text;

-- CNPJ único (anti-multiconta; base da cota da Fase 7).
create unique index organizations_cnpj_key on public.organizations (cnpj) where cnpj is not null;

-- Pelo app, só a curadoria mexe em CNPJ e nos dados da Receita (RPCs abaixo aplicam a partir da consulta).
create or replace function public.guard_organization_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin() and (
       new.active is distinct from old.active or new.created_by is distinct from old.created_by
    or new.cnpj is distinct from old.cnpj or new.legal_name is distinct from old.legal_name
    or new.trade_name is distinct from old.trade_name or new.registry_status is distinct from old.registry_status
    or new.cnae_main is distinct from old.cnae_main or new.registry_lookup_id is distinct from old.registry_lookup_id
    or new.verification_status is distinct from old.verification_status
    or new.registry_verified_at is distinct from old.registry_verified_at
    or new.document_id is distinct from old.document_id) then
    raise exception 'CNPJ e dados da Receita só mudam pela consulta ou pela curadoria' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- CNPJ válido (mesma regra do supabase/functions/_shared/cnpj.ts).
create or replace function public.is_valid_cnpj(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int;
  r int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + substr(d, i, 1)::int * w1[i]; end loop;
  r := s % 11;
  if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + substr(d, i, 1)::int * w2[i]; end loop;
  r := s % 11;
  return (case when r < 2 then 0 else 11 - r end) = substr(d, 14, 1)::int;
end;
$$;

-- Aplica uma consulta registrada (da própria pessoa, recente, ok) ou o CNPJ manual (fonte fora do ar).
create or replace function public.apply_organization_cnpj(p_org_id uuid, p_cnpj text, p_lookup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_l public.registry_lookups;
  v_data jsonb;
  v_prefixes jsonb := coalesce((select value from public.platform_settings where key = 'cnae_real_estate_prefixes'), '[]');
begin
  if not (public.is_admin() or public.is_org_admin(p_org_id)
          or exists (select 1 from public.organizations o where o.id = p_org_id and o.created_by = auth.uid())) then
    raise exception 'Sem permissão nesta organização' using errcode = '42501';
  end if;
  if not public.is_valid_cnpj(v_digits) then
    raise exception 'CNPJ inválido' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizations where cnpj = v_digits and id <> p_org_id) then
    raise exception 'CNPJ já cadastrado em outra organização' using errcode = '23505';
  end if;

  if p_lookup_id is not null then
    select * into v_l from public.registry_lookups
     where id = p_lookup_id and kind = 'cnpj' and query = v_digits
       and (requested_by = auth.uid() or public.is_admin())
       and at > now() - make_interval(days => public.setting_numeric('cnpj_cache_days', 30)::int);
    if not found or v_l.result not in ('ok', 'cache') then
      raise exception 'Consulta de CNPJ inválida ou vencida: consulte de novo' using errcode = '22023';
    end if;
    v_data := case when v_l.result = 'cache'
                   then (select r.response from public.registry_lookups r where r.id = v_l.source_lookup_id)
                   else v_l.response end;
    update public.organizations set
      cnpj = v_digits, document_id = v_digits,
      legal_name = v_data ->> 'legal_name', trade_name = v_data ->> 'trade_name',
      registry_status = v_data ->> 'registry_status',
      opened_at = nullif(v_data ->> 'opened_at', '')::date,
      legal_nature = v_data ->> 'legal_nature',
      cnae_main = v_data ->> 'cnae_main', cnae_main_description = v_data ->> 'cnae_main_description',
      cnae_secondary = coalesce(array(select jsonb_array_elements_text(v_data -> 'cnae_secondary')), '{}'),
      registry_address = concat_ws(' — ', v_data ->> 'address', concat_ws('/', v_data ->> 'city', v_data ->> 'state')),
      registry_source = coalesce(v_l.provider, 'cache'), registry_verified_at = v_l.at, registry_lookup_id = v_l.id,
      cnae_warning = not exists (select 1 from jsonb_array_elements_text(v_prefixes) p
                                  where (v_data ->> 'cnae_main') like p || '%'),
      -- Situação diferente de ATIVA: a curadoria decide (não bloqueia o cadastro, retém).
      verification_status = case when (v_data ->> 'is_active')::boolean then 'verified' else 'pending_review' end::public.org_verification,
      verification_note = null
    where id = p_org_id;
  else
    -- Todas as fontes falharam (ou a pessoa não conseguiu consultar): segue para a fila manual.
    update public.organizations set
      cnpj = v_digits, document_id = v_digits, legal_name = null, trade_name = null, registry_status = null,
      cnae_main = null, registry_source = 'manual', registry_verified_at = null, registry_lookup_id = null,
      cnae_warning = false, verification_status = 'pending_manual', verification_note = null
    where id = p_org_id;
  end if;
end;
$$;

-- Cadastro de comprador/imobiliária: agora com CNPJ (consulta registrada ou manual).
drop function public.create_my_organization(text, public.organization_type, text, text, text);
create or replace function public.create_my_organization(
  p_name text,
  p_type public.organization_type,
  p_document_id text default null,
  p_city text default null,
  p_state text default null,
  p_cnpj_lookup_id uuid default null
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
  if not public.is_approved() and exists (
    select 1 from public.organization_members m where m.user_id = auth.uid()
  ) then
    raise exception 'Conta pendente já tem organização' using errcode = '42501';
  end if;

  insert into public.organizations (name, type, city, state, created_by)
  values (trim(p_name), p_type, nullif(trim(p_city), ''), nullif(trim(p_state), ''), auth.uid())
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (v_org, auth.uid(), 'admin', auth.uid());

  if nullif(regexp_replace(coalesce(p_document_id, ''), '\D', '', 'g'), '') is not null then
    perform public.apply_organization_cnpj(v_org, p_document_id, p_cnpj_lookup_id);
  end if;
  return v_org;
end;
$$;

-- Curadoria decide CNPJ manual ou com situação não ativa.
create or replace function public.review_organization_registry(p_org_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Recusa exige motivo' using errcode = '22023';
  end if;
  update public.organizations
     set verification_status = case when p_approve then 'verified' else 'unverified' end::public.org_verification,
         verification_note = nullif(trim(p_note), ''),
         active = case when p_approve then active else false end
   where id = p_org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- CRECI: níveis B e C
-- ---------------------------------------------------------------------------
create type public.creci_status as enum ('active', 'inactive', 'suspended', 'cancelled', 'unknown');
create type public.creci_type as enum ('PF', 'PJ');

alter table public.brokers
  add column creci_type public.creci_type not null default 'PF',
  add column creci_status public.creci_status not null default 'unknown',
  add column verification_method text not null default 'manual' check (verification_method in ('manual', 'auto')),
  add column source text,
  add column verified_name text,
  add column name_match_score numeric(4, 3),
  add column brokerage_org_id uuid references public.organizations (id),
  add column next_review_at timestamptz;

-- Quem já foi aprovado (Fase 1, documento conferido pela curadoria) entra como ativo, com reverificação agendada.
update public.brokers
   set creci_status = 'active', source = 'Fase 1 (documento conferido)',
       next_review_at = coalesce(verified_at, now()) + make_interval(months => 12)
 where verification_status = 'approved';

-- Comparação de nomes sem acento e caixa (0 a 1). Divergência é sinalizada à curadoria.
create or replace function public.name_match_score(a text, b text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when coalesce(trim(a), '') = '' or coalesce(trim(b), '') = '' then null else
    round(extensions.similarity(lower(extensions.unaccent(a)), lower(extensions.unaccent(b)))::numeric, 3) end;
$$;

-- Corretor apto: conta aprovada + CRECI conferido e com situação ATIVA.
create or replace function public.is_approved_broker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1 from public.brokers b
     where b.user_id = auth.uid() and b.verification_status = 'approved' and b.creci_status = 'active'
  );
$$;

-- Corretor editando o próprio cadastro: volta para a fila e zera o que é da curadoria.
create or replace function public.guard_broker_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin() then
    if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
      raise exception 'user_id do corretor não muda' using errcode = '42501';
    end if;
    -- Vínculo com imobiliária: só uma organização da qual a pessoa é membro.
    if new.brokerage_org_id is not null and not exists (
         select 1 from public.organization_members m
          where m.organization_id = new.brokerage_org_id and m.user_id = new.user_id) then
      raise exception 'Vincule uma imobiliária da qual você faz parte' using errcode = '42501';
    end if;
    new.verification_status := 'pending';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
    new.creci_status := 'unknown';
    new.verification_method := 'manual';
    new.source := null;
    new.verified_name := null;
    new.name_match_score := null;
    new.next_review_at := null;
  elsif new.verification_status = 'approved' and new.creci_status = 'unknown' then
    -- Carga de backend (seed, script) com CRECI já conferido entra como ativo.
    new.creci_status := 'active';
  end if;
  return new;
end;
$$;

-- Revisão (nível B) e reverificação (nível C) pela curadoria: situação do CRECI e nome como constam na consulta.
drop function public.review_broker(uuid, boolean, text);
create or replace function public.review_broker(
  p_user_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_creci_status public.creci_status default 'active',
  p_verified_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.user_email(p_user_id);
  v_ok boolean := p_approve and p_creci_status = 'active';
  v_reason text := case when p_approve and p_creci_status <> 'active'
                        then 'CRECI com situação ' || p_creci_status::text || coalesce('. ' || nullif(trim(p_reason), ''), '')
                        else nullif(trim(p_reason), '') end;
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria verifica CRECI' using errcode = '42501';
  end if;
  if not p_approve and v_reason is null then
    raise exception 'Rejeição exige motivo' using errcode = '22023';
  end if;

  update public.brokers b
     set verification_status = case when v_ok then 'approved' else 'rejected' end::public.verification_status,
         rejection_reason = case when v_ok then null else v_reason end,
         creci_status = case when p_approve then p_creci_status else b.creci_status end,
         verification_method = 'manual',
         source = case when p_approve then 'Consulta oficial CRECI-' || b.creci_state || ' (assistida)' end,
         verified_name = nullif(trim(p_verified_name), ''),
         name_match_score = public.name_match_score(
           p_verified_name, (select p.full_name from public.profiles p where p.user_id = b.user_id)),
         verified_by = auth.uid(), verified_at = now(),
         next_review_at = case when v_ok then now() + make_interval(months => public.setting_numeric('creci_review_months', 12)::int) end
   where user_id = p_user_id;
  if not found then
    raise exception 'Corretor não encontrado' using errcode = 'P0002';
  end if;

  if v_email is not null then
    perform public.enqueue_email(
      v_email, case when v_ok then 'creci_approved' else 'creci_rejected' end,
      case when v_ok then 'CRECI verificado' else 'CRECI não verificado' end,
      case when v_ok then 'Seu CRECI foi verificado. Você já pode cadastrar áreas.'
           else 'Seu CRECI não foi verificado. Motivo: ' || v_reason || '. Corrija e envie novamente.' end,
      jsonb_build_object('user_id', p_user_id, 'approved', v_ok));
  end if;
end;
$$;

-- Fila da curadoria: SLA do envio e reverificações vencidas.
create or replace function public.admin_broker_queue(p_include_reviewed boolean default false)
returns table (
  user_id uuid, full_name text, email text, account_status public.account_status,
  creci_number text, creci_state text, creci_type public.creci_type, creci_status public.creci_status,
  verification_status public.verification_status, document_path text, rejection_reason text,
  verified_name text, name_match_score numeric, brokerage_name text, brokerage_cnpj text,
  updated_at timestamptz, next_review_at timestamptz, sla_overdue boolean, review_due boolean, lookup_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_urls jsonb := coalesce((select value from public.platform_settings where key = 'creci_lookup_urls'), '{}');
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;
  return query
    select b.user_id, p.full_name, u.email::text, p.account_status,
           b.creci_number, b.creci_state, b.creci_type, b.creci_status, b.verification_status,
           b.document_path, b.rejection_reason, b.verified_name, b.name_match_score,
           o.name, o.cnpj, b.updated_at, b.next_review_at,
           (b.verification_status = 'pending'
              and b.updated_at < now() - make_interval(days => public.setting_numeric('creci_review_sla_days', 2)::int)),
           (b.verification_status = 'approved' and b.next_review_at is not null and b.next_review_at <= now()),
           v_urls ->> b.creci_state
      from public.brokers b
      join public.profiles p on p.user_id = b.user_id
      join auth.users u on u.id = b.user_id
      left join public.organizations o on o.id = b.brokerage_org_id
     where p_include_reviewed or b.verification_status = 'pending'
        or (b.next_review_at is not null and b.next_review_at <= now())
     order by (b.verification_status = 'pending') desc, b.updated_at;
end;
$$;

-- Link da consulta oficial para o próprio corretor (tela "Minha conta").
create or replace function public.creci_lookup_url(p_state text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select (select value from public.platform_settings where key = 'creci_lookup_urls') ->> upper(p_state);
$$;

-- Responsável publicável exige CRECI ativo (regra de 2.4 atualizada).
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

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke execute on function
  public.apply_organization_cnpj(uuid, text, uuid),
  public.create_my_organization(text, public.organization_type, text, text, text, uuid),
  public.review_organization_registry(uuid, boolean, text),
  public.review_broker(uuid, boolean, text, public.creci_status, text),
  public.admin_broker_queue(boolean),
  public.creci_lookup_url(text)
from public, anon;
grant execute on function
  public.apply_organization_cnpj(uuid, text, uuid),
  public.create_my_organization(text, public.organization_type, text, text, text, uuid),
  public.review_organization_registry(uuid, boolean, text),
  public.review_broker(uuid, boolean, text, public.creci_status, text),
  public.admin_broker_queue(boolean),
  public.creci_lookup_url(text),
  public.is_valid_cnpj(text),
  public.name_match_score(text, text)
to authenticated;
