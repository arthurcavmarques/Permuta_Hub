-- Fase 1 · Identidade completa: conta com aprovação (D014), organizações e membros, corretores
-- com CRECI, convites (D015), consentimentos de contato (regra 7/8) e RLS completa.
-- Reverter: supabase/rollbacks/20261010000001_identity_orgs.down.sql

-- ---------------------------------------------------------------------------
-- Endurecimento: objetos novos não ficam acessíveis a anon por padrão.
-- ---------------------------------------------------------------------------
-- (Funções continuam executáveis por PUBLIC por padrão do Postgres: cada RPC sensível revoga explicitamente.)
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.account_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.signup_kind as enum ('broker', 'buyer');
create type public.member_role as enum ('admin', 'broker', 'buyer', 'viewer');
create type public.verification_status as enum ('pending', 'approved', 'rejected');
create type public.contact_channel as enum ('whatsapp', 'email');
create type public.consent_purpose as enum ('privacy_policy', 'whatsapp', 'email');

-- SHA-256 em hex de um texto UTF-8 (banco é UTF8: determinístico, por isso imutável).
create or replace function public.sha256_hex(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

-- Cabeçalhos HTTP da requisição do PostgREST (IP e user-agent para registros de consentimento/acesso).
create or replace function public.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(split_part(
    coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}') ->> 'x-forwarded-for', ',', 1), '');
$$;

create or replace function public.request_user_agent()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}') ->> 'user-agent';
$$;

-- Chamada vinda do app (papel authenticated) e não de script/função privilegiada.
-- Funções SECURITY DEFINER rodam como o dono, então passam por aqui como "privilegiadas".
create or replace function public.is_app_user_call()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- ---------------------------------------------------------------------------
-- Perfis: status da conta (D014) e preferência de canal
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column account_status public.account_status not null default 'pending',
  add column signup_kind public.signup_kind,
  add column preferred_channel public.contact_channel,
  add column reviewed_by uuid references auth.users (id),
  add column reviewed_at timestamptz,
  add column review_note text;

-- Quem já existia foi criado à mão pelos admins (Fase 0): conta aprovada.
update public.profiles set account_status = 'approved', reviewed_at = now();

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.profiles p
                 where p.user_id = auth.uid() and p.account_status = 'approved');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Metadados vêm do próprio usuário no cadastro: só aceitamos valores conhecidos e nunca status.
  insert into public.profiles (user_id, full_name, phone, signup_kind)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    case when new.raw_user_meta_data ->> 'signup_kind' in ('broker', 'buyer')
         then (new.raw_user_meta_data ->> 'signup_kind')::public.signup_kind end
  );
  return new;
end;
$$;

-- O usuário edita nome/telefone/canal; status, revisão e opt-in só por admin ou por RPC.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin() and (
       new.user_id is distinct from old.user_id
    or new.account_status is distinct from old.account_status
    or new.signup_kind is distinct from old.signup_kind
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.review_note is distinct from old.review_note
    or new.whatsapp_opt_in is distinct from old.whatsapp_opt_in
    or new.opt_in_at is distinct from old.opt_in_at
    or new.opt_in_text_version is distinct from old.opt_in_text_version
  ) then
    raise exception 'Campo do perfil só pode ser alterado pela curadoria' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Organizações e membros
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column created_by uuid references auth.users (id),
  add column normalized_name text generated always as (lower(trim(regexp_replace(name, '\s+', ' ', 'g')))) stored;

create index organizations_normalized_name_idx on public.organizations (normalized_name);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);

create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id from public.organization_members m where m.user_id = auth.uid();
$$;

-- Admin DA ORGANIZAÇÃO (≠ is_admin(), D007). Só vale com a conta aprovada.
create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

-- Membro não muda o status "ativa" da organização; isso é da curadoria.
create or replace function public.guard_organization_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_app_user_call() and not public.is_admin()
     and (new.active is distinct from old.active or new.created_by is distinct from old.created_by) then
    raise exception 'Somente a curadoria ativa/desativa organizações' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organizations_guard before update on public.organizations
  for each row execute function public.guard_organization_update();

-- Cadastro de comprador: cria a própria organização e vira admin dela (D014).
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

-- ---------------------------------------------------------------------------
-- Corretores e verificação de CRECI (seção 9.5)
-- ---------------------------------------------------------------------------
create table public.brokers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  creci_number text not null,
  creci_state text not null default 'RS',
  verification_status public.verification_status not null default 'pending',
  document_path text,
  rejection_reason text,
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (creci_state ~ '^[A-Z]{2}$')
);

create index brokers_status_idx on public.brokers (verification_status);

-- O próprio corretor envia/corrige o CRECI; qualquer alteração dele volta para a fila.
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
    new.verification_status := 'pending';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger brokers_guard before insert or update on public.brokers
  for each row execute function public.guard_broker_write();

create or replace function public.is_approved_broker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and exists (
    select 1 from public.brokers b where b.user_id = auth.uid() and b.verification_status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- Consentimentos de contato (regras 7 e 8) — livro-razão append-only
-- ---------------------------------------------------------------------------
-- Textos versionados e imutáveis: o consentimento aponta para a versão exata que a pessoa viu.
create table public.consent_texts (
  id uuid primary key default gen_random_uuid(),
  purpose public.consent_purpose not null,
  version text not null,
  body text not null,
  body_hash text generated always as (public.sha256_hex(body)) stored,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purpose, version)
);

create unique index consent_texts_one_active_idx on public.consent_texts (purpose) where active;

-- Texto publicado não muda (só pode deixar de ser o ativo); versão nova = linha nova.
create or replace function public.guard_consent_text_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body or new.version is distinct from old.version
     or new.purpose is distinct from old.purpose then
    raise exception 'Texto de consentimento é imutável: crie nova versão' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger consent_texts_guard before update on public.consent_texts
  for each row execute function public.guard_consent_text_update();
create trigger consent_texts_no_delete before delete on public.consent_texts
  for each row execute function public.reject_mutation();

insert into public.consent_texts (purpose, version, body, active) values
  ('privacy_policy', '2026-10-v1',
   '[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO] Li e aceito a Política de Privacidade e os Termos de Uso da plataforma.', true),
  ('whatsapp', '2026-10-v1',
   '[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO] Aceito receber oportunidades por WhatsApp. Posso sair a qualquer momento respondendo SAIR.', true),
  ('email', '2026-10-v1',
   '[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO] Aceito receber oportunidades por e-mail. Posso cancelar a qualquer momento.', true);

-- Cada concessão OU revogação é uma linha nova (append-only). Estado atual = linha mais recente.
-- user_id para usuários; contact (telefone/e-mail) para quem não tem conta (ex.: leads, Fase 2).
create table public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  contact text,
  purpose public.consent_purpose not null,
  granted boolean not null,
  consent_text_id uuid not null references public.consent_texts (id),
  text_version text not null,
  text_hash text not null,
  ip text,
  user_agent text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (user_id is not null or contact is not null)
);

create index contact_consents_user_idx on public.contact_consents (user_id, purpose, at desc);

create trigger contact_consents_append_only before update or delete on public.contact_consents
  for each row execute function public.reject_mutation();
create trigger contact_consents_no_truncate before truncate on public.contact_consents
  for each statement execute function public.reject_mutation();

create view public.current_contact_consents
with (security_invoker = true)
as
select distinct on (c.user_id, c.purpose)
  c.user_id, c.purpose, c.granted, c.text_version, c.at
from public.contact_consents c
where c.user_id is not null
order by c.user_id, c.purpose, c.at desc, c.created_at desc;

-- Registra consentimento do usuário logado com o texto ATIVO (versão/hash/IP/UA/timestamp).
create or replace function public.record_consent(p_purpose public.consent_purpose, p_granted boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text public.consent_texts;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Login necessário' using errcode = '42501';
  end if;
  select * into v_text from public.consent_texts where purpose = p_purpose and active;
  if not found then
    raise exception 'Sem texto ativo para %', p_purpose using errcode = '22023';
  end if;

  insert into public.contact_consents
    (user_id, purpose, granted, consent_text_id, text_version, text_hash, ip, user_agent)
  values
    (auth.uid(), p_purpose, p_granted, v_text.id, v_text.version, v_text.body_hash,
     public.request_ip(), public.request_user_agent())
  returning id into v_id;

  -- Espelho no perfil para consultas rápidas (regra 8: só envia WhatsApp com opt-in).
  if p_purpose = 'whatsapp' then
    update public.profiles
       set whatsapp_opt_in = p_granted,
           opt_in_at = case when p_granted then now() end,
           opt_in_text_version = case when p_granted then v_text.version end
     where user_id = auth.uid();
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Caixa de saída de e-mail (D015). Funções enfileiram; um worker com EmailProvider envia.
-- ---------------------------------------------------------------------------
create type public.outbox_status as enum ('queued', 'sent', 'failed');

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template_key text not null,
  subject text not null,
  body_text text not null,
  payload jsonb not null default '{}',
  status public.outbox_status not null default 'queued',
  attempts integer not null default 0,
  provider text,
  provider_ref text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_outbox_status_idx on public.email_outbox (status, created_at);

create or replace function public.setting_text_or_null(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value #>> '{}' from public.platform_settings where key = p_key;
$$;

insert into public.platform_settings (key, value, description) values
  ('app_base_url', '"http://localhost:5173"', 'URL pública do app, usada em links de convite e e-mails. Produção: atualizar.'),
  ('invitation_ttl_days', '7', 'Validade dos convites, em dias (D015).');

create or replace function public.enqueue_email(
  p_to text, p_template_key text, p_subject text, p_body text, p_payload jsonb default '{}'
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.email_outbox (to_email, template_key, subject, body_text, payload)
  values (p_to, p_template_key, p_subject, p_body, coalesce(p_payload, '{}'))
  returning id;
$$;

create or replace function public.user_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text from auth.users u where u.id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- Revisão pela curadoria: conta e CRECI
-- ---------------------------------------------------------------------------
create or replace function public.review_account(
  p_user_id uuid, p_status public.account_status, p_note text default null
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
    raise exception 'Somente a curadoria revisa contas' using errcode = '42501';
  end if;
  if p_status = 'pending' then
    raise exception 'Revisão precisa decidir (aprovar, rejeitar ou suspender)' using errcode = '22023';
  end if;

  update public.profiles
     set account_status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(trim(p_note), '')
   where user_id = p_user_id;
  if not found then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;

  if v_email is not null then
    perform public.enqueue_email(
      v_email, 'account_' || p_status::text,
      case p_status when 'approved' then 'Sua conta foi aprovada'
                    when 'rejected' then 'Sua conta não foi aprovada'
                    else 'Sua conta foi suspensa' end,
      case p_status when 'approved' then 'Sua conta foi aprovada. Acesse: ' || coalesce(public.setting_text_or_null('app_base_url'), '')
                    else 'Situação da sua conta: ' || p_status::text || coalesce('. Motivo: ' || nullif(trim(p_note), ''), '') end,
      jsonb_build_object('user_id', p_user_id, 'status', p_status));
  end if;
end;
$$;

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

-- Lista para o painel admin (inclui e-mail do Auth, que não fica em tabela pública).
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  account_status public.account_status,
  signup_kind public.signup_kind,
  is_platform_admin boolean,
  creci_number text,
  creci_state text,
  broker_status public.verification_status,
  organizations jsonb,
  created_at timestamptz,
  reviewed_at timestamptz
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
    select p.user_id, u.email::text, p.full_name, p.phone, p.account_status, p.signup_kind,
           exists (select 1 from public.platform_admins pa where pa.user_id = p.user_id),
           b.creci_number, b.creci_state, b.verification_status,
           coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role) order by o.name)
                       from public.organization_members m join public.organizations o on o.id = m.organization_id
                      where m.user_id = p.user_id), '[]'::jsonb),
           p.created_at, p.reviewed_at
      from public.profiles p
      join auth.users u on u.id = p.user_id
      left join public.brokers b on b.user_id = p.user_id
     order by (p.account_status = 'pending') desc, p.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Convites (D015): link com token aleatório; só o hash fica no banco.
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.member_role not null,
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email = lower(trim(email)))
);

create index invitations_org_idx on public.invitations (organization_id, created_at desc);

create or replace function public.hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.sha256_hex(p_token);
$$;

-- Retorna o token em claro UMA vez (para o link); o banco guarda só o hash.
create or replace function public.create_invitation(
  p_organization_id uuid, p_email text, p_role public.member_role
)
returns table (invitation_id uuid, token text, accept_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_email text := lower(trim(p_email));
  v_id uuid;
  v_org_name text;
  v_url text;
begin
  if not (public.is_admin() or public.is_org_admin(p_organization_id)) then
    raise exception 'Sem permissão para convidar nesta organização' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido' using errcode = '22023';
  end if;
  select name into v_org_name from public.organizations where id = p_organization_id and active;
  if v_org_name is null then
    raise exception 'Organização inexistente ou inativa' using errcode = 'P0002';
  end if;

  -- Convite novo substitui convites abertos para o mesmo e-mail na mesma organização.
  update public.invitations set revoked_at = now()
   where organization_id = p_organization_id and email = v_email
     and accepted_at is null and revoked_at is null;

  insert into public.invitations (organization_id, email, role, token_hash, invited_by, expires_at)
  values (p_organization_id, v_email, p_role, public.hash_token(v_token), auth.uid(),
          now() + make_interval(days => public.setting_numeric('invitation_ttl_days', 7)::int))
  returning id into v_id;

  v_url := rtrim(coalesce(public.setting_text_or_null('app_base_url'), ''), '/') || '/convite/' || v_token;

  perform public.enqueue_email(
    v_email, 'invitation', 'Convite para ' || v_org_name,
    'Você foi convidado(a) para participar de ' || v_org_name || '. Aceite em: ' || v_url,
    jsonb_build_object('invitation_id', v_id, 'organization_id', p_organization_id));

  return query select v_id, v_token, v_url;
end;
$$;

-- Prévia pública do convite (tela de aceite antes do login). Não revela nada além do necessário.
create or replace function public.get_invitation_preview(p_token text)
returns table (organization_name text, email text, role public.member_role, valid boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, i.email, i.role,
         (i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and o.active)
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
   where i.token_hash = public.hash_token(p_token);
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if auth.uid() is null then
    raise exception 'Login necessário' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations where token_hash = public.hash_token(p_token) for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'Convite inválido, expirado ou já usado' using errcode = '22023';
  end if;
  -- O convite é pessoal: o link encaminhado a outra pessoa não funciona.
  if lower(public.user_email(auth.uid())) <> v_inv.email then
    raise exception 'Este convite é para outro e-mail' using errcode = '42501';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (v_inv.organization_id, auth.uid(), v_inv.role, v_inv.invited_by)
  on conflict (organization_id, user_id) do update set role = excluded.role;

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;

  -- Convite de curadoria ou de admin de organização aprovada vale como aprovação da conta (D014).
  update public.profiles
     set account_status = 'approved', reviewed_by = v_inv.invited_by, reviewed_at = now(),
         review_note = 'Aprovado por convite'
   where user_id = auth.uid() and account_status = 'pending';

  return v_inv.organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Oportunidades: corretor aprovado cadastra e acompanha as próprias áreas (D014)
-- ---------------------------------------------------------------------------
create sequence public.platform_memorial_seq;

-- Área cadastrada na plataforma sem número do Land Bank recebe número próprio.
create or replace function public.opportunity_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.memorial_number is null or trim(new.memorial_number) = '' then
    new.memorial_number := 'PH-' || lpad(nextval('public.platform_memorial_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger opportunities_defaults before insert on public.opportunities
  for each row execute function public.opportunity_defaults();

-- Corretor não muda status, responsável, mandato nem publicação: isso é da curadoria.
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

create trigger opportunities_guard before insert or update on public.opportunities
  for each row execute function public.guard_opportunity_write();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create trigger organization_members_updated_at before update on public.organization_members for each row execute function public.set_updated_at();
create trigger brokers_updated_at before update on public.brokers for each row execute function public.set_updated_at();
create trigger consent_texts_updated_at before update on public.consent_texts for each row execute function public.set_updated_at();
create trigger email_outbox_updated_at before update on public.email_outbox for each row execute function public.set_updated_at();
create trigger invitations_updated_at before update on public.invitations for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organization_members enable row level security;
alter table public.brokers enable row level security;
alter table public.consent_texts enable row level security;
alter table public.contact_consents enable row level security;
alter table public.email_outbox enable row level security;
alter table public.invitations enable row level security;

-- profiles: além do próprio e do admin, colegas de organização se veem (nome).
create policy profiles_select_colleagues on public.profiles for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.user_id = profiles.user_id and m.organization_id in (select public.user_org_ids())
  ));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- organizations: membro lê a sua; admin da organização edita a sua; criação pela RPC.
create policy organizations_member_select on public.organizations for select to authenticated
  using (id in (select public.user_org_ids()));
create policy organizations_org_admin_update on public.organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- organization_members: membros veem a composição da própria organização; admin da organização gerencia.
create policy organization_members_select on public.organization_members for select to authenticated
  using ((select public.is_admin()) or organization_id in (select public.user_org_ids()));
create policy organization_members_admin_all on public.organization_members for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy organization_members_org_admin_update on public.organization_members for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy organization_members_org_admin_delete on public.organization_members for delete to authenticated
  using (public.is_org_admin(organization_id) and user_id <> (select auth.uid()));
create policy organization_members_leave on public.organization_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- brokers: o próprio corretor e a curadoria.
create policy brokers_select on public.brokers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy brokers_insert_own on public.brokers for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy brokers_update_own on public.brokers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy brokers_admin_all on public.brokers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- consent_texts: textos são públicos para logados (a pessoa precisa ler antes de aceitar).
create policy consent_texts_select on public.consent_texts for select to authenticated using (true);
create policy consent_texts_admin_insert on public.consent_texts for insert to authenticated
  with check ((select public.is_admin()));
create policy consent_texts_admin_update on public.consent_texts for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- contact_consents: titular e curadoria leem; escrita só pela RPC record_consent.
create policy contact_consents_select on public.contact_consents for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- email_outbox: só curadoria lê (contém links de convite). Escrita só por funções.
create policy email_outbox_admin_select on public.email_outbox for select to authenticated
  using ((select public.is_admin()));

-- invitations: curadoria e admin da organização; criação/aceite pelas RPCs.
create policy invitations_select on public.invitations for select to authenticated
  using ((select public.is_admin()) or public.is_org_admin(organization_id));
create policy invitations_revoke on public.invitations for update to authenticated
  using ((select public.is_admin()) or public.is_org_admin(organization_id))
  with check ((select public.is_admin()) or public.is_org_admin(organization_id));

-- opportunities: corretor aprovado cadastra como responsável e acompanha as suas.
create policy opportunities_broker_insert on public.opportunities for insert to authenticated
  with check (public.is_approved_broker() and responsible_party_user_id = (select auth.uid()));
create policy opportunities_broker_select on public.opportunities for select to authenticated
  using (responsible_party_user_id = (select auth.uid()) and public.is_approved());
create policy opportunities_broker_update on public.opportunities for update to authenticated
  using (responsible_party_user_id = (select auth.uid()) and public.is_approved_broker()
         and status in ('captured', 'qualifying'))
  with check (responsible_party_user_id = (select auth.uid()));

-- Privilégios de coluna: invitations só pode ser revogado (revoked_at) pelo app.
revoke update on public.invitations from authenticated;
grant update (revoked_at) on public.invitations to authenticated;

-- anon: nada de tabela; só a prévia de convite.
revoke all on public.organization_members, public.brokers, public.consent_texts, public.contact_consents,
  public.email_outbox, public.invitations from anon;
revoke all on public.current_contact_consents from anon;
revoke update, delete, truncate on public.contact_consents from authenticated, service_role;
revoke insert on public.contact_consents, public.email_outbox from authenticated;

revoke execute on function
  public.create_my_organization(text, public.organization_type, text, text, text),
  public.record_consent(public.consent_purpose, boolean),
  public.review_account(uuid, public.account_status, text),
  public.review_broker(uuid, boolean, text),
  public.admin_list_users(),
  public.create_invitation(uuid, text, public.member_role),
  public.accept_invitation(text),
  public.get_invitation_preview(text),
  public.enqueue_email(text, text, text, text, jsonb),
  public.user_email(uuid)
from public, anon;

grant execute on function
  public.create_my_organization(text, public.organization_type, text, text, text),
  public.record_consent(public.consent_purpose, boolean),
  public.review_account(uuid, public.account_status, text),
  public.review_broker(uuid, boolean, text),
  public.admin_list_users(),
  public.create_invitation(uuid, text, public.member_role),
  public.accept_invitation(text),
  public.get_invitation_preview(text)
to authenticated;
grant execute on function public.get_invitation_preview(text) to anon;
-- Uso interno (funções da curadoria): fora do alcance do app.
revoke execute on function public.enqueue_email(text, text, text, text, jsonb), public.user_email(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Storage: documentos de CRECI (privado). Caminho: <user_id>/<arquivo>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('broker-documents', 'broker-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy broker_documents_own on storage.objects for all to authenticated
  using (bucket_id = 'broker-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'broker-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy broker_documents_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'broker-documents' and (select public.is_admin()));
