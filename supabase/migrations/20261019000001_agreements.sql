-- Fase 2 · Bloco 2.1 — Termos versionados e aceite (D020). Pré-requisito para entrar dado real.
-- agreement_templates: textos versionados, editáveis pela curadoria sem deploy (nova versão = nova linha).
-- agreements / agreement_revocations: append-only com cadeia de hashes (regra 2, D017).
-- Dado sensível: comprador que recebeu a área lê SÓ com aceite válido; log antes de devolver (regra 1).
-- Reverter: supabase/rollbacks/20261019000001_agreements.down.sql

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
-- non_circumvention: comprador (confidencialidade e não-circunvenção) antes do dado sensível.
-- broker_partnership: termo-mestre do corretor (aceito uma vez).
-- broker_area_authorization: aceite de 1 clique por área (corretor autoriza a divulgação).
-- owner_terms: termo do proprietário ao cadastrar área. platform_terms: termos de uso.
create type public.agreement_type as enum
  ('non_circumvention', 'broker_partnership', 'broker_area_authorization', 'owner_terms', 'platform_terms');
create type public.agreement_scope as enum ('global', 'opportunity');

-- ---------------------------------------------------------------------------
-- Modelos de termo
-- ---------------------------------------------------------------------------
create table public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  type public.agreement_type not null,
  version text not null,
  title text not null,
  -- Variáveis {{...}} preenchidas no servidor (render_agreement). Sem data: o texto aceito tem que
  -- ser idêntico ao exibido, mesmo que o aceite aconteça depois da meia-noite.
  body_markdown text not null,
  body_hash text generated always as (public.sha256_hex(body_markdown)) stored,
  scope public.agreement_scope not null,
  -- Validade do aceite em meses (null = não expira). Cauda (não-circunvenção) é outra coisa: fica gravada no aceite.
  validity_months integer check (validity_months is null or validity_months > 0),
  active boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, version)
);

create unique index agreement_templates_one_active_idx on public.agreement_templates (type) where active;

-- Texto publicado não muda (só deixa de ser o ativo). Mesmo padrão de consent_texts.
create or replace function public.guard_agreement_template_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body_markdown is distinct from old.body_markdown or new.version is distinct from old.version
     or new.type is distinct from old.type or new.title is distinct from old.title
     or new.scope is distinct from old.scope or new.validity_months is distinct from old.validity_months then
    raise exception 'Termo publicado é imutável: crie nova versão' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger agreement_templates_guard before update on public.agreement_templates
  for each row execute function public.guard_agreement_template_update();
create trigger agreement_templates_no_delete before delete on public.agreement_templates
  for each row execute function public.reject_mutation();
create trigger agreement_templates_updated_at before update on public.agreement_templates
  for each row execute function public.set_updated_at();

-- Configurações dos termos (regra 5: nada jurídico fixo no código).
insert into public.platform_settings (key, value, description) values
  ('platform_legal_name', '"[RAZÃO SOCIAL DA PLATAFORMA — DEPENDE DO JURÍDICO]"', 'Razão social usada nos termos — DEPENDE DO JURÍDICO.'),
  ('platform_document_id', '"[CNPJ DA PLATAFORMA — DEPENDE DO JURÍDICO]"', 'CNPJ usado nos termos — DEPENDE DO JURÍDICO.');

-- Rascunhos (v0.1). Substituir pelo texto do advogado publicando nova versão pela tela da curadoria.
insert into public.agreement_templates (type, version, title, scope, validity_months, active, body_markdown) values
  ('non_circumvention', '2026-10-v0.1', 'Termo de confidencialidade e não-circunvenção', 'opportunity', 12, true,
   E'[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]\n\n'
   'Eu, {{party_name}}, em nome de {{organization_name}}, recebi de {{platform_legal_name}} ({{platform_document_id}}) '
   'a oportunidade {{memorial_number}} e me comprometo a manter confidenciais os dados restritos (matrícula, endereço '
   'exato e proprietário) e a não negociar a área diretamente com o proprietário ou terceiros sem a intermediação da '
   'plataforma, pelo prazo de {{tail_period_months}} meses após este aceite.'),
  ('broker_partnership', '2026-10-v0.1', 'Termo de parceria do corretor (termo-mestre)', 'global', null, true,
   E'[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]\n\n'
   'Eu, {{party_name}}, corretor(a), aceito as condições de parceria com {{platform_legal_name}} '
   '({{platform_document_id}}) para divulgar áreas pela plataforma. Cada área exige autorização do proprietário anexada '
   'e um aceite específico. O registro deste aceite (versão, data, IP e hash do texto) é sempre gravado.'),
  ('broker_area_authorization', '2026-10-v0.1', 'Autorização de divulgação da área', 'opportunity', null, true,
   E'[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]\n\n'
   'Eu, {{party_name}}, autorizo {{platform_legal_name}} a divulgar a área {{memorial_number}} na versão cega do dossiê, '
   'declaro ter autorização do proprietário (anexada) e me comprometo a manter as informações atualizadas.'),
  ('owner_terms', '2026-10-v0.1', 'Termo do proprietário', 'global', null, true,
   E'[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]\n\n'
   'Eu, {{party_name}}, declaro ser proprietário(a) ou representante da(s) área(s) que cadastrar e autorizo '
   '{{platform_legal_name}} a analisá-las. Meus dados de contato não serão compartilhados com compradores; o contato '
   'é feito por corretor parceiro ou pela curadoria.'),
  ('platform_terms', '2026-10-v0.1', 'Termos de uso da plataforma', 'global', null, true,
   E'[MINUTA — SUBSTITUIR PELO TEXTO DO ADVOGADO]\n\nTermos de uso de {{platform_legal_name}}.');

-- Publica nova versão (desativa a anterior do mesmo tipo). Só curadoria.
create or replace function public.publish_agreement_template(
  p_type public.agreement_type, p_version text, p_title text, p_body text,
  p_scope public.agreement_scope, p_validity_months integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Somente a curadoria publica termos' using errcode = '42501';
  end if;
  if coalesce(trim(p_version), '') = '' or coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'Versão, título e texto são obrigatórios' using errcode = '22023';
  end if;
  update public.agreement_templates set active = false where type = p_type and active;
  insert into public.agreement_templates (type, version, title, body_markdown, scope, validity_months, active, created_by)
  values (p_type, trim(p_version), trim(p_title), p_body, p_scope, p_validity_months, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aceites (append-only) e revogações (append-only)
-- ---------------------------------------------------------------------------
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  template_id uuid not null references public.agreement_templates (id),
  type public.agreement_type not null,
  template_version text not null,
  party_user_id uuid not null references auth.users (id),
  party_org_id uuid references public.organizations (id),
  scope public.agreement_scope not null,
  opportunity_id uuid references public.opportunities (id),
  -- Texto exato que a pessoa viu (prova). Hash = SHA-256 desse texto.
  rendered_body text not null,
  rendered_body_hash text not null,
  tail_period_months integer,
  ip text,
  user_agent text,
  provider text not null default 'internal_hash',
  provider_ref text,
  signed_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  prev_hash text not null,
  row_hash text not null,
  check ((scope = 'opportunity') = (opportunity_id is not null))
);

create unique index agreements_seq_idx on public.agreements (seq);
create index agreements_party_idx on public.agreements (party_user_id, type, opportunity_id);

create table public.agreement_revocations (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  agreement_id uuid not null references public.agreements (id),
  revoked_by uuid references auth.users (id),
  reason text not null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  prev_hash text not null,
  row_hash text not null
);

create unique index agreement_revocations_seq_idx on public.agreement_revocations (seq);
create index agreement_revocations_agreement_idx on public.agreement_revocations (agreement_id);

create trigger agreements_chain before insert on public.agreements
  for each row execute function public.chain_hash();
create trigger agreements_append_only before update or delete on public.agreements
  for each row execute function public.reject_mutation();
create trigger agreements_no_truncate before truncate on public.agreements
  for each statement execute function public.reject_mutation();

create trigger agreement_revocations_chain before insert on public.agreement_revocations
  for each row execute function public.chain_hash();
create trigger agreement_revocations_append_only before update or delete on public.agreement_revocations
  for each row execute function public.reject_mutation();
create trigger agreement_revocations_no_truncate before truncate on public.agreement_revocations
  for each statement execute function public.reject_mutation();

revoke update, delete, truncate on public.agreements, public.agreement_revocations
  from anon, authenticated, service_role;

-- Cadeia verificável também para os aceites.
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
  if p_table not in ('access_log', 'distributions', 'distribution_events', 'agreements', 'agreement_revocations') then
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

-- Aceite em vigor: não revogado e não expirado.
create view public.valid_agreements
with (security_invoker = true)
as
select a.*
from public.agreements a
where (a.expires_at is null or a.expires_at > now())
  and not exists (select 1 from public.agreement_revocations r where r.agreement_id = a.id);

-- ---------------------------------------------------------------------------
-- Renderização e aceite
-- ---------------------------------------------------------------------------
-- Organização em nome da qual o usuário age: a que recebeu a área (comprador) ou a primeira dele.
create or replace function public.party_org_for(p_user_id uuid, p_opportunity_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.recipient_org_id from public.distributions d
      where d.opportunity_id = p_opportunity_id and d.source = 'platform'
        and d.recipient_org_id in (select m.organization_id from public.organization_members m where m.user_id = p_user_id)
      order by d.seq limit 1),
    (select m.organization_id from public.organization_members m where m.user_id = p_user_id
      order by m.created_at limit 1));
$$;

create or replace function public.render_agreement(
  p_template public.agreement_templates, p_user_id uuid, p_opportunity_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_body text := p_template.body_markdown;
  v_vars jsonb;
  k text;
begin
  v_vars := jsonb_build_object(
    'party_name', coalesce((select p.full_name from public.profiles p where p.user_id = p_user_id), ''),
    'organization_name', coalesce((select o.name from public.organizations o
                                    where o.id = public.party_org_for(p_user_id, p_opportunity_id)), 'pessoa física'),
    'memorial_number', coalesce((select o.memorial_number from public.opportunities o where o.id = p_opportunity_id), ''),
    'platform_legal_name', public.setting_text('platform_legal_name', ''),
    'platform_document_id', public.setting_text('platform_document_id', ''),
    'tail_period_months', public.setting_numeric('default_tail_period_months', 24)::int::text
  );
  for k in select jsonb_object_keys(v_vars) loop
    v_body := replace(v_body, '{{' || k || '}}', v_vars ->> k);
  end loop;
  return v_body;
end;
$$;

-- Quem pode aceitar cada termo, para qual área.
create or replace function public.can_accept_agreement(p_type public.agreement_type, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and public.is_approved() and case p_type
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
  end;
$$;

-- Texto exato que será aceito (a tela mostra isto; o aceite grava o mesmo texto e seu hash).
create or replace function public.get_agreement_preview(
  p_type public.agreement_type, p_opportunity_id uuid default null
)
returns table (template_id uuid, version text, title text, body text, body_hash text, scope public.agreement_scope)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.agreement_templates;
  v_body text;
begin
  if not public.can_accept_agreement(p_type, p_opportunity_id) then
    raise exception 'Termo indisponível para você' using errcode = '42501';
  end if;
  select * into v_t from public.agreement_templates where type = p_type and active;
  if not found then
    raise exception 'Sem termo ativo do tipo %', p_type using errcode = 'P0002';
  end if;
  v_body := public.render_agreement(v_t, auth.uid(), case when v_t.scope = 'opportunity' then p_opportunity_id end);
  return query select v_t.id, v_t.version, v_t.title, v_body, public.sha256_hex(v_body), v_t.scope;
end;
$$;

-- Registra o aceite. p_expected_hash = hash que a tela exibiu: se o texto mudou no meio, recusa.
create or replace function public.accept_agreement(
  p_type public.agreement_type, p_opportunity_id uuid default null, p_expected_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.agreement_templates;
  v_body text;
  v_hash text;
  v_opp uuid;
  v_id uuid;
begin
  if not public.can_accept_agreement(p_type, p_opportunity_id) then
    raise exception 'Termo indisponível para você' using errcode = '42501';
  end if;
  select * into v_t from public.agreement_templates where type = p_type and active;
  if not found then
    raise exception 'Sem termo ativo do tipo %', p_type using errcode = 'P0002';
  end if;
  v_opp := case when v_t.scope = 'opportunity' then p_opportunity_id end;
  if v_t.scope = 'opportunity' and v_opp is null then
    raise exception 'Este termo é por área: informe a oportunidade' using errcode = '22023';
  end if;
  v_body := public.render_agreement(v_t, auth.uid(), v_opp);
  v_hash := public.sha256_hex(v_body);
  if p_expected_hash is not null and p_expected_hash <> v_hash then
    raise exception 'O texto do termo mudou; leia a versão atual' using errcode = '40001';
  end if;

  insert into public.agreements
    (template_id, type, template_version, party_user_id, party_org_id, scope, opportunity_id,
     rendered_body, rendered_body_hash, tail_period_months, ip, user_agent, expires_at)
  values
    (v_t.id, v_t.type, v_t.version, auth.uid(), public.party_org_for(auth.uid(), v_opp), v_t.scope, v_opp,
     v_body, v_hash,
     case when p_type = 'non_circumvention' then public.setting_numeric('default_tail_period_months', 24)::int end,
     public.request_ip(), public.request_user_agent(),
     case when v_t.validity_months is not null then now() + make_interval(months => v_t.validity_months) end)
  returning id into v_id;

  insert into public.access_log (actor_id, action, resource_type, resource_id, opportunity_id, ip, user_agent)
  values (auth.uid(), 'accept_agreement', 'agreements', v_id, v_opp, public.request_ip(), public.request_user_agent());
  return v_id;
end;
$$;

-- Revogação: curadoria revoga qualquer um; a própria pessoa revoga o seu.
create or replace function public.revoke_agreement(p_agreement_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Revogação exige motivo' using errcode = '22023';
  end if;
  if not (public.is_admin() or exists (
      select 1 from public.agreements a where a.id = p_agreement_id and a.party_user_id = auth.uid())) then
    raise exception 'Sem permissão para revogar' using errcode = '42501';
  end if;
  if exists (select 1 from public.agreement_revocations r where r.agreement_id = p_agreement_id) then
    return; -- já revogado: idempotente
  end if;
  insert into public.agreement_revocations (agreement_id, revoked_by, reason)
  values (p_agreement_id, auth.uid(), trim(p_reason));
end;
$$;

-- Aceite válido do usuário atual para o tipo/área (global vale para todas as áreas).
create or replace function public.has_agreement(p_type public.agreement_type, p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agreements a
     where a.party_user_id = auth.uid() and a.type = p_type
       and (a.scope = 'global' or a.opportunity_id = p_opportunity_id)
       and (a.expires_at is null or a.expires_at > now())
       and not exists (select 1 from public.agreement_revocations r where r.agreement_id = a.id));
$$;

-- Substitui o placeholder da Fase 1.
create or replace function public.has_valid_agreement(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_agreement('non_circumvention', p_opportunity_id);
$$;

-- ---------------------------------------------------------------------------
-- Dado sensível: quem lê e em que condição
-- ---------------------------------------------------------------------------
-- allowed: curadoria; corretor responsável (aprovado) pela área; destinatário com termo válido.
-- needs_agreement: destinatário sem termo válido. denied: o resto.
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.agreement_templates enable row level security;
alter table public.agreements enable row level security;
alter table public.agreement_revocations enable row level security;

-- Termos ativos são legíveis por quem está logado (precisa ler antes de aceitar); curadoria vê o histórico.
create policy agreement_templates_select on public.agreement_templates for select to authenticated
  using (active or (select public.is_admin()));

-- Aceites: a própria pessoa e a curadoria. Escrita só pelas RPCs.
create policy agreements_select on public.agreements for select to authenticated
  using (party_user_id = (select auth.uid()) or (select public.is_admin()));
create policy agreement_revocations_select on public.agreement_revocations for select to authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.agreements a
     where a.id = agreement_revocations.agreement_id and a.party_user_id = (select auth.uid())));

revoke all on public.agreement_templates, public.agreements, public.agreement_revocations,
  public.valid_agreements from anon;
revoke insert, update, delete on public.agreement_templates, public.agreements, public.agreement_revocations
  from authenticated;

revoke execute on function
  public.publish_agreement_template(public.agreement_type, text, text, text, public.agreement_scope, integer),
  public.get_agreement_preview(public.agreement_type, uuid),
  public.accept_agreement(public.agreement_type, uuid, text),
  public.revoke_agreement(uuid, text),
  public.has_agreement(public.agreement_type, uuid),
  public.sensitive_access_state(uuid),
  public.render_agreement(public.agreement_templates, uuid, uuid),
  public.party_org_for(uuid, uuid),
  public.can_accept_agreement(public.agreement_type, uuid)
from public, anon;

grant execute on function
  public.publish_agreement_template(public.agreement_type, text, text, text, public.agreement_scope, integer),
  public.get_agreement_preview(public.agreement_type, uuid),
  public.accept_agreement(public.agreement_type, uuid, text),
  public.revoke_agreement(uuid, text),
  public.has_agreement(public.agreement_type, uuid),
  public.sensitive_access_state(uuid)
to authenticated;
-- Internas: só por outras funções.
revoke execute on function public.render_agreement(public.agreement_templates, uuid, uuid),
  public.party_org_for(uuid, uuid) from authenticated;
