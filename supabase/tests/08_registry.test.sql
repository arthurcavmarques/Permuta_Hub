-- Aceite da Fase 2 (bloco 2.5): CNPJ preenchido e travado a partir de consulta registrada (ou fila manual),
-- CNPJ único, situação não ativa retida; CRECI assistido com situação, nome conferido e reverificação.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-000000000001', 'curadoria@t25.invalid', 'authenticated', 'authenticated', '{}'),
  ('a5000000-0000-0000-0000-000000000002', 'compradora@t25.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a5000000-0000-0000-0000-000000000003', 'outra@t25.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a5000000-0000-0000-0000-000000000004', 'corretor@t25.invalid', 'authenticated', 'authenticated', '{"full_name":"José da Silva","signup_kind":"broker"}');
insert into public.platform_admins (user_id) values ('a5000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a5000000-%';

-- Consultas como a Edge Function grava (service_role): uma ativa, uma baixada, uma de outra pessoa.
insert into public.registry_lookups (id, kind, query, requested_by, provider, result, response, response_hash) values
  ('d5000000-0000-0000-0000-000000000001', 'cnpj', '00000000000191', 'a5000000-0000-0000-0000-000000000002', 'brasilapi', 'ok',
   '{"legal_name":"BANCO DO BRASIL SA","trade_name":"DIRECAO GERAL","registry_status":"ATIVA","is_active":true,"cnae_main":"6422100","cnae_secondary":["6499999"],"city":"BRASILIA","state":"DF","opened_at":"1966-08-01"}', 'h1'),
  ('d5000000-0000-0000-0000-000000000002', 'cnpj', '33000167000101', 'a5000000-0000-0000-0000-000000000002', 'brasilapi', 'ok',
   '{"legal_name":"EMPRESA BAIXADA","registry_status":"BAIXADA","is_active":false,"cnae_main":"4120400"}', 'h2'),
  ('d5000000-0000-0000-0000-000000000003', 'cnpj', '33000167000101', 'a5000000-0000-0000-0000-000000000003', 'brasilapi', 'ok',
   '{"legal_name":"EMPRESA BAIXADA","registry_status":"BAIXADA","is_active":false,"cnae_main":"4120400"}', 'h3');

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select ok(public.is_valid_cnpj('00.000.000/0001-91') and not public.is_valid_cnpj('00000000000192'),
  'dígito verificador do CNPJ no banco');

set local role authenticated;

-- ---------------------------------------------------------------- CNPJ automático
select pg_temp.as_user('a5000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.registry_lookups (kind, query, provider, result) values ('cnpj', '1', 'x', 'ok') $$,
  '42501', null, 'app não forja consulta');
select throws_ok($$ select public.create_my_organization('X', 'developer', '00000000000192') $$, '22023', null,
  'CNPJ com dígito errado é recusado');
select lives_ok($$ select public.create_my_organization('Banco', 'developer', '00000000000191', null, null,
  'd5000000-0000-0000-0000-000000000001') $$, 'cria organização a partir da consulta registrada');
select results_eq($$ select legal_name, registry_status, verification_status::text, registry_source, cnae_warning
                      from public.organizations where cnpj = '00000000000191' $$,
  $$ values ('BANCO DO BRASIL SA'::text, 'ATIVA'::text, 'verified'::text, 'brasilapi'::text, true) $$,
  'dados da Receita preenchidos; CNAE fora do imobiliário só gera aviso');
select throws_ok($$ update public.organizations set legal_name = 'Outro nome' where cnpj = '00000000000191' $$,
  '42501', null, 'admin da organização não altera dados travados');
select lives_ok($$ update public.organizations set name = 'Banco (apelido)' where cnpj = '00000000000191' $$,
  'mas edita o nome de exibição');

-- situação não ativa: retida para a curadoria
select lives_ok($$ select public.create_my_organization('Baixada', 'builder') $$, 'cria outra organização sem CNPJ...');
select is((select verification_status::text from public.organizations where name = 'Baixada'), 'unverified', '...fica sem verificação');

-- ---------------------------------------------------------------- outra pessoa
select pg_temp.as_user('a5000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.create_my_organization('Outra', 'builder') $$, 'outra pessoa cria a organização dela');
select throws_ok($$ select public.apply_organization_cnpj((select id from public.organizations where name = 'Outra'),
  '00000000000191', null) $$, '23505', null, 'CNPJ já usado por outra organização é recusado (único)');
select throws_ok($$ select public.apply_organization_cnpj((select id from public.organizations where name = 'Outra'),
  '33000167000101', 'd5000000-0000-0000-0000-000000000002') $$, '22023', null, 'não usa consulta feita por outra pessoa');
select lives_ok($$ select public.apply_organization_cnpj((select id from public.organizations where name = 'Outra'),
  '33000167000101', 'd5000000-0000-0000-0000-000000000003') $$, 'usa a própria consulta');
select is((select verification_status::text from public.organizations where name = 'Outra'), 'pending_review',
  'situação BAIXADA: retida para a curadoria decidir');

-- fonte fora do ar: manual (a outra organização ainda não tem CNPJ)
select lives_ok($$ select public.create_my_organization('Manual', 'builder') $$, 'organização para o caso manual');
select lives_ok($$ select public.apply_organization_cnpj((select id from public.organizations where name = 'Manual'),
  '11222333000181', null) $$, 'sem consulta (fonte fora do ar): CNPJ digitado à mão');
select is((select verification_status::text || ':' || registry_source from public.organizations where name = 'Manual'),
  'pending_manual:manual', 'CNPJ manual vai para a fila da curadoria');

-- ---------------------------------------------------------------- curadoria decide
set local role authenticated;
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.review_organization_registry((select id from public.organizations where name = 'Manual'), false) $$,
  '22023', null, 'recusa exige motivo');
select lives_ok($$ select public.review_organization_registry((select id from public.organizations where name = 'Manual'), true) $$,
  'curadoria confere o CNPJ manual');
select is((select verification_status::text from public.organizations where name = 'Manual'), 'verified', 'organização verificada');

-- ---------------------------------------------------------------- CRECI nível B
select pg_temp.as_user('a5000000-0000-0000-0000-000000000004');
select lives_ok($$ insert into public.brokers (user_id, creci_number, creci_state, verification_status, creci_status)
  values ('a5000000-0000-0000-0000-000000000004', '12345-F', 'RS', 'approved', 'active') $$, 'corretor envia CRECI...');
select results_eq($$ select verification_status::text, creci_status::text from public.brokers where user_id = 'a5000000-0000-0000-0000-000000000004' $$,
  $$ values ('pending'::text, 'unknown'::text) $$, '...e não se autoaprova');
select is(public.creci_lookup_url('rs'), 'https://creci-rs.gov.br/siteNovo/pesquisaInscrito.php', 'link da consulta oficial por UF');

select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select is((select lookup_url from public.admin_broker_queue() where email = 'corretor@t25.invalid'),
  'https://creci-rs.gov.br/siteNovo/pesquisaInscrito.php', 'fila da curadoria traz o link da consulta');
select lives_ok($$ select public.review_broker('a5000000-0000-0000-0000-000000000004', true, null, 'suspended', 'JOSE DA SILVA') $$,
  'curadoria registra CRECI suspenso');
select results_eq($$ select verification_status::text, creci_status::text from public.brokers where user_id = 'a5000000-0000-0000-0000-000000000004' $$,
  $$ values ('rejected'::text, 'suspended'::text) $$, 'situação não ativa = não verificado');
select lives_ok($$ select public.review_broker('a5000000-0000-0000-0000-000000000004', true, null, 'active', 'JOSE DA SILVA') $$,
  'curadoria confere CRECI ativo com o nome da consulta');
select ok((select name_match_score >= 0.9 from public.brokers where user_id = 'a5000000-0000-0000-0000-000000000004'), 'nome sem acento/caixa confere com o perfil');
select ok((select next_review_at > now() + interval '11 months' from public.brokers where user_id = 'a5000000-0000-0000-0000-000000000004'), 'reverificação agendada (nível C)');

select pg_temp.as_user('a5000000-0000-0000-0000-000000000004');
select ok(public.is_approved_broker(), 'CRECI ativo e conferido: corretor apto');

-- nível C: venceu a reverificação e a curadoria marca cancelado
reset role;
update public.brokers set next_review_at = now() - interval '1 day' where user_id = 'a5000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select is((select review_due from public.admin_broker_queue() where email = 'corretor@t25.invalid'), true,
  'reverificação vencida aparece na fila');
select lives_ok($$ select public.review_broker('a5000000-0000-0000-0000-000000000004', true, 'Consulta de outubro', 'cancelled') $$,
  'curadoria registra cancelamento');
select pg_temp.as_user('a5000000-0000-0000-0000-000000000004');
select ok(not public.is_approved_broker(), 'CRECI cancelado: corretor deixa de publicar e cadastrar');

select * from finish();
rollback;
