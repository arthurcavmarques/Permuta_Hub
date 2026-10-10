-- Fase 1 · Registro imutável de apresentações (regra 2): distributions + distribution_events
-- append-only (D016), cadeia de hashes (D017), histórico legado (D018), visibilidade do dossiê
-- cego para destinatários e configuração dos adapters (integration_settings, seção 6.4).
-- Reverter: supabase/rollbacks/20261010000002_distributions_append_only.down.sql

-- ---------------------------------------------------------------------------
-- Cadeia de hashes (D017): cada linha carrega o hash da anterior.
-- Requer colunas seq (ordem, atribuída pelo trigger), prev_hash e row_hash. Hash = SHA-256(prev_hash || conteúdo).
-- ---------------------------------------------------------------------------
create or replace function public.chain_row_payload(p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select (p_row - 'prev_hash' - 'row_hash')::text;
$$;

create or replace function public.chain_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seq bigint;
  v_prev text;
begin
  -- Serializa inserções na mesma tabela e numera DENTRO do lock: a ordem da cadeia é a ordem
  -- real de gravação, mesmo com transações concorrentes (o lock só sai no commit).
  perform pg_advisory_xact_lock(hashtext(tg_table_schema || '.' || tg_table_name));
  execute format('select seq, row_hash from %I.%I order by seq desc limit 1', tg_table_schema, tg_table_name)
    into v_seq, v_prev;
  new.seq := coalesce(v_seq, 0) + 1;
  new.prev_hash := coalesce(v_prev, '');
  new.row_hash := public.sha256_hex(new.prev_hash || public.chain_row_payload(to_jsonb(new)));
  return new;
end;
$$;

-- Para funções SECURITY DEFINER (onde current_user é o dono): curadoria, ou chamada sem JWT de
-- usuário (migration, seed, script com service_role).
create or replace function public.is_admin_or_backend()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.is_admin() or coalesce(auth.role(), '') not in ('anon', 'authenticated');
$fn$;

-- Primeira linha adulterada (ou null se íntegra). Só curadoria.
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

-- access_log (Fase 0) entra na cadeia: linhas antigas recebem hash em ordem cronológica.
alter table public.access_log
  add column seq bigint,
  add column prev_hash text,
  add column row_hash text;

alter table public.access_log disable trigger access_log_append_only;
do $$
declare
  r record;
  v_prev text := '';
  v_hash text;
begin
  for r in select a.id, a.seq from public.access_log a order by a.at, a.created_at, a.id loop
    update public.access_log set seq = coalesce((select max(seq) from public.access_log), 0) + 1 where id = r.id;
  end loop;
  for r in select a.id, to_jsonb(a) as j from public.access_log a order by a.seq loop
    v_hash := public.sha256_hex(v_prev || public.chain_row_payload(r.j));
    update public.access_log set prev_hash = v_prev, row_hash = v_hash where id = r.id;
    v_prev := v_hash;
  end loop;
end;
$$;
alter table public.access_log enable trigger access_log_append_only;

alter table public.access_log
  alter column seq set not null, alter column prev_hash set not null, alter column row_hash set not null;
create unique index access_log_seq_idx on public.access_log (seq);

create trigger access_log_chain before insert on public.access_log
  for each row execute function public.chain_hash();

-- ---------------------------------------------------------------------------
-- Distribuições (D016): só fatos iniciais; estado em distribution_events.
-- ---------------------------------------------------------------------------
create type public.distribution_source as enum ('platform', 'legacy');
create type public.distribution_event_type as enum
  ('queued', 'sent', 'delivered', 'read', 'opened', 'interested', 'declined', 'failed', 'opt_out');

create table public.distributions (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  opportunity_id uuid not null references public.opportunities (id),
  recipient_user_id uuid references auth.users (id),
  recipient_org_id uuid references public.organizations (id),
  thesis_id uuid,  -- FK para buyer_theses na Fase 3
  match_id uuid,   -- FK para matches na Fase 3
  channel public.contact_channel,
  source public.distribution_source not null default 'platform',
  template_id uuid, -- FK para message_templates na Fase 4
  message_body_snapshot text,
  link_token_hash text unique,
  link_expires_at timestamptz,
  idempotency_key text not null unique,
  legacy_note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  prev_hash text not null,
  row_hash text not null,
  check (recipient_user_id is not null or recipient_org_id is not null),
  check (source = 'legacy' or channel is not null)
);

create unique index distributions_seq_idx on public.distributions (seq);
create index distributions_opp_idx on public.distributions (opportunity_id);
create index distributions_recipient_user_idx on public.distributions (recipient_user_id);
create index distributions_recipient_org_idx on public.distributions (recipient_org_id);

create table public.distribution_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  distribution_id uuid not null references public.distributions (id),
  event public.distribution_event_type not null,
  at timestamptz not null default now(),
  meta jsonb not null default '{}',
  actor_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  prev_hash text not null,
  row_hash text not null
);

create unique index distribution_events_seq_idx on public.distribution_events (seq);
create index distribution_events_dist_idx on public.distribution_events (distribution_id, at desc);

-- Append-only para todos (inclusive service_role e dono): triggers + sem privilégio.
create trigger distributions_chain before insert on public.distributions
  for each row execute function public.chain_hash();
create trigger distributions_append_only before update or delete on public.distributions
  for each row execute function public.reject_mutation();
create trigger distributions_no_truncate before truncate on public.distributions
  for each statement execute function public.reject_mutation();

create trigger distribution_events_chain before insert on public.distribution_events
  for each row execute function public.chain_hash();
create trigger distribution_events_append_only before update or delete on public.distribution_events
  for each row execute function public.reject_mutation();
create trigger distribution_events_no_truncate before truncate on public.distribution_events
  for each statement execute function public.reject_mutation();

revoke update, delete, truncate on public.distributions, public.distribution_events
  from anon, authenticated, service_role;

-- Estado atual = último evento. Legado sem eventos aparece como 'legacy'.
create view public.distribution_status
with (security_invoker = true)
as
select
  d.id as distribution_id,
  d.opportunity_id,
  d.recipient_user_id,
  d.recipient_org_id,
  d.channel,
  d.source,
  d.created_at,
  coalesce(e.event::text, case when d.source = 'legacy' then 'legacy' else 'queued' end) as status,
  e.at as status_at
from public.distributions d
left join lateral (
  select ev.event, ev.at from public.distribution_events ev
  where ev.distribution_id = d.id
  order by ev.at desc, ev.seq desc
  limit 1
) e on true;

-- ---------------------------------------------------------------------------
-- Histórico legado "oferecida para" (D018) — idempotente.
-- ---------------------------------------------------------------------------
create or replace function public.import_legacy_distributions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_org uuid;
  v_count integer := 0;
begin
  if not public.is_admin_or_backend() then
    raise exception 'Somente a curadoria' using errcode = '42501';
  end if;

  for r in
    select o.id as opportunity_id, o.memorial_number, trim(c.company) as company,
           o.extra -> 'legacy_offered_to' ->> 'raw' as raw
      from public.opportunities o
      cross join lateral jsonb_array_elements_text(o.extra -> 'legacy_offered_to' -> 'companies') as c(company)
     where jsonb_typeof(o.extra -> 'legacy_offered_to' -> 'companies') = 'array'
       and trim(c.company) <> ''
  loop
    select id into v_org from public.organizations
     where normalized_name = lower(trim(regexp_replace(r.company, '\s+', ' ', 'g')))
     order by created_at limit 1;
    if v_org is null then
      insert into public.organizations (name, type) values (r.company, 'other') returning id into v_org;
    end if;

    insert into public.distributions
      (opportunity_id, recipient_org_id, source, idempotency_key, legacy_note)
    values
      (r.opportunity_id, v_org, 'legacy', 'legacy:' || r.opportunity_id || ':' || v_org,
       'Land Bank: ' || coalesce(r.raw, r.company))
    on conflict (idempotency_key) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
    v_org := null;
  end loop;
  return v_count;
end;
$$;

select public.import_legacy_distributions();

-- ---------------------------------------------------------------------------
-- Dossiê cego: além da curadoria, o corretor responsável e quem recebeu a área pela plataforma.
-- Conta precisa estar aprovada. Legado não dá acesso (as empresas do Land Bank não têm usuários).
-- ---------------------------------------------------------------------------
create or replace function public.can_view_blind(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_approved() and (
           exists (select 1 from public.opportunities o
                   where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid())
        or exists (select 1 from public.distributions d
                   where d.opportunity_id = p_opportunity_id and d.source = 'platform'
                     and (d.recipient_user_id = auth.uid()
                          or d.recipient_org_id in (select public.user_org_ids())))
      ));
$$;

-- Termo válido (Fase 5: agreements). Até lá, ninguém além da curadoria lê dado sensível.
create or replace function public.has_valid_agreement(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

-- ---------------------------------------------------------------------------
-- Configuração dos adapters (seção 6.4). Só nomes de provedor e config NÃO secreta.
-- ---------------------------------------------------------------------------
create table public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  capability text not null unique
    check (capability in ('email', 'messaging', 'agreement_signer', 'broker_verifier', 'map', 'billing')),
  provider text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.integration_settings (capability, provider, config) values
  ('email', 'log', '{}'),
  ('messaging', 'log', '{}'),
  ('agreement_signer', 'internal_hash', '{}'),
  ('broker_verifier', 'manual_queue', '{}'),
  ('map', 'maplibre_openfreemap', '{"style": "positron"}'),
  ('billing', 'none', '{}');

create trigger integration_settings_updated_at before update on public.integration_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.distributions enable row level security;
alter table public.distribution_events enable row level security;
alter table public.integration_settings enable row level security;

-- Curadoria lê tudo; destinatário lê o que recebeu. Ninguém insere pelo app (Fase 4: motor de envio).
create policy distributions_select on public.distributions for select to authenticated
  using ((select public.is_admin())
         or recipient_user_id = (select auth.uid())
         or recipient_org_id in (select public.user_org_ids()));
create policy distribution_events_select on public.distribution_events for select to authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.distributions d
    where d.id = distribution_events.distribution_id
      and (d.recipient_user_id = (select auth.uid()) or d.recipient_org_id in (select public.user_org_ids()))));

create policy integration_settings_select on public.integration_settings for select to authenticated
  using ((select public.is_admin()));
create policy integration_settings_admin_update on public.integration_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.distributions, public.distribution_events, public.integration_settings,
  public.distribution_status from anon;
revoke insert on public.distributions, public.distribution_events from authenticated;

revoke execute on function public.verify_hash_chain(text), public.import_legacy_distributions() from public, anon;
grant execute on function public.verify_hash_chain(text), public.import_legacy_distributions() to authenticated;
