-- Aceite da Fase 3B (Modelo 1, D030): corretor sem termo-mestre não cadastra; área sem declaração não publica
-- (nem pela API); o corretor publica sozinho e o match é aprovado automaticamente; organização excluída (por
-- cadastro, por nome digitado ou por apresentação legada) nunca dá match; o comprador que recebeu vê o polígono,
-- todas as fotos e o contato do corretor, nunca o proprietário; suspensão; tipo urbana/rural + edificação.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-000000000001', 'curadoria@t3b.invalid', 'authenticated', 'authenticated', '{"full_name":"Curadora 3B"}'),
  ('a7000000-0000-0000-0000-000000000002', 'corretor@t3b.invalid', 'authenticated', 'authenticated', '{"full_name":"Corretor 3B","signup_kind":"broker"}'),
  ('a7000000-0000-0000-0000-000000000003', 'semtermo@t3b.invalid', 'authenticated', 'authenticated', '{"full_name":"Sem Termo","signup_kind":"broker"}'),
  ('a7000000-0000-0000-0000-000000000004', 'comprador@t3b.invalid', 'authenticated', 'authenticated', '{"full_name":"Comprador 3B","signup_kind":"buyer"}'),
  ('a7000000-0000-0000-0000-000000000005', 'estranho@t3b.invalid', 'authenticated', 'authenticated', '{"full_name":"Estranho 3B","signup_kind":"buyer"}');
insert into public.platform_admins (user_id) values ('a7000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a7000000-%';
update public.profiles set phone = '51988887777' where user_id = 'a7000000-0000-0000-0000-000000000002';
insert into public.brokers (user_id, creci_number, creci_state, verification_status, creci_status) values
  ('a7000000-0000-0000-0000-000000000002', '7001-F', 'RS', 'approved', 'active'),
  ('a7000000-0000-0000-0000-000000000003', '7002-F', 'RS', 'approved', 'active');

insert into public.organizations (id, name, type) values
  ('b7000000-0000-0000-0000-000000000001', 'Compradora X 3B', 'developer'),
  ('b7000000-0000-0000-0000-000000000002', 'Empresa Y 3B', 'developer'),
  ('b7000000-0000-0000-0000-000000000003', 'Legada Z 3B', 'builder'),
  ('b7000000-0000-0000-0000-000000000004', 'Estranha 3B', 'builder');
insert into public.organization_members (organization_id, user_id, role) values
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000004', 'admin'),
  ('b7000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000005', 'admin');
insert into public.buyer_theses (organization_id, name, asset_types, cities) values
  ('b7000000-0000-0000-0000-000000000001', 'Tese X', '{area_urbana}', '{Cidade 3B}'),
  ('b7000000-0000-0000-0000-000000000002', 'Tese Y', '{area_urbana}', '{Cidade 3B}'),
  ('b7000000-0000-0000-0000-000000000003', 'Tese Z', '{area_urbana}', '{Cidade 3B}'),
  ('b7000000-0000-0000-0000-000000000004', 'Tese galpão', '{area_urbana}', '{Cidade 3B}');
update public.buyer_theses set building_filter = 'only' where name = 'Tese galpão';

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.match_status(p_thesis text) returns text language sql security definer as $$
  select m.status::text || case when m.still_matches then '' else ':stale' end
    from public.matches m join public.buyer_theses t on t.id = m.thesis_id
    join public.opportunities o on o.id = m.opportunity_id
   where t.name = p_thesis and o.memorial_number = 'MD-3B-1';
$$;
grant execute on function pg_temp.match_status(text) to authenticated;

-- ---------------------------------------------------------------- tipo de ativo do Modelo 1
select throws_ok($$ insert into public.opportunities (memorial_number, asset_type) values ('MD-3B-X', 'terreno') $$,
  '23514', null, 'tipo antigo ("terreno") não é mais aceito');
select is((select value from public.platform_settings where key = 'asset_types') @> '[{"value": "area_urbana"}, {"value": "area_rural"}]',
  true, 'tipos de ativo: área urbana e área rural');

-- ---------------------------------------------------------------- termo-mestre antes de cadastrar
set local role authenticated;
select pg_temp.as_user('a7000000-0000-0000-0000-000000000003');
select throws_ok($$ insert into public.opportunities (city, responsible_party_user_id)
  values ('Cidade 3B', 'a7000000-0000-0000-0000-000000000003') $$, '42501', null,
  'corretor sem termo-mestre não cadastra área');

select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.accept_agreement('broker_partnership') $$, 'corretor assina o termo-mestre');
select lives_ok($$ insert into public.opportunities (id, memorial_number, city, neighborhood, state, area_m2, asset_type, zoning,
                                                    negotiation_models, project_types, asking_value, responsible_party_user_id)
  values ('c7000000-0000-0000-0000-000000000001', 'MD-3B-1', 'Cidade 3B', 'Centro 3B', 'RS', 8000, 'area_urbana', 'Mista 3B',
          '{swap}', '{vertical}', 15000000, 'a7000000-0000-0000-0000-000000000002') $$,
  'com o termo, cadastra a área');
select lives_ok($$ select public.set_opportunity_geometry_geojson('c7000000-0000-0000-0000-000000000001',
  '{"type":"Polygon","coordinates":[[[-51.20,-30.00],[-51.19,-30.00],[-51.19,-30.01],[-51.20,-30.01],[-51.20,-30.00]]]}') $$,
  'corretor marca o polígono');
select lives_ok($$ insert into public.opportunity_media (opportunity_id, storage_path, is_blind_safe)
  values ('c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001/f.jpg', false) $$,
  'corretor envia uma foto (sem marcar versão cega)');
select lives_ok($$ select public.upsert_opportunity_sensitive('c7000000-0000-0000-0000-000000000001', 'MAT-3B', 'Rua 3B, 1',
  'Dona 3B', '{"phone": "51911112222"}', 'nota') $$, 'corretor grava o proprietário');

-- ---------------------------------------------------------------- travas: declaração, anexo, mandato
select ok((select array_agg(b) from public.opportunity_publish_blockers('c7000000-0000-0000-0000-000000000001') b)
          @> array['no_area_term', 'no_owner_authorization', 'no_mandate'], 'faltam declaração, anexo e mandato');
select throws_ok($$ select public.publish_opportunity('c7000000-0000-0000-0000-000000000001') $$, '23514', null,
  'sem declaração, o corretor não publica');
select throws_ok($$ update public.opportunities set status = 'qualified', published_at = now()
  where id = 'c7000000-0000-0000-0000-000000000001' $$, '42501', null, 'nem por update direto na API');

select throws_ok($$ select public.set_area_mandate('c7000000-0000-0000-0000-000000000001', 'unknown') $$, '22023', null,
  'mandato "desconhecido" não pode ser declarado');
select lives_ok($$ select public.set_area_mandate('c7000000-0000-0000-0000-000000000001', 'exclusive') $$,
  'corretor declara o mandato');
select lives_ok($$ insert into public.opportunity_documents (opportunity_id, kind, sensitivity, storage_path, file_name)
  values ('c7000000-0000-0000-0000-000000000001', 'owner_authorization', 'restricted', 'c7/aut.pdf', 'aut.pdf') $$,
  'corretor anexa a autorização escrita');
select results_eq($$ select b from public.opportunity_publish_blockers('c7000000-0000-0000-0000-000000000001') b $$,
  $$ values ('no_area_term'::text) $$, 'anexo pendente de revisão basta (sem curadoria prévia); falta a declaração');
select throws_ok($$ select public.publish_opportunity('c7000000-0000-0000-0000-000000000001') $$, '23514', null,
  'sem declaração, segue sem publicar');

-- Lista de exclusão: por nome digitado (casa com a organização cadastrada) e só para quem edita.
select lives_ok($$ insert into public.opportunity_exclusions (opportunity_id, company_name)
  values ('c7000000-0000-0000-0000-000000000001', '  empresa   y 3b ') $$, 'corretor informa a quem já ofereceu');
select is((select organization_id::text || '|' || company_name || '|' || source from public.opportunity_exclusions),
  'b7000000-0000-0000-0000-000000000002|Empresa Y 3B|broker', 'nome digitado ligado à organização cadastrada');
select throws_ok($$ insert into public.opportunity_exclusions (opportunity_id, company_name)
  values ('c7000000-0000-0000-0000-000000000001', 'Empresa Y 3B') $$, '23505', null, 'mesma empresa não entra duas vezes');

select lives_ok($$ select public.accept_agreement('broker_area_authorization', 'c7000000-0000-0000-0000-000000000001') $$,
  'corretor assina a declaração de autorização da área');
select is_empty($$ select public.opportunity_publish_blockers('c7000000-0000-0000-0000-000000000001') $$, 'nada mais trava');

-- Apresentação legada (planilha) para Z: também exclui.
reset role;
insert into public.distributions (opportunity_id, recipient_org_id, source, idempotency_key, legacy_note)
values ('c7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000003', 'legacy', 't3b-legacy', 'Land Bank');
set local role authenticated;

-- ---------------------------------------------------------------- corretor publica sozinho → match automático
select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.publish_opportunity('c7000000-0000-0000-0000-000000000001', 'Publicada pelo corretor') $$,
  'corretor publica sozinho');
select results_eq($$ select status::text, published_at is not null from public.opportunities where id = 'c7000000-0000-0000-0000-000000000001' $$,
  $$ values ('qualified'::text, true) $$, 'publicada = qualificada com data');
select is((select actor_id::text from public.opportunity_events
            where opportunity_id = 'c7000000-0000-0000-0000-000000000001' and kind = 'published'),
  'a7000000-0000-0000-0000-000000000002', 'histórico registra o corretor como autor da publicação');
select ok(not public.can_edit_opportunity('c7000000-0000-0000-0000-000000000001'), 'publicada: corretor não edita mais');
select throws_ok($$ insert into public.opportunity_exclusions (opportunity_id, company_name)
  values ('c7000000-0000-0000-0000-000000000001', 'Outra') $$, '42501', null, 'publicada: corretor não mexe na lista');

select is(pg_temp.match_status('Tese X'), 'approved', 'match com X aprovado automaticamente (D030)');
select is_empty($$ select 1 from public.matches $$, 'corretor não lê a tabela de matches (só a curadoria)');
reset role;
select is((select decision_note from public.matches m join public.buyer_theses t on t.id = m.thesis_id where t.name = 'Tese X'),
  'Aprovado automaticamente (nota ≥ 40)', 'auto-aprovação explica a nota');
set local role authenticated;
select is(pg_temp.match_status('Tese Y'), null, 'organização da lista de exclusão nunca dá match');
select is(pg_temp.match_status('Tese Z'), null, 'organização com apresentação legada nunca dá match');
select is(pg_temp.match_status('Tese galpão'), null, 'tese que pede galpão/edificação não casa com área sem edificação');

-- Exclusão depois do match aprovado: o par fica marcado "não combina mais".
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.opportunity_exclusions (opportunity_id, organization_id, company_name)
  values ('c7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'x') $$,
  'curadoria acrescenta X à lista');
select is(pg_temp.match_status('Tese X'), 'approved:stale', 'aprovado continua no histórico, mas "não combina mais"');
select is((select source from public.opportunity_exclusions where organization_id = 'b7000000-0000-0000-0000-000000000001'),
  'curation', 'origem registrada como curadoria');
select lives_ok($$ delete from public.opportunity_exclusions where organization_id = 'b7000000-0000-0000-0000-000000000001' $$,
  'curadoria tira X da lista');
select is(pg_temp.match_status('Tese X'), 'approved', 'volta a combinar');

-- ---------------------------------------------------------------- o que o comprador que recebeu vê
reset role;
insert into public.distributions (opportunity_id, recipient_user_id, recipient_org_id, channel, source, idempotency_key)
values ('c7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000004',
        'b7000000-0000-0000-0000-000000000001', 'email', 'platform', 't3b-k1');
set local role authenticated;
select pg_temp.as_user('a7000000-0000-0000-0000-000000000004');
select is((public.get_opportunity_geometry('c7000000-0000-0000-0000-000000000001') ->> 'type'), 'Polygon',
  'comprador que recebeu vê o polígono exato');
select is((select count(*)::int from public.opportunity_media where opportunity_id = 'c7000000-0000-0000-0000-000000000001'),
  1, 'comprador vê a foto (não há mais "versão cega" para ele)');
select results_eq($$ select full_name, email, phone, creci from public.get_opportunity_broker_contact('c7000000-0000-0000-0000-000000000001') $$,
  $$ values ('Corretor 3B'::text, 'corretor@t3b.invalid'::text, '51988887777'::text, '7001-F-RS'::text) $$,
  'comprador vê o contato do corretor');
select throws_ok($$ select * from public.get_opportunity_sensitive('c7000000-0000-0000-0000-000000000001') $$, '42501', null,
  'comprador NUNCA lê o proprietário pela API');
select is_empty($$ select 1 from public.opportunity_exclusions $$, 'comprador não vê a lista de exclusão');
select is_empty($$ select 1 from public.opportunity_documents where kind = 'owner_authorization' $$,
  'comprador não vê a autorização do proprietário');
reset role;
select is((select count(*)::int from public.access_log where action = 'read_geometry'
            and actor_id = 'a7000000-0000-0000-0000-000000000004'), 1, 'leitura do polígono pelo comprador fica no access_log');
set local role authenticated;

select pg_temp.as_user('a7000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.get_opportunity_geometry('c7000000-0000-0000-0000-000000000001') $$, '42501', null,
  'quem não recebeu não vê o polígono');
select throws_ok($$ select * from public.get_opportunity_broker_contact('c7000000-0000-0000-0000-000000000001') $$, '42501', null,
  'quem não recebeu não vê o contato do corretor');
select throws_ok($$ select public.set_area_mandate('c7000000-0000-0000-0000-000000000001', 'none') $$, '42501', null,
  'comprador não mexe no mandato');

-- ---------------------------------------------------------------- suspensão pela curadoria
select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.suspend_opportunity('c7000000-0000-0000-0000-000000000001', 'x') $$, '42501', null,
  'corretor não suspende');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.suspend_opportunity('c7000000-0000-0000-0000-000000000001', 'Autorização ilegível') $$,
  'curadoria suspende com motivo');
select is(pg_temp.match_status('Tese X'), 'approved:stale', 'suspensa sai do match');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select ok(public.can_edit_opportunity('c7000000-0000-0000-0000-000000000001'), 'suspensa volta para o corretor corrigir');
select throws_ok($$ select public.publish_opportunity('c7000000-0000-0000-0000-000000000001') $$, '23514', 'Área ainda não publicável: suspended',
  'mas não republica enquanto suspensa');
select throws_ok($$ update public.opportunities set suspended_at = null where id = 'c7000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'nem tira a suspensão por update direto na API');
select throws_ok($$ update public.opportunities set mandate_status = 'none' where id = 'c7000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'mandato só pela declaração (RPC), nunca por update direto');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.reinstate_opportunity('c7000000-0000-0000-0000-000000000001', 'Nova autorização ok') $$,
  'curadoria reabilita');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.publish_opportunity('c7000000-0000-0000-0000-000000000001') $$, 'corretor republica');
select is(pg_temp.match_status('Tese X'), 'approved', 'match volta');

-- ---------------------------------------------------------------- configuração do anexo, recusa e área rural
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.review_owner_authorization((select id from public.opportunity_documents
  where opportunity_id = 'c7000000-0000-0000-0000-000000000001' and kind = 'owner_authorization'), false, 'Não é do dono') $$,
  'curadoria recusa o anexo');
select ok('no_owner_authorization' = any (array(select public.opportunity_publish_blockers('c7000000-0000-0000-0000-000000000001'))),
  'anexo recusado volta a travar');
reset role;
update public.platform_settings set value = 'false' where key = 'require_owner_authorization_file';
update public.opportunities set asset_type = 'area_rural', neighborhood = null, zoning = null
 where id = 'c7000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select is_empty($$ select public.opportunity_publish_blockers('c7000000-0000-0000-0000-000000000001') $$,
  'anexo dispensado pela configuração; área rural não exige bairro nem zoneamento');

-- ---------------------------------------------------------------- invariante (regressão do deploy de 2026-11-10)
reset role;
select is_empty($$ select 1 from public.matches m join public.opportunities o on o.id = m.opportunity_id
                     where m.status = 'approved' and m.decided_by is null
                       and m.decision_note like 'Aprovado automaticamente%'
                       and exists (select 1 from public.publish_blockers_core(o)) $$,
  'nenhum match aprovado automaticamente em área com trava de publicação (seed incluído)');

select * from finish();
rollback;
