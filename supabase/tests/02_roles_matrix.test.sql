-- Aceite da Fase 1: para cada perfil, o que lê e o que escreve. Roles simulados como o PostgREST faz.
-- Independente dos seeds: cria os próprios usuários, organizações e áreas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'curadoria@t.invalid', 'authenticated', 'authenticated', '{}'),
  ('a0000000-0000-0000-0000-000000000002', 'pendente@t.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer","account_status":"approved"}'),
  ('a0000000-0000-0000-0000-000000000003', 'corretor.ok@t.invalid', 'authenticated', 'authenticated', '{"signup_kind":"broker"}'),
  ('a0000000-0000-0000-0000-000000000004', 'corretor.sem.creci@t.invalid', 'authenticated', 'authenticated', '{"signup_kind":"broker"}'),
  ('a0000000-0000-0000-0000-000000000005', 'comprador@t.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a0000000-0000-0000-0000-000000000006', 'colega@t.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a0000000-0000-0000-0000-000000000007', 'estranho@t.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}');

insert into public.platform_admins (user_id) values ('a0000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved'
 where user_id in ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
                   'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006',
                   'a0000000-0000-0000-0000-000000000007');

insert into public.brokers (user_id, creci_number, verification_status) values
  ('a0000000-0000-0000-0000-000000000003', '111-F', 'approved'),
  ('a0000000-0000-0000-0000-000000000004', '222-F', 'pending');

insert into public.organizations (id, name, type) values
  ('b0000000-0000-0000-0000-000000000001', 'Org Compradora', 'developer'),
  ('b0000000-0000-0000-0000-000000000002', 'Org Estranha', 'builder');
insert into public.organization_members (organization_id, user_id, role) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'admin'),
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'buyer'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000007', 'admin');

insert into public.opportunities (id, memorial_number, area_m2, city, neighborhood, status, responsible_party_user_id) values
  ('c0000000-0000-0000-0000-000000000001', 'MD-T-ENVIADA', 5000, 'Porto Alegre', 'Bairro A', 'distributing', null),
  ('c0000000-0000-0000-0000-000000000002', 'MD-T-DO-CORRETOR', 3000, 'Porto Alegre', 'Bairro B', 'captured', 'a0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000003', 'MD-T-NINGUEM', 8000, 'Canoas', 'Centro', 'qualified', null);
insert into public.opportunity_sensitive (opportunity_id, registry_number) values
  ('c0000000-0000-0000-0000-000000000001', 'MAT-SECRETA-A');

insert into public.distributions (opportunity_id, recipient_org_id, recipient_user_id, channel, source, idempotency_key) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'email', 'platform', 'k1'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', null, null, 'legacy', 'k-legado');
insert into public.distribution_events (distribution_id, event)
select id, 'sent' from public.distributions where idempotency_key = 'k1';

-- Fase 2: corretor aceita o termo-mestre antes de cadastrar área.
select public.accept_agreement('broker_partnership')
  from (select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true)) x;
select public.accept_agreement('broker_partnership')
  from (select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true)) x;

-- Atalho para trocar de usuário.
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------- metadado não dá privilégio
select is((select account_status::text from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000002'),
  'pending', 'cadastro novo nasce pendente (metadado account_status ignorado)');
select is((select signup_kind::text from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000002'),
  'buyer', 'signup_kind vem do cadastro');

-- ---------------------------------------------------------------- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select 1 from public.profiles $$, '42501', null, 'anon: sem perfis');
select throws_ok($$ select 1 from public.organizations $$, '42501', null, 'anon: sem organizações');
select throws_ok($$ select 1 from public.organization_members $$, '42501', null, 'anon: sem membros');
select throws_ok($$ select 1 from public.brokers $$, '42501', null, 'anon: sem corretores');
select throws_ok($$ select 1 from public.distributions $$, '42501', null, 'anon: sem distribuições');
select throws_ok($$ select 1 from public.contact_consents $$, '42501', null, 'anon: sem consentimentos');
select throws_ok($$ select 1 from public.invitations $$, '42501', null, 'anon: sem convites');
select throws_ok($$ select public.create_my_organization('X', 'other') $$, '42501', null, 'anon: não cria organização');
select lives_ok($$ select * from public.get_invitation_preview('token-inexistente') $$,'anon: prévia de convite disponível');
select is((select count(*)::int from public.consent_texts), 3, 'anon: lê só os textos de consentimento ativos (cadastro)');

-- ---------------------------------------------------------------- conta pendente
reset role; set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.profiles), 1, 'pendente: vê só o próprio perfil');
select is_empty($$ select 1 from public.opportunities_blind $$, 'pendente: nenhum dossiê cego');
select is_empty($$ select 1 from public.organizations $$, 'pendente: nenhuma organização');
select throws_ok(
  $$ update public.profiles set account_status = 'approved' where user_id = 'a0000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'pendente: não se autoaprova');
select lives_ok(
  $$ update public.profiles set full_name = 'Nome Novo' where user_id = 'a0000000-0000-0000-0000-000000000002' $$,
  'pendente: edita o próprio nome');
select throws_ok(
  $$ update public.profiles set whatsapp_opt_in = true where user_id = 'a0000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'pendente: opt-in só pela RPC de consentimento');
select lives_ok($$ select public.record_consent('whatsapp', true) $$, 'pendente: registra consentimento');
select is((select whatsapp_opt_in from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000002'),
  true, 'consentimento espelhado no perfil');
select is((select text_version from public.current_contact_consents where purpose = 'whatsapp'),
  '2026-10-v1', 'consentimento guarda a versão do texto');
select throws_ok($$ insert into public.contact_consents (user_id, purpose, granted, consent_text_id, text_version, text_hash)
  select 'a0000000-0000-0000-0000-000000000002', 'email', true, id, version, body_hash from public.consent_texts limit 1 $$,
  '42501', null, 'pendente: não forja consentimento direto na tabela');
select lives_ok($$ select public.create_my_organization('Minha Org', 'developer') $$, 'pendente: cria a própria organização');
select throws_ok($$ select public.create_my_organization('Segunda Org', 'developer') $$, '42501', null,
  'pendente: só uma organização antes da aprovação');
select results_eq($$ with u as (update public.organizations set name = 'Renomeada' where name = 'Minha Org' returning 1)
                     select count(*)::int from u $$,
  array[0], 'pendente: não edita a organização antes da aprovação (update sem efeito)');

-- ---------------------------------------------------------------- corretor aprovado
select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select lives_ok($$ insert into public.opportunities (city, neighborhood, area_m2, responsible_party_user_id)
  values ('Porto Alegre', 'Bairro C', 1500, 'a0000000-0000-0000-0000-000000000003') $$,
  'corretor aprovado: cadastra área');
select matches((select memorial_number from public.opportunities where neighborhood = 'Bairro C'),
  '^PH-\d{5}$', 'área da plataforma recebe número PH-');
select throws_ok($$ insert into public.opportunities (city, responsible_party_user_id)
  values ('Porto Alegre', 'a0000000-0000-0000-0000-000000000004') $$, '42501', null,
  'corretor: não cadastra em nome de outro');
select throws_ok($$ insert into public.opportunities (city, status, responsible_party_user_id)
  values ('Porto Alegre', 'qualified', 'a0000000-0000-0000-0000-000000000003') $$, '42501', null,
  'corretor: área nova não nasce qualificada');
select is((select count(*)::int from public.opportunities), 2, 'corretor: vê só as próprias áreas (tabela completa)');
select is((select count(*)::int from public.opportunities_blind), 2, 'corretor: dossiê cego só das próprias');
select throws_ok($$ update public.opportunities set status = 'qualified' where id = 'c0000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'corretor: não muda status');
select lives_ok($$ update public.opportunities set zoning = 'Mista' where id = 'c0000000-0000-0000-0000-000000000002' $$,
  'corretor: edita dados da própria área captada');
select lives_ok($$ select * from public.get_opportunity_sensitive('c0000000-0000-0000-0000-000000000002') $$,
  'corretor responsável: lê o dado sensível da própria área (Fase 2, D020)');
select lives_ok($$ update public.brokers set creci_number = '111-G' where user_id = 'a0000000-0000-0000-0000-000000000003' $$,
  'corretor: corrige o CRECI');
select is((select verification_status::text from public.brokers where user_id = 'a0000000-0000-0000-0000-000000000003'),
  'pending', 'corretor: CRECI alterado volta para a fila');
select throws_ok($$ insert into public.opportunities (city, responsible_party_user_id)
  values ('Porto Alegre', 'a0000000-0000-0000-0000-000000000003') $$, '42501', null,
  'corretor com CRECI de volta à fila: não cadastra');

-- ---------------------------------------------------------------- corretor sem CRECI aprovado (aceite)
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select throws_ok($$ insert into public.opportunities (city, responsible_party_user_id)
  values ('Porto Alegre', 'a0000000-0000-0000-0000-000000000004') $$, '42501', null,
  'corretor sem aprovação NÃO cadastra área');
select lives_ok($$ update public.brokers set verification_status = 'approved' where user_id = 'a0000000-0000-0000-0000-000000000004' $$,
  'corretor: update não falha...');
select is((select verification_status::text from public.brokers where user_id = 'a0000000-0000-0000-0000-000000000004'),
  'pending', '...mas não se autoaprova');
select is_empty($$ select 1 from public.brokers where user_id <> 'a0000000-0000-0000-0000-000000000004' $$,
  'corretor: não vê outros corretores');

-- ---------------------------------------------------------------- comprador admin da organização
select pg_temp.as_user('a0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.opportunities_blind), 1, 'comprador: vê só o dossiê que recebeu pela plataforma');
select is_empty($$ select 1 from public.opportunities $$, 'comprador: tabela completa invisível');
select is((select count(*)::int from public.distributions), 2, 'comprador: vê o que a organização recebeu (incl. legado)');
select is((select status from public.distribution_status where source = 'platform'), 'sent', 'comprador: estado derivado do último evento');
select throws_ok($$ select * from public.get_opportunity_sensitive('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'comprador: sensível bloqueado mesmo com distribuição (sem termo)');
select is((select count(*)::int from public.organization_members), 2, 'comprador: vê membros da própria organização');
select is((select count(*)::int from public.profiles), 2, 'comprador: vê perfis dos colegas');
select lives_ok($$ select public.create_invitation('b0000000-0000-0000-0000-000000000001', 'novo@t.invalid', 'buyer') $$,
  'admin da organização: convida');
select throws_ok($$ select public.create_invitation('b0000000-0000-0000-0000-000000000002', 'x@t.invalid', 'buyer') $$,
  '42501', null, 'admin da organização: não convida para outra organização');
select throws_ok($$ insert into public.distributions (opportunity_id, recipient_org_id, channel, idempotency_key)
  values ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'email', 'forjada') $$,
  '42501', null, 'comprador: não forja distribuição para ganhar acesso');
select throws_ok($$ update public.organizations set active = false where id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'admin da organização: não ativa/desativa a própria organização');
select throws_ok($$ select * from public.admin_list_users() $$, '42501', null, 'comprador: sem lista de usuários');
select is_empty($$ select 1 from public.email_outbox $$, 'comprador: não lê a caixa de saída (links de convite)');

-- ---------------------------------------------------------------- colega (membro comum)
select pg_temp.as_user('a0000000-0000-0000-0000-000000000006');
select is((select count(*)::int from public.opportunities_blind), 1, 'colega: vê o que a organização recebeu');
select throws_ok($$ select public.create_invitation('b0000000-0000-0000-0000-000000000001', 'y@t.invalid', 'buyer') $$,
  '42501', null, 'membro comum: não convida');
select is_empty($$ select 1 from public.invitations $$, 'membro comum: não vê convites');
select is((select count(*)::int from public.organization_members where role = 'admin'), 1, 'colega: vê quem é admin');
select results_eq($$ with u as (update public.organization_members set role = 'admin'
                     where user_id = 'a0000000-0000-0000-0000-000000000006' returning 1) select count(*)::int from u $$,
  array[0], 'membro comum: não se promove (update sem efeito)');

-- ---------------------------------------------------------------- comprador de outra organização
select pg_temp.as_user('a0000000-0000-0000-0000-000000000007');
select is((select count(*)::int from public.profiles), 1, 'outra organização: não vê perfis de outras organizações');
select is_empty($$ select 1 from public.opportunities_blind $$, 'outra organização: nenhum dossiê');
select is_empty($$ select 1 from public.distributions $$, 'outra organização: não vê distribuições alheias');
select is((select count(*)::int from public.organizations), 1, 'outra organização: vê só a própria');

-- ---------------------------------------------------------------- curadoria (admin da plataforma)
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select ok((select count(*) from public.admin_list_users()) >= 7, 'curadoria: lista usuários com e-mail');
select lives_ok($$ select public.review_broker('a0000000-0000-0000-0000-000000000004', true) $$, 'curadoria: aprova CRECI');
select is((select count(*)::int from public.email_outbox where template_key = 'creci_approved'
                     and payload ->> 'user_id' = 'a0000000-0000-0000-0000-000000000004'), 1,
  'aprovação de CRECI enfileira e-mail ao corretor');
select throws_ok($$ select public.review_broker('a0000000-0000-0000-0000-000000000003', false) $$, '22023', null,
  'curadoria: rejeição exige motivo');
select lives_ok($$ select public.review_account('a0000000-0000-0000-0000-000000000002', 'approved') $$, 'curadoria: aprova conta');

-- Corretor recém-aprovado agora cadastra.
select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select lives_ok($$ insert into public.opportunities (city, responsible_party_user_id)
  values ('Gravataí', 'a0000000-0000-0000-0000-000000000004') $$, 'corretor aprovado pela curadoria: cadastra');

select * from finish();
rollback;
