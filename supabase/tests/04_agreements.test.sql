-- Aceite da Fase 2 (bloco 2.1): sem termo, o dado sensível é inacessível pela API para o comprador;
-- com termo, acessível e logado; revogado ou expirado volta a bloquear. Termos versionados e append-only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

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
insert into public.opportunity_sensitive (opportunity_id, registry_number, owner_name) values
  ('c1000000-0000-0000-0000-000000000001', 'MAT-T21', 'Dono T21'),
  ('c1000000-0000-0000-0000-000000000002', 'MAT-T21-B', 'Dono T21 B');
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
select throws_ok($$ select public.accept_agreement('non_circumvention', 'c1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon: não aceita termo');

-- ---------------------------------------------------------------- comprador que recebeu a área
reset role; set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'needs_agreement',
  'comprador: área recebida pede termo');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'comprador SEM termo: dado sensível bloqueado na API');
select is_empty($$ select 1 from public.access_log $$, 'comprador: não lê o access_log');
select matches((select body from public.get_agreement_preview('non_circumvention', 'c1000000-0000-0000-0000-000000000001')),
  'MD-T21-RECEBIDA', 'prévia do termo traz a área');
select matches((select body from public.get_agreement_preview('non_circumvention', 'c1000000-0000-0000-0000-000000000001')),
  'Compradora Teste.*Compradora SA', 'prévia traz nome e organização do aceitante');
select matches((select body from public.get_agreement_preview('non_circumvention', 'c1000000-0000-0000-0000-000000000001')),
  'MINUTA', 'rascunho marcado como minuta');
select throws_ok($$ select public.accept_agreement('non_circumvention', 'c1000000-0000-0000-0000-000000000001', 'hash-velho') $$,
  '40001', null, 'aceite recusa se o texto mudou desde a leitura');
select lives_ok($$ select public.accept_agreement('non_circumvention', 'c1000000-0000-0000-0000-000000000001',
  (select body_hash from public.get_agreement_preview('non_circumvention', 'c1000000-0000-0000-0000-000000000001'))) $$,
  'comprador: aceita o termo da área');
select is((select rendered_body_hash = public.sha256_hex(rendered_body) from public.agreements),
  true, 'aceite guarda o texto e o hash dele');
select is((select party_org_id from public.agreements), 'b1000000-0000-0000-0000-000000000001'::uuid,
  'aceite registra a organização que recebeu');
select is((select tail_period_months from public.agreements), 24, 'aceite grava o prazo de cauda configurado');
select ok((select expires_at > now() + interval '11 months' from public.agreements), 'aceite expira conforme o modelo');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'allowed', 'comprador com termo: liberado');
select is((select registry_number from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001')),
  'MAT-T21', 'comprador COM termo: lê pela RPC');
reset role; -- access_log só a curadoria lê; conferimos como dono do banco
select is((select count(*)::int from public.access_log
            where opportunity_id = 'c1000000-0000-0000-0000-000000000001' and action = 'read_sensitive'),
  1, 'leitura com termo fica no access_log');
select is((select count(*)::int from public.access_log
            where opportunity_id = 'c1000000-0000-0000-0000-000000000001' and action = 'accept_agreement'),
  1, 'aceite também fica no access_log');
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'termo de uma área não abre outra');
select throws_ok($$ select public.accept_agreement('non_circumvention', 'c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'comprador: não aceita termo de área que não recebeu');
select throws_ok($$ select * from public.opportunity_sensitive $$, '42501', null, 'comprador: tabela sensível segue fechada');
select throws_ok($$ update public.agreements set expires_at = null $$, '42501', null, 'comprador: não altera aceite');
select throws_ok($$ insert into public.agreements (template_id, type, template_version, party_user_id, scope, rendered_body, rendered_body_hash, prev_hash, row_hash, seq)
  select id, type, version, 'a1000000-0000-0000-0000-000000000002', 'global', 'x', 'x', '', '', 0 from public.agreement_templates limit 1 $$,
  '42501', null, 'comprador: não forja aceite direto na tabela');

-- ---------------------------------------------------------------- colega da mesma organização (termo é pessoal)
select pg_temp.as_user('a1000000-0000-0000-0000-000000000003');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'needs_agreement',
  'colega: aceite é pessoal, precisa do próprio');
select is_empty($$ select 1 from public.agreements $$, 'colega: não vê aceite alheio');

-- ---------------------------------------------------------------- estranho
select pg_temp.as_user('a1000000-0000-0000-0000-000000000004');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'denied', 'outra organização: negado');
select throws_ok($$ select * from public.get_agreement_preview('non_circumvention', 'c1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'outra organização: nem vê o termo da área');

-- ---------------------------------------------------------------- corretor responsável
select pg_temp.as_user('a1000000-0000-0000-0000-000000000005');
select is((select registry_number from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001')),
  'MAT-T21', 'corretor responsável: lê o dado sensível da própria área');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'corretor: não lê área de outro');
select lives_ok($$ select public.accept_agreement('broker_partnership') $$, 'corretor: aceita o termo-mestre (global)');
select ok(public.has_agreement('broker_partnership', null), 'termo-mestre vale sem área');
select lives_ok($$ select public.accept_agreement('broker_area_authorization', 'c1000000-0000-0000-0000-000000000001') $$,
  'corretor: aceite de 1 clique na própria área');
select throws_ok($$ select public.accept_agreement('broker_area_authorization', 'c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'corretor: não autoriza área de outro');

-- ---------------------------------------------------------------- revogação e expiração
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.revoke_agreement((select id from public.agreements where type = 'non_circumvention'), '') $$,
  '22023', null, 'revogação exige motivo');
select lives_ok($$ select public.revoke_agreement((select id from public.agreements where type = 'non_circumvention'), 'Teste') $$,
  'curadoria: revoga aceite');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select throws_ok($$ select * from public.get_opportunity_sensitive('c1000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'aceite revogado: volta a bloquear');

-- Expirado: novo aceite com validade vencida (só o dono do banco consegue simular o tempo).
reset role;
select public.accept_agreement('non_circumvention', 'c1000000-0000-0000-0000-000000000001');
alter table public.agreements disable trigger agreements_append_only;
update public.agreements set expires_at = now() - interval '1 day'
 where type = 'non_circumvention' and id not in (select agreement_id from public.agreement_revocations);
alter table public.agreements enable trigger agreements_append_only;
set local role authenticated;
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');
select is(public.sensitive_access_state('c1000000-0000-0000-0000-000000000001'), 'needs_agreement',
  'aceite expirado: volta a pedir termo');

-- ---------------------------------------------------------------- versões dos termos
select throws_ok($$ select public.publish_agreement_template('non_circumvention', 'v2', 'T', 'Texto', 'opportunity') $$,
  '42501', null, 'comprador: não publica termo');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.publish_agreement_template('non_circumvention', '2026-11-v1', 'Termo v1',
  'Texto do advogado para {{memorial_number}}', 'opportunity', 12) $$, 'curadoria: publica nova versão sem deploy');
select is((select count(*)::int from public.agreement_templates where type = 'non_circumvention' and active), 1,
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
