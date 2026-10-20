-- Aceite da Fase 2 (bloco 2.3): corretor com termo-mestre cadastra e edita a própria área (dossiê,
-- geometria, dado sensível, fotos, documentos e autorização); não edita de outro nem depois da qualificação;
-- não se autoaprova a autorização; comprador nunca vê a autorização do proprietário.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a3000000-0000-0000-0000-000000000001', 'curadoria@t23.invalid', 'authenticated', 'authenticated', '{}'),
  ('a3000000-0000-0000-0000-000000000002', 'corretor@t23.invalid', 'authenticated', 'authenticated', '{"signup_kind":"broker"}'),
  ('a3000000-0000-0000-0000-000000000003', 'outro.corretor@t23.invalid', 'authenticated', 'authenticated', '{"signup_kind":"broker"}'),
  ('a3000000-0000-0000-0000-000000000004', 'comprador@t23.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}');
insert into public.platform_admins (user_id) values ('a3000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a3000000-%';
insert into public.brokers (user_id, creci_number, verification_status) values
  ('a3000000-0000-0000-0000-000000000002', '23-F', 'approved'),
  ('a3000000-0000-0000-0000-000000000003', '24-F', 'approved');
insert into public.organizations (id, name, type) values ('b3000000-0000-0000-0000-000000000001', 'Compra23', 'developer');
insert into public.organization_members (organization_id, user_id, role) values
  ('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004', 'admin');

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- ---------------------------------------------------------------- termo-mestre
select pg_temp.as_user('a3000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.opportunities (id, city, responsible_party_user_id)
  values ('c3000000-0000-0000-0000-000000000001', 'Porto Alegre', 'a3000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'corretor sem termo-mestre não cadastra área');
select lives_ok($$ select public.accept_agreement('broker_partnership') $$, 'corretor aceita o termo-mestre');
select lives_ok($$ insert into public.opportunities (id, city, responsible_party_user_id)
  values ('c3000000-0000-0000-0000-000000000001', 'Porto Alegre', 'a3000000-0000-0000-0000-000000000002') $$,
  'com termo-mestre, cadastra');
select ok(public.can_edit_opportunity('c3000000-0000-0000-0000-000000000001'), 'responsável edita a área captada');

-- ---------------------------------------------------------------- geometria
select throws_ok($$ select public.set_opportunity_geometry_geojson('c3000000-0000-0000-0000-000000000001',
  '{"type":"Polygon","coordinates":[[[-30.03,-51.2],[-30.03,-51.19],[-30.04,-51.19],[-30.03,-51.2]]]}') $$,
  '22023', null, 'coordenadas invertidas (fora do Brasil) são recusadas');
select throws_ok($$ select public.set_opportunity_geometry_geojson('c3000000-0000-0000-0000-000000000001',
  '{"type":"LineString","coordinates":[[-51.2,-30.03],[-51.19,-30.03]]}') $$,
  '22023', null, 'linha não é aceita (polígono ou ponto)');
select lives_ok($$ select public.set_opportunity_geometry_geojson('c3000000-0000-0000-0000-000000000001',
  '{"type":"Polygon","coordinates":[[[-51.2,-30.03,10],[-51.19,-30.03,10],[-51.19,-30.04,10],[-51.2,-30.03,10]]]}') $$,
  'corretor grava o polígono (Z descartado)');
select is((public.get_opportunity_geometry('c3000000-0000-0000-0000-000000000001') ->> 'type'), 'Polygon',
  'editor relê a geometria em GeoJSON');
select isnt((select approx_lat from public.opportunities_blind where id = 'c3000000-0000-0000-0000-000000000001'), null,
  'versão cega ganha a localização aproximada');

-- ---------------------------------------------------------------- dado sensível
select lives_ok($$ select public.upsert_opportunity_sensitive('c3000000-0000-0000-0000-000000000001',
  'MAT-23', 'Rua Exata 23', 'Dono 23', '{"phone":"+5551900000023"}', null) $$, 'corretor grava o dado sensível');
select lives_ok($$ select public.upsert_opportunity_sensitive('c3000000-0000-0000-0000-000000000001',
  'MAT-23B', 'Rua Exata 23', 'Dono 23', '{}', 'nota') $$, 'e corrige (upsert)');
select is((select registry_number from public.get_opportunity_sensitive('c3000000-0000-0000-0000-000000000001')),
  'MAT-23B', 'corretor relê o que gravou');
select throws_ok($$ select * from public.opportunity_sensitive $$, '42501', null, 'tabela sensível segue fechada');

-- ---------------------------------------------------------------- fotos e documentos
select lives_ok($$ insert into public.opportunity_media (opportunity_id, storage_path, is_blind_safe)
  values ('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001/foto.jpg', true) $$,
  'corretor registra foto da própria área');
select lives_ok($$ insert into public.opportunity_documents (opportunity_id, kind, storage_path, file_name, review_status)
  values ('c3000000-0000-0000-0000-000000000001', 'owner_authorization',
          'c3000000-0000-0000-0000-000000000001/aut.pdf', 'aut.pdf', 'accepted') $$,
  'corretor anexa a autorização do proprietário...');
select is((select review_status::text from public.opportunity_documents where file_name = 'aut.pdf'), 'pending',
  '...mas não se autoaprova (fica aguardando a curadoria)');
select throws_ok($$ insert into public.opportunity_documents (opportunity_id, kind, sensitivity, storage_path, file_name)
  values ('c3000000-0000-0000-0000-000000000001', 'owner_authorization', 'blind', 'x/aut2.pdf', 'aut2.pdf') $$,
  '23514', null, 'autorização do proprietário nunca é "cega"');
select throws_ok($$ select public.review_owner_authorization((select id from public.opportunity_documents where file_name = 'aut.pdf'), true) $$,
  '42501', null, 'corretor não revisa a autorização');
select lives_ok($$ select public.accept_agreement('broker_area_authorization', 'c3000000-0000-0000-0000-000000000001') $$,
  'corretor faz o aceite de 1 clique da área');

-- ---------------------------------------------------------------- outro corretor
select pg_temp.as_user('a3000000-0000-0000-0000-000000000003');
select ok(not public.can_edit_opportunity('c3000000-0000-0000-0000-000000000001'), 'outro corretor não edita');
select throws_ok($$ select public.set_opportunity_geometry_geojson('c3000000-0000-0000-0000-000000000001', null) $$,
  '42501', null, 'outro corretor não mexe na geometria');
select throws_ok($$ select public.upsert_opportunity_sensitive('c3000000-0000-0000-0000-000000000001', 'X', null, null, null, null) $$,
  '42501', null, 'outro corretor não grava dado sensível');
select throws_ok($$ select public.get_opportunity_geometry('c3000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'outro corretor não lê a localização exata');
select is_empty($$ select 1 from public.opportunity_documents $$, 'outro corretor não vê documentos');
select throws_ok($$ insert into public.opportunity_media (opportunity_id, storage_path)
  values ('c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001/intruso.jpg') $$,
  '42501', null, 'outro corretor não envia foto');

-- ---------------------------------------------------------------- curadoria
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.review_owner_authorization((select id from public.opportunity_documents where file_name = 'aut.pdf'), true) $$,
  'curadoria confere a autorização');
select lives_ok($$ update public.opportunities set status = 'qualifying' where id = 'c3000000-0000-0000-0000-000000000001' $$,
  'curadoria passa a área para qualificação');

-- ---------------------------------------------------------------- corretor depois da qualificação
select pg_temp.as_user('a3000000-0000-0000-0000-000000000002');
select ok(public.can_edit_opportunity('c3000000-0000-0000-0000-000000000001'), 'qualificando: corretor ainda edita');
reset role;
update public.opportunities set status = 'qualified' where id = 'c3000000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(not public.can_edit_opportunity('c3000000-0000-0000-0000-000000000001'), 'qualificada: edição só da curadoria');
select throws_ok($$ select public.upsert_opportunity_sensitive('c3000000-0000-0000-0000-000000000001', 'X', null, null, null, null) $$,
  '42501', null, 'qualificada: corretor não grava dado sensível');
select results_eq($$ with d as (delete from public.opportunity_documents returning 1) select count(*)::int from d $$,
  array[0], 'corretor não apaga a autorização conferida');

-- ---------------------------------------------------------------- comprador que recebeu
reset role;
insert into public.distributions (opportunity_id, recipient_user_id, recipient_org_id, channel, idempotency_key)
values ('c3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004',
        'b3000000-0000-0000-0000-000000000001', 'email', 't23-1');
insert into public.opportunity_documents (opportunity_id, kind, sensitivity, storage_path, file_name) values
  ('c3000000-0000-0000-0000-000000000001', 'technical', 'blind', 'c3/estudo.pdf', 'estudo.pdf'),
  ('c3000000-0000-0000-0000-000000000001', 'registry', 'restricted', 'c3/matricula.pdf', 'matricula.pdf');
set local role authenticated;
select pg_temp.as_user('a3000000-0000-0000-0000-000000000004');
select results_eq($$ select file_name from public.opportunity_documents order by file_name $$,
  $$ values ('estudo.pdf'::text) $$, 'comprador sem termo: só o documento cego (nunca a autorização)');
select lives_ok($$ select public.accept_agreement('non_circumvention', 'c3000000-0000-0000-0000-000000000001') $$,
  'comprador aceita o termo');
select results_eq($$ select file_name from public.opportunity_documents order by file_name $$,
  $$ values ('estudo.pdf'::text), ('matricula.pdf'::text) $$, 'com termo: também o restrito, nunca a autorização');

select * from finish();
rollback;
