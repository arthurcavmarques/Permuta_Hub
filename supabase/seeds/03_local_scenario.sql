-- Seed LOCAL da Fase 1: um usuário por perfil para testar permissões. NUNCA aplicar na nuvem.
-- Depende de 01_local_users.sql e 02_demo_data.sql. Senha = <prefixo>-local-123.
--   corretor@permutahub.local          corretor aprovado (CRECI verificado), responsável por MD-006 e MD-013
--   corretor.pendente@permutahub.local conta aprovada, CRECI aguardando verificação
--   comprador@permutahub.local         admin da "Incorporadora Exemplo Beta"; recebeu MD-001, MD-003, MD-005
--   colega@permutahub.local            membro (buyer) da mesma incorporadora
--   outro@permutahub.local             admin da "Loteadora Exemplo Gama"; não recebeu nada
--   usuario@permutahub.local           (de 01) conta pendente

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-0000-0000-00000000b001'::uuid, 'corretor@permutahub.local', 'corretor-local-123', 'Corretor Aprovado', 'broker'),
      ('00000000-0000-0000-0000-00000000b002'::uuid, 'corretor.pendente@permutahub.local', 'corretor-local-123', 'Corretor Pendente', 'broker'),
      ('00000000-0000-0000-0000-00000000c001'::uuid, 'comprador@permutahub.local', 'comprador-local-123', 'Comprador Admin', 'buyer'),
      ('00000000-0000-0000-0000-00000000c002'::uuid, 'colega@permutahub.local', 'colega-local-123', 'Colega Comprador', 'buyer'),
      ('00000000-0000-0000-0000-00000000c003'::uuid, 'outro@permutahub.local', 'outro-local-123', 'Outra Organização', 'buyer')
    ) as t(id, email, pwd, full_name, kind)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt(u.pwd, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', u.full_name, 'signup_kind', u.kind),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end;
$$;

update public.profiles set account_status = 'approved', reviewed_at = now(), review_note = 'Seed local'
 where user_id in ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b002',
                   '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002',
                   '00000000-0000-0000-0000-00000000c003');

insert into public.brokers (user_id, creci_number, creci_state, verification_status, verified_at) values
  ('00000000-0000-0000-0000-00000000b001', '00000-F (fictício)', 'RS', 'approved', now()),
  ('00000000-0000-0000-0000-00000000b002', '99999-F (fictício)', 'RS', 'pending', null);

update public.opportunities set responsible_party_user_id = '00000000-0000-0000-0000-00000000b001'
 where memorial_number in ('MD-006', 'MD-013');

insert into public.organization_members (organization_id, user_id, role)
select o.id, m.user_id, m.role::public.member_role
  from (values
    ('Incorporadora Exemplo Beta (fictícia)', '00000000-0000-0000-0000-00000000c001'::uuid, 'admin'),
    ('Incorporadora Exemplo Beta (fictícia)', '00000000-0000-0000-0000-00000000c002'::uuid, 'buyer'),
    ('Loteadora Exemplo Gama (fictícia)', '00000000-0000-0000-0000-00000000c003'::uuid, 'admin')
  ) as m(org, user_id, role)
  join public.organizations o on o.name = m.org;

-- Distribuições da plataforma para a incorporadora (para o comprador ver dossiês cegos).
insert into public.distributions (opportunity_id, recipient_user_id, recipient_org_id, channel, source, idempotency_key)
select o.id, '00000000-0000-0000-0000-00000000c001', org.id, 'email', 'platform',
       o.id || ':00000000-0000-0000-0000-00000000c001:email'
  from public.opportunities o
  cross join (select id from public.organizations where name = 'Incorporadora Exemplo Beta (fictícia)') org
 where o.memorial_number in ('MD-001', 'MD-003', 'MD-005')
 order by o.memorial_number;

insert into public.distribution_events (distribution_id, event, at)
select d.id, e.event::public.distribution_event_type, now() - e.ago
  from public.distributions d
  cross join (values ('queued', interval '2 days'), ('sent', interval '2 days' - interval '1 minute'),
                     ('delivered', interval '2 days' - interval '2 minutes')) as e(event, ago)
 where d.source = 'platform'
 order by d.seq, e.ago desc;

-- Fase 2: E2E repetidos no mesmo IP local não podem esbarrar no anti-spam do formulário de captação.
update public.platform_settings set value = '1000'
 where key in ('lead_rate_limit_per_hour', 'lead_rate_limit_per_contact_day');

-- Fase 2: corretor aprovado já aceitou o termo-mestre (pode cadastrar área).
select public.accept_agreement('broker_partnership')
  from (select set_config('request.jwt.claims',
          '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated"}', true)) x;
select set_config('request.jwt.claims', '', false);

-- Fase 2.5: consulta de CNPJ já em cache para um CNPJ fictício (E2E sem depender da BrasilAPI).
insert into public.registry_lookups (kind, query, provider, result, response, response_hash) values
  ('cnpj', '11222333000181', 'brasilapi', 'ok',
   '{"cnpj":"11222333000181","legal_name":"EMPRESA FICTICIA DE TESTE LTDA","trade_name":"FICTICIA","registry_status":"ATIVA","is_active":true,"opened_at":"2010-01-01","legal_nature":"Sociedade Empresária Limitada","cnae_main":"4110700","cnae_main_description":"Incorporação de empreendimentos imobiliários","cnae_secondary":[],"address":"RUA FICTICIA, 1","city":"PORTO ALEGRE","state":"RS"}',
   'seed');
