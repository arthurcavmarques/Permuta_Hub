-- Fase 2 · Bloco 2.2 — Porta do proprietário (D021).
-- Proprietário com login (signup_kind = owner) e formulário público sem login: ambos geram owner_leads.
-- O proprietário vê só as próprias áreas, com números AGREGADOS de destinatários e interessados (regra 3).
-- Reverter: supabase/rollbacks/20261019000003_owner_leads.down.sql

-- ---------------------------------------------------------------------------
-- Perfil proprietário
-- ---------------------------------------------------------------------------

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
    case when new.raw_user_meta_data ->> 'signup_kind' in ('broker', 'buyer', 'owner')
         then (new.raw_user_meta_data ->> 'signup_kind')::public.signup_kind end
  );
  return new;
end;
$$;

-- Proprietário usa a própria área mesmo com a conta em análise (o lead já passa pela curadoria).
create or replace function public.is_owner_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                  where p.user_id = auth.uid() and p.signup_kind = 'owner'
                    and p.account_status in ('pending', 'approved'));
$$;

-- Termo do proprietário: aceito por conta de proprietário, mesmo pendente.
create or replace function public.can_accept_agreement(p_type public.agreement_type, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and case p_type
    when 'owner_terms' then public.is_owner_account()
    else public.is_approved() and case p_type
      -- Comprador: só para área que recebeu pela plataforma.
      when 'non_circumvention' then exists (
        select 1 from public.distributions d
         where d.opportunity_id = p_opportunity_id and d.source = 'platform'
           and (d.recipient_user_id = auth.uid() or d.recipient_org_id in (select public.user_org_ids())))
      when 'broker_partnership' then exists (select 1 from public.brokers b where b.user_id = auth.uid())
      -- Por área: corretor responsável pela área.
      when 'broker_area_authorization' then exists (
        select 1 from public.opportunities o
         where o.id = p_opportunity_id and o.responsible_party_user_id = auth.uid())
      else true
    end
  end;
$$;

-- ---------------------------------------------------------------------------
-- Leads de captação
-- ---------------------------------------------------------------------------
create type public.respondent_relation as enum ('owner', 'authorized_intermediary', 'knows_owner');
create type public.lead_status as enum ('new', 'qualifying', 'forwarded', 'discarded', 'converted');
create type public.lead_source as enum ('public_form', 'owner_account');

create table public.owner_leads (
  id uuid primary key default gen_random_uuid(),
  respondent_relation public.respondent_relation not null,
  location_text text not null,
  city text not null,
  neighborhood text,
  state text not null default 'RS' check (state ~ '^[A-Z]{2}$'),
  approx_area_m2 numeric(14, 2) check (approx_area_m2 is null or approx_area_m2 > 0),
  negotiation_models public.negotiation_model[] not null default '{}',
  notes text,
  -- Contato de quem respondeu (dado pessoal: só curadoria e o próprio proprietário leem).
  name text not null,
  phone text,
  email text,
  owner_user_id uuid references auth.users (id),
  consent_id uuid references public.contact_consents (id),
  status public.lead_status not null default 'new',
  status_note text,
  assigned_to uuid references auth.users (id), -- corretor que vai atender
  source public.lead_source not null,
  utm jsonb not null default '{}',
  ip text,
  converted_opportunity_id uuid references public.opportunities (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create index owner_leads_status_idx on public.owner_leads (status, created_at desc);
create index owner_leads_owner_idx on public.owner_leads (owner_user_id);
create index owner_leads_ip_idx on public.owner_leads (ip, created_at desc);

alter table public.opportunities
  add constraint opportunities_origin_lead_fk foreign key (origin_lead_id) references public.owner_leads (id);

create trigger owner_leads_updated_at before update on public.owner_leads
  for each row execute function public.set_updated_at();

insert into public.platform_settings (key, value, description) values
  ('lead_rate_limit_per_hour', '5', 'Formulário de captação: máximo de envios por IP por hora (anti-spam).'),
  ('lead_rate_limit_per_contact_day', '3', 'Formulário de captação: máximo de envios por telefone/e-mail por dia.');

-- Consentimento de quem não tem conta (lead anônimo): contact em vez de user_id.
create or replace function public.record_contact_consent(p_contact text, p_purpose public.consent_purpose)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text public.consent_texts;
  v_id uuid;
begin
  select * into v_text from public.consent_texts where purpose = p_purpose and active;
  if not found then
    raise exception 'Sem texto ativo para %', p_purpose using errcode = '22023';
  end if;
  insert into public.contact_consents
    (user_id, contact, purpose, granted, consent_text_id, text_version, text_hash, ip, user_agent)
  values
    (auth.uid(), p_contact, p_purpose, true, v_text.id, v_text.version, v_text.body_hash,
     public.request_ip(), public.request_user_agent())
  returning id into v_id;
  return v_id;
end;
$$;

-- Envio do formulário (público ou do proprietário logado). Validação no servidor, honeypot e rate limit.
create or replace function public.submit_owner_lead(
  p_relation public.respondent_relation,
  p_location_text text,
  p_city text,
  p_neighborhood text,
  p_state text,
  p_approx_area_m2 numeric,
  p_negotiation_models public.negotiation_model[],
  p_notes text,
  p_name text,
  p_phone text,
  p_email text,
  p_privacy_accepted boolean,
  p_honeypot text default null,
  p_utm jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := public.request_ip();
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(trim(p_phone), '');
  v_contact text;
  v_consent uuid;
  v_id uuid;
  v_logged boolean := auth.uid() is not null;
begin
  -- Robô preencheu o campo invisível: responde "ok" sem gravar nada.
  if coalesce(trim(p_honeypot), '') <> '' then
    return null;
  end if;
  if v_logged and not public.is_owner_account() then
    raise exception 'Cadastro de área por esta porta é para proprietários' using errcode = '42501';
  end if;
  if v_logged and not public.has_agreement('owner_terms', null) then
    raise exception 'Aceite o termo do proprietário antes de cadastrar' using errcode = '42501';
  end if;
  if not coalesce(p_privacy_accepted, false) then
    raise exception 'É preciso aceitar a política de privacidade' using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_city), '') = '' or coalesce(trim(p_location_text), '') = '' then
    raise exception 'Nome, cidade e localização são obrigatórios' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Informe telefone ou e-mail' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 or length(p_location_text) > 500 then
    raise exception 'Texto longo demais' using errcode = '22023';
  end if;

  -- Rate limit (anti-spam): por IP e por contato.
  if v_ip is not null and (select count(*) from public.owner_leads
       where ip = v_ip and created_at > now() - interval '1 hour')
     >= public.setting_numeric('lead_rate_limit_per_hour', 5) then
    raise exception 'Muitos envios. Tente mais tarde.' using errcode = '54000';
  end if;
  if (select count(*) from public.owner_leads
       where created_at > now() - interval '1 day'
         and ((v_email is not null and email = v_email) or (v_phone is not null and phone = v_phone)))
     >= public.setting_numeric('lead_rate_limit_per_contact_day', 3) then
    raise exception 'Muitos envios. Tente mais tarde.' using errcode = '54000';
  end if;

  v_contact := coalesce(v_email, v_phone);
  v_consent := public.record_contact_consent(v_contact, 'privacy_policy');

  insert into public.owner_leads
    (respondent_relation, location_text, city, neighborhood, state, approx_area_m2, negotiation_models, notes,
     name, phone, email, owner_user_id, consent_id, source, utm, ip)
  values
    (p_relation, trim(p_location_text), trim(p_city), nullif(trim(p_neighborhood), ''),
     coalesce(nullif(upper(trim(p_state)), ''), 'RS'), p_approx_area_m2, coalesce(p_negotiation_models, '{}'),
     nullif(trim(p_notes), ''), trim(p_name), v_phone, v_email, auth.uid(), v_consent,
     case when v_logged then 'owner_account' else 'public_form' end::public.lead_source,
     coalesce(p_utm, '{}'), v_ip)
  returning id into v_id;
  return v_id;
end;
$$;

-- "Minhas áreas" do proprietário: status, responsável e números agregados. Nunca identifica comprador.
create or replace function public.owner_my_areas()
returns table (
  lead_id uuid,
  location_text text,
  city text,
  neighborhood text,
  approx_area_m2 numeric,
  lead_status public.lead_status,
  created_at timestamptz,
  memorial_number text,
  opportunity_status public.opportunity_status,
  awaiting_responsible boolean,
  responsible_name text,
  responsible_phone text,
  recipients_count integer,
  interested_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.location_text, l.city, l.neighborhood, l.approx_area_m2, l.status, l.created_at,
         o.memorial_number, o.status,
         (o.id is not null and o.responsible_party_user_id is null),
         rp.full_name, rp.phone,
         coalesce((select count(distinct coalesce(d.recipient_org_id, d.recipient_user_id))::int
                     from public.distributions d
                    where d.opportunity_id = o.id and d.source = 'platform'), 0),
         coalesce((select count(distinct coalesce(d.recipient_org_id, d.recipient_user_id))::int
                     from public.distributions d
                     join public.distribution_events e on e.distribution_id = d.id and e.event = 'interested'
                    where d.opportunity_id = o.id and d.source = 'platform'), 0)
    from public.owner_leads l
    left join public.opportunities o on o.id = l.converted_opportunity_id
    left join public.profiles rp on rp.user_id = o.responsible_party_user_id
   where l.owner_user_id = auth.uid() and auth.uid() is not null
   order by l.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.owner_leads enable row level security;

-- Curadoria gerencia; proprietário lê os próprios. Inserção só pela RPC (validação + rate limit).
create policy owner_leads_admin_all on public.owner_leads for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy owner_leads_owner_select on public.owner_leads for select to authenticated
  using (owner_user_id = (select auth.uid()));
-- Corretor designado vê o lead que vai atender.
create policy owner_leads_assigned_select on public.owner_leads for select to authenticated
  using (assigned_to = (select auth.uid()) and public.is_approved_broker());

revoke all on public.owner_leads from anon;
revoke insert, delete on public.owner_leads from authenticated;

revoke execute on function
  public.submit_owner_lead(public.respondent_relation, text, text, text, text, numeric, public.negotiation_model[],
                           text, text, text, text, boolean, text, jsonb),
  public.owner_my_areas(),
  public.is_owner_account(),
  public.record_contact_consent(text, public.consent_purpose)
from public, anon;

-- O formulário público é a única função liberada para anon além da prévia de convite.
grant execute on function
  public.submit_owner_lead(public.respondent_relation, text, text, text, text, numeric, public.negotiation_model[],
                           text, text, text, text, boolean, text, jsonb)
to anon, authenticated;
grant execute on function public.owner_my_areas(), public.is_owner_account() to authenticated;
-- Interna: só pela submit_owner_lead.
revoke execute on function public.record_contact_consent(text, public.consent_purpose) from authenticated;
