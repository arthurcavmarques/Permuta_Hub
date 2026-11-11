-- Termos e dado sensível. Fase 2 (bloco 2.1) revista pela Fase 3B (D030, regra 1): o comprador não assina termo;
-- quem recebeu a área nunca lê o proprietário; matrícula e endereço só com buyer_sees_registry_and_address.
-- Termos do corretor versionados, com hash do texto, revogação/expiração e append-only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'curadoria@t21.invalid', 'authenticated', 'authenticated', '{}'),
  ('a1000000-0000-0000-0000-000000000002', 'comprador@t21.invalid', 'authenticated', 'authenticated', '{"full_name":"Compradora Teste","signup_kind":"buyer"}'),
  ('a1000000-0000-0000-0000-000000000003', 'colega@t21.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a1000000-0000-0000-0000-000000000004', 'estranho@t21.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a1000000-0000-0000-0000-000000000005', 'corretor@t21.invalid', 'authenticated', 'authenticated', '{"full_name":"Corretor Teste","signup_kind":"broker"}');
insert into public.platform_admins (user_id) values ('a1000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved'
 where user_id::text like 'a1000000-%';
insert into public.brokers (user_id, creci_number, verification_status) values
  ('a1000000-0000-0000-0000-000000000005', '123-F', 'approved');

insert into public.organizations (id, name, type) values
  ('b1000000-0000-0000-0000-000000000001', 'Compradora SA', 'developer'),
  ('b1000000-0000-0000-0000-000000000002', 'Estranha SA', 'builder');
insert into public.organization_members (organization_id, user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'admin'),
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'buyer'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004', 'admin');

insert into public.opportunities (id, memorial_number, area_m2, city, status, responsible_party_user_id) values
  ('c1000000-0000-0000-0000-000000000001', 'MD-T21-RECEBIDA', 5000, 'Porto Alegre', 'distributing', 'a1000000-0000-0000-0000-000000000005'),
  ('c1000000-0000-0000-0000-000000000002', 'MD-T21-OUTRA', 3000, 'Porto Alegre', 'distributing', null);
insert into public.opportunity_sensitive (opportunity_id, registry_number, exact_address, owner_name, owner_contacts, notes) values
  ('c1000000-0000-0000-0000-000000000001', 'MAT-T21', 'Rua T21, 100', 'Dono T21', '{"phone": "51999990000"}', 'Nota interna'),
  ('c1000000-0000-0000-0000-000000000002', 'MAT-T21-B', null, 'Dono T21 B', '{}', null);
insert into public.distributions (opportunity_id, recipient_user_id, recipient_org_id, channel, source, idempotency_key)
values ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
        'b1000000-0000-0000-0000-000000000001', 'email', 'platform', 't21-k1');

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select 1 from public.agreement_templates $$, '42501', null, 'anon: não lê termos');
select throws_ok($$ select 1 from public.agreements $$, '42501', null, 'anon: não lê aceites');
select throws_ok($$ select public.accept_agreement('broker_partnership') $$, '42501', null, 'anon: não aceita termo');

-- ---------------------------------------------------------------- comprador que recebeu a área (padrão: nada sensível)
reset role; set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'denied',
  'comprador: com a configuração desligada, nada do dado sensível');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'comprador: dado sensível bloqueado na API');
select throws_ok($$ select * from public.get_agreement_preview('non_circumvention', 'c1000000-0000-0000-0000-000000000001') $$,
  'P0002', null, 'termo do comprador desativado (D030): não há o que aceitar');
select is_empty($$ select 1 from public.access_log $$, 'comprador: não lê o access_log');
select throws_ok($$ select * from public.opportunity_sensitive $$, '42501', null, 'comprador: tabela sensível segue fechada');

-- Configuração ligada (DEPENDE DO JURÍDICO): matrícula e endereço sim, proprietário nunca.
reset role;
update public.platform_settings set value = 'true' where key = 'buyer_sees_registry_and_address';
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'limited',
  'comprador: configuração ligada libera o acesso limitado');
select results_eq(
  $$ select registry_number, exact_address from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001') $$,
  $$ values ('MAT-T21'::text, 'Rua T21, 100'::text) $$,
  'comprador: lê matrícula e endereço');
select results_eq(
  $$ select owner_name, owner_contacts, notes from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001') $$,
  $$ values (null::text, '{}'::jsonb, null::text) $$,
  'comprador: proprietário, contatos e notas internas NUNCA saem do banco');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'comprador: área que não recebeu segue bloqueada');
reset role;
select is((select count(*)::int from public.access_log
            where opportunity_id = 'c1000000-0000-0000-0000-000000000001' and action = 'read_sensitive_limited'),
  2, 'leitura limitada fica no access_log, com autor');

-- ---------------------------------------------------------------- colega da mesma organização e estranho
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'limited',
  'colega: a organização recebeu, mesmo acesso limitado');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'denied', 'outra organização: negado');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'outra organização: bloqueada na API');
reset role;
update public.platform_settings set value = 'false' where key = 'buyer_sees_registry_and_address';
set local role authenticated;

-- ---------------------------------------------------------------- corretor responsável
select pg_temp.as_user('a1000000-0000-0000-0000-000000000005');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'allowed', 'corretor responsável: tudo');
select is((select owner_name from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001')),
  'Dono T21', 'corretor responsável: lê o proprietário da própria área');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'corretor: não lê área de outro');

-- Termo-mestre: prévia renderizada, hash conferido, aceite gravado com o texto.
select matches((select body from public.get_agreement_preview('broker_partnership')),
  'Corretor Teste', 'prévia traz o nome do aceitante');
select matches((select body from public.get_agreement_preview('broker_partnership')), 'MINUTA', 'rascunho marcado como minuta');
select throws_ok($$ select public.accept_agreement('broker_partnership', null, 'hash-velho') $$,
  '40001', null, 'aceite recusa se o texto mudou desde a leitura');
select lives_ok($$ select public.accept_agreement('broker_partnership', null,
  (select body_hash from public.get_agreement_preview('broker_partnership'))) $$, 'corretor: aceita o termo-mestre (global)');
select is((select rendered_body_hash = public.sha256_hex(rendered_body) from public.agreements where type = 'broker_partnership' and party_user_id = 'a1000000-0000-0000-0000-000000000005'),
  true, 'aceite guarda o texto e o hash dele');
select ok(public.has_agreement('broker_partnership', null), 'termo-mestre vale sem área');
select matches((select body from public.get_agreement_preview('broker_area_authorization', 'c1000000-0000-0000-0000-000000000001')),
  'declaro.*autorização do proprietário.*MD-T21-RECEBIDA', 'declaração de autorização traz a área');
select lives_ok($$ select public.accept_agreement('broker_area_authorization', 'c1000000-0000-0000-0000-000000000001') $$,
  'corretor: declaração de 1 clique na própria área');
select throws_ok($$ select public.accept_agreement('broker_area_authorization', 'c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'corretor: não declara área de outro');
select throws_ok($$ update public.agreements set expires_at = null $$, '42501', null, 'corretor: não altera aceite');
select throws_ok($$ insert into public.agreements (template_id, type, template_version, party_user_id, scope, rendered_body, rendered_body_hash, prev_hash, row_hash, seq)
  select id, type, version, 'a1000000-0000-0000-0000-000000000005', 'global', 'x', 'x', '', '', 0 from public.agreement_templates limit 1 $$,
  '42501', null, 'corretor: não forja aceite direto na tabela');
reset role;
select is((select count(*)::int from public.access_log where action = 'accept_agreement'
            and actor_id = 'a1000000-0000-0000-0000-000000000005'), 2,
  'aceites ficam no access_log');
set local role authenticated;

-- ---------------------------------------------------------------- comprador não vê aceite alheio
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.agreements $$, 'comprador: não vê aceite do corretor');

-- ---------------------------------------------------------------- revogação e expiração
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.revoke_agreement((select id from public.agreements where type = 'broker_partnership' and party_user_id = 'a1000000-0000-0000-0000-000000000005'), '') $$,
  '22023', null, 'revogação exige motivo');
select lives_ok($$ select public.revoke_agreement((select id from public.agreements where type = 'broker_partnership' and party_user_id = 'a1000000-0000-0000-0000-000000000005'), 'Teste') $$,
  'curadoria: revoga aceite');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000005');
select ok(not public.has_agreement('broker_partnership', null), 'aceite revogado deixa de valer');

-- Expirado: novo aceite com validade vencida (só o dono do banco consegue simular o tempo).
select public.accept_agreement('broker_partnership');
select ok(public.has_agreement('broker_partnership', null), 'novo aceite vale de novo');
reset role;
alter table public.agreements disable trigger agreements_append_only;
update public.agreements set expires_at = now() - interval '1 day'
 where type = 'broker_partnership' and party_user_id = 'a1000000-0000-0000-0000-000000000005' and id not in (select agreement_id from public.agreement_revocations);
alter table public.agreements enable trigger agreements_append_only;
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000005');
select ok(not public.has_agreement('broker_partnership', null), 'aceite expirado deixa de valer');

-- ---------------------------------------------------------------- versões dos termos
select throws_ok($$ select public.publish_agreement_template('broker_partnership', 'v2', 'T', 'Texto', 'global') $$,
  '42501', null, 'corretor: não publica termo');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.publish_agreement_template('broker_partnership', '2026-11-v1', 'Termo v1',
  'Texto do advogado para {{party_name}}', 'global') $$, 'curadoria: publica nova versão sem deploy');
select is((select count(*)::int from public.agreement_templates where type = 'broker_partnership' and active), 1,
  'só uma versão ativa por tipo');

-- ---------------------------------------------------------------- append-only e cadeia de hashes
reset role; set local role service_role;
select throws_ok($q$ update public.agreements set ip = 'x' $q$, '42501', null, 'service_role: não altera aceite');
select throws_ok($q$ delete from public.agreement_revocations $q$, '42501', null, 'service_role: não apaga revogação');
reset role;
select throws_ok($q$ delete from public.agreements $q$, '42501', null, 'dono do banco: trigger rejeita DELETE de aceite');
-- A "expiração simulada" acima alterou uma linha com o trigger desligado: a cadeia precisa acusar.
select is((select reason from public.verify_hash_chain('agreements')), 'conteúdo alterado',
  'cadeia de hashes detecta adulteração do aceite');

select * from finish();
rollback;
