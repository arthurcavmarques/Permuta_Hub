-- Aceite da Fase 2 (bloco 2.4): lead entra pelo formulário, é qualificado e vira dossiê publicável sem
-- planilha; área sem autorização, sem responsável ou sem mandato (regra 4) não publica; histórico com autor e nota.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-000000000001', 'curadoria@t24.invalid', 'authenticated', 'authenticated', '{"full_name":"Curadora"}'),
  ('a4000000-0000-0000-0000-000000000002', 'corretor@t24.invalid', 'authenticated', 'authenticated', '{"full_name":"Corretor 24","signup_kind":"broker"}'),
  ('a4000000-0000-0000-0000-000000000003', 'corretor.pendente@t24.invalid', 'authenticated', 'authenticated', '{"signup_kind":"broker"}'),
  ('a4000000-0000-0000-0000-000000000004', 'dona@t24.invalid', 'authenticated', 'authenticated', '{"signup_kind":"owner"}');
insert into public.platform_admins (user_id) values ('a4000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a4000000-%';
insert into public.brokers (user_id, creci_number, verification_status) values
  ('a4000000-0000-0000-0000-000000000002', '24-F', 'approved'),
  ('a4000000-0000-0000-0000-000000000003', '25-F', 'pending');
update public.platform_settings set value = '1000' where key like 'lead_rate_limit%';

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- ---------------------------------------------------------------- lead do proprietário
select pg_temp.as_user('a4000000-0000-0000-0000-000000000004');
select public.accept_agreement('owner_terms');
select public.submit_owner_lead('owner', 'Esquina conhecida', 'Porto Alegre', 'Menino Deus', 'RS', 6000, '{swap}',
  'Tem árvores', 'Dona 24', '+5551966660000', 'dona@t24.invalid', true);

-- ---------------------------------------------------------------- fila de leads (curadoria)
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.curate_lead((select id from public.owner_leads), 'discarded') $$,
  '22023', null, 'descartar exige motivo');
select throws_ok($$ select public.curate_lead((select id from public.owner_leads), 'forwarded', null,
  'a4000000-0000-0000-0000-000000000003') $$, '23514', null, 'não encaminha a corretor sem CRECI verificado');
select lives_ok($$ select public.curate_lead((select id from public.owner_leads), 'qualifying', 'Foto aérea do terreno') $$,
  'curadoria pede dados');
select is((select count(*)::int from public.email_outbox where template_key = 'lead_request_info'), 1,
  'pedido de dados vai por e-mail a quem ofereceu');
select lives_ok($$ select public.curate_lead((select id from public.owner_leads), 'forwarded', 'Atender esta semana',
  'a4000000-0000-0000-0000-000000000002') $$, 'curadoria encaminha ao corretor');
select is((select count(*)::int from public.email_outbox where template_key = 'lead_forwarded'), 1,
  'corretor é avisado por e-mail');

select pg_temp.as_user('a4000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.owner_leads), 1, 'corretor vê o lead encaminhado a ele');
select throws_ok($$ select public.convert_lead((select id from public.owner_leads)) $$, '42501', null,
  'corretor não converte lead');

select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.convert_lead((select id from public.owner_leads)) $$, 'curadoria converte em oportunidade');
select throws_ok($$ select public.convert_lead((select id from public.owner_leads)) $$, 'P0002', null,
  'converter de novo não duplica');
select results_eq($$ select o.city, o.neighborhood, o.area_m2::int, o.status::text, o.responsible_party_user_id
                       from public.opportunities o join public.owner_leads l on l.converted_opportunity_id = o.id $$,
  $$ values ('Porto Alegre'::text, 'Menino Deus'::text, 6000, 'qualifying'::text, 'a4000000-0000-0000-0000-000000000002'::uuid) $$,
  'MD pré-preenchido; responsável = corretor que recebeu o lead');
select is((select owner_name from public.get_opportunity_sensitive(
            (select converted_opportunity_id from public.owner_leads))), 'Dona 24',
  'contato do proprietário vai para o dado sensível');
select is((select count(*)::int from public.opportunity_events e join public.owner_leads l on l.converted_opportunity_id = e.opportunity_id
            where e.kind = 'created' and e.note = 'Convertida do lead de captação'), 1, 'histórico registra a criação com nota');

-- ---------------------------------------------------------------- publicável
create temporary table t24 as select converted_opportunity_id as id from public.owner_leads;
grant select on t24 to authenticated;
select ok((select array_agg(b) from public.opportunity_publish_blockers((select id from t24)) b)
          @> array['missing_zoning', 'missing_blind_photo', 'missing_geometry', 'no_area_term', 'no_owner_authorization', 'no_mandate'],
  'diz o que falta para publicar');
select throws_ok($$ select public.publish_opportunity((select id from t24)) $$, '23514', null, 'com pendências, não publica');
select throws_ok($$ update public.opportunities set status = 'qualified' where id = (select id from t24) $$, '23514', null,
  'nem por update direto na API');
select throws_ok($$ select public.curate_opportunity((select id from t24), p_status => 'distributing') $$, '22023', null,
  'nem pulando para distribuição');

-- Completa o dossiê (como curadoria, que também edita).
select lives_ok($$ update public.opportunities set zoning = 'Mista' where id = (select id from t24) $$, 'curadoria completa o zoneamento');
select lives_ok($$ select public.set_opportunity_geometry_geojson((select id from t24),
  '{"type":"Point","coordinates":[-51.22,-30.05]}') $$, 'curadoria marca a localização');
select lives_ok($$ insert into public.opportunity_media (opportunity_id, storage_path, is_blind_safe)
  select id, id || '/f.jpg', true from t24 $$, 'foto liberada para a versão cega');
select lives_ok($$ insert into public.opportunity_documents (opportunity_id, kind, storage_path, file_name)
  select id, 'owner_authorization', id || '/a.pdf', 'a.pdf' from t24 $$, 'autorização anexada');
select lives_ok($$ select public.review_owner_authorization((select d.id from public.opportunity_documents d join t24 on t24.id = d.opportunity_id), true) $$,
  'autorização conferida');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.accept_agreement('broker_area_authorization', (select id from t24)) $$, 'corretor dá o aceite da área');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select results_eq($$ select b from public.opportunity_publish_blockers((select id from t24)) b $$,
  $$ values ('no_mandate'::text) $$, 'só falta o mandato');

-- Regra 4 configurável.
reset role;
update public.platform_settings set value = 'true' where key = 'allow_distribution_without_mandate';
set local role authenticated;
select is_empty($$ select public.opportunity_publish_blockers((select id from t24)) $$,
  'com "distribuir sem mandato" ligado, o mandato deixa de travar');
reset role;
update public.platform_settings set value = 'false' where key = 'allow_distribution_without_mandate';
set local role authenticated;

select throws_ok($$ select public.curate_opportunity((select id from t24), p_mandate => 'being_obtained') $$ || '; ' ||
  $$ select public.publish_opportunity((select id from t24)) $$, '23514', null, 'mandato "em obtenção" não publica (padrão)');
select lives_ok($$ select public.curate_opportunity((select id from t24), p_mandate => 'exclusive', p_note => 'Contrato assinado') $$,
  'curadoria registra mandato exclusivo com nota');
select lives_ok($$ select public.publish_opportunity((select id from t24), 'Pronta para distribuir') $$, 'publica sem pendências');
select results_eq($$ select status::text, published_at is not null from public.opportunities where id = (select id from t24) $$,
  $$ values ('qualified'::text, true) $$, 'publicada = qualificada com data de publicação');
select is((select count(*)::int from public.opportunity_events where opportunity_id = (select id from t24)
            and kind in ('mandate', 'published', 'status') and actor_id = 'a4000000-0000-0000-0000-000000000001'), 3,
  'histórico: mandato, status e publicação com autor (tentativa falha não deixa rastro)');
select is((select note from public.opportunity_events where opportunity_id = (select id from t24) and kind = 'published'),
  'Pronta para distribuir', 'nota da publicação no histórico');
select throws_ok($$ select public.curate_opportunity((select id from t24), p_responsible_user_id => 'a4000000-0000-0000-0000-000000000003') $$,
  '23514', null, 'responsável precisa ser corretor verificado');

-- ---------------------------------------------------------------- histórico e logs
select throws_ok($$ update public.opportunity_events set note = 'x' $$, '42501', null, 'histórico é append-only');
select ok((select count(*) from public.admin_access_log(p_action => 'write_geometry')) >= 1, 'curadoria lê o log de acesso com filtro');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000002');
select throws_ok($$ select * from public.admin_access_log() $$, '42501', null, 'corretor não lê o log de acesso');
select ok((select count(*) from public.opportunity_events where opportunity_id = (select id from t24)) > 0,
  'corretor responsável lê o histórico da própria área');

select * from finish();
rollback;
