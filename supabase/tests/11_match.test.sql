-- Aceite da Fase 3: dado um conjunto de teses e áreas de teste, os matches esperados aparecem e os indevidos não;
-- cada match mostra motivos legíveis; alterar uma tese recalcula. Mais: bordas (metragem no limite, tese sem
-- ticket, região vazia), permissões das teses e dos matches, auto-aprovação, decisão preservada, corretor padrão
-- das áreas do proprietário e as colunas novas do dossiê cego.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-000000000001', 'curadoria@t3.invalid', 'authenticated', 'authenticated', '{"full_name":"Curadora 3"}'),
  ('a6000000-0000-0000-0000-000000000002', 'comprador@t3.invalid', 'authenticated', 'authenticated', '{"full_name":"Comprador 3","signup_kind":"buyer"}'),
  ('a6000000-0000-0000-0000-000000000003', 'leitor@t3.invalid', 'authenticated', 'authenticated', '{"full_name":"Leitor 3","signup_kind":"buyer"}'),
  ('a6000000-0000-0000-0000-000000000004', 'outro@t3.invalid', 'authenticated', 'authenticated', '{"full_name":"Outro 3","signup_kind":"buyer"}'),
  ('a6000000-0000-0000-0000-000000000005', 'corretor@t3.invalid', 'authenticated', 'authenticated', '{"full_name":"Corretor 3","signup_kind":"broker"}');
insert into public.platform_admins (user_id) values ('a6000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a6000000-%';
insert into public.brokers (user_id, creci_number, verification_status, creci_status) values
  ('a6000000-0000-0000-0000-000000000005', '3-F', 'approved', 'active');

insert into public.organizations (id, name, type) values
  ('b6000000-0000-0000-0000-000000000001', 'Incorporadora T3', 'developer'),
  ('b6000000-0000-0000-0000-000000000002', 'Outra T3', 'builder');
insert into public.organization_members (organization_id, user_id, role) values
  ('b6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002', 'admin'),
  ('b6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000003', 'viewer'),
  ('b6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000004', 'admin');

-- Áreas de teste (qualificadas, salvo indicação)
insert into public.opportunities (id, memorial_number, asset_type, status, area_m2, city, neighborhood, state,
                                  region_tags, zoning, coefficient, project_types, negotiation_models, asking_value,
                                  mandate_status, published_at) values
  ('c6000000-0000-0000-0000-000000000001', 'T3-001', 'terreno', 'qualified', 10000, 'Cidade Teste', 'Centro T3', 'RS',
   '{Zona T3}', 'Mista 03', 2.5, '{residencial vertical}', '{swap}', 20000000, 'exclusive', now()),
  -- metragem exatamente no limite superior (20.000)
  ('c6000000-0000-0000-0000-000000000002', 'T3-002', 'terreno', 'qualified', 20000, 'Cidade Teste', 'Bairro T3', 'RS',
   '{}', null, null, '{}', '{swap,sale}', null, 'exclusive', now()),
  -- fora da metragem
  ('c6000000-0000-0000-0000-000000000003', 'T3-003', 'terreno', 'qualified', 20001, 'Cidade Teste', 'Centro T3', 'RS',
   '{}', 'Mista 03', 2.5, '{residencial vertical}', '{swap}', null, 'exclusive', now()),
  -- tipo de ativo errado
  ('c6000000-0000-0000-0000-000000000004', 'T3-004', 'galpao', 'qualified', 10000, 'Cidade Teste', 'Centro T3', 'RS',
   '{}', null, null, '{}', '{swap}', null, 'exclusive', now()),
  -- outra cidade
  ('c6000000-0000-0000-0000-000000000005', 'T3-005', 'terreno', 'qualified', 10000, 'Outra Cidade', 'X', 'SC',
   '{}', null, null, '{}', '{swap}', null, 'exclusive', now()),
  -- ainda qualificando: não entra
  ('c6000000-0000-0000-0000-000000000006', 'T3-006', 'terreno', 'qualifying', 10000, 'Cidade Teste', 'Centro T3', 'RS',
   '{}', null, null, '{}', '{swap}', null, 'exclusive', null),
  -- valor acima do ticket
  ('c6000000-0000-0000-0000-000000000007', 'T3-007', 'terreno', 'qualified', 10000, 'Cidade Teste', 'Centro T3', 'RS',
   '{}', null, null, '{}', '{swap}', 90000000, 'exclusive', now()),
  -- formato só venda
  ('c6000000-0000-0000-0000-000000000008', 'T3-008', 'terreno', 'qualified', 10000, 'Cidade Teste', 'Centro T3', 'RS',
   '{}', null, null, '{}', '{sale}', null, 'exclusive', now());

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.has_match(p_md text, p_thesis text) returns boolean language sql security definer as $$
  select exists (select 1 from public.matches m join public.opportunities o on o.id = m.opportunity_id
                   join public.buyer_theses t on t.id = m.thesis_id
                  where o.memorial_number = p_md and t.name = p_thesis and m.still_matches);
$$;
create function pg_temp.match_row(p_md text, p_thesis text) returns public.matches language sql security definer as $$
  select m.* from public.matches m join public.opportunities o on o.id = m.opportunity_id
    join public.buyer_theses t on t.id = m.thesis_id where o.memorial_number = p_md and t.name = p_thesis;
$$;
grant execute on function pg_temp.has_match(text, text), pg_temp.match_row(text, text) to authenticated;

-- ---------------------------------------------------------------- permissões das teses
set local role authenticated;
select pg_temp.as_user('a6000000-0000-0000-0000-000000000002');
select lives_ok($$
  insert into public.buyer_theses (id, organization_id, name, asset_types, cities, min_area_m2, max_area_m2,
                                   negotiation_models, max_ticket, zonings, min_coefficient, project_types, neighborhoods)
  values ('d6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Tese A',
          '{terreno}', '{cidade teste}', 5000, 20000, '{swap}', 50000000, '{mista}', 2.0, '{Residencial Vertical}', '{Centro T3}')
$$, 'admin da organização cria tese da própria organização');
select throws_ok($$
  insert into public.buyer_theses (organization_id, name) values ('b6000000-0000-0000-0000-000000000002', 'Invasora')
$$, '42501', null, 'não cria tese em outra organização');
select is_empty($$ select 1 from public.matches $$, 'comprador não vê matches');
select throws_ok($$ select public.admin_list_matches() $$, '42501', null, 'comprador não lista matches');
select throws_ok($$ select public.admin_recompute_matches() $$, '42501', null, 'comprador não recalcula');

select pg_temp.as_user('a6000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.buyer_theses), 1, 'membro leitor vê a tese da organização');
select throws_ok($$
  insert into public.buyer_theses (organization_id, name) values ('b6000000-0000-0000-0000-000000000001', 'Do leitor')
$$, '42501', null, 'membro leitor não cria tese');
update public.buyer_theses set name = 'Alterada pelo leitor';
select pg_temp.as_user('a6000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.buyer_theses $$, 'outra organização não vê a tese');

select pg_temp.as_user('a6000000-0000-0000-0000-000000000001');
select is((select name from public.buyer_theses where id = 'd6000000-0000-0000-0000-000000000001'), 'Tese A',
  'leitor não altera a tese');

-- ---------------------------------------------------------------- casos de match
select ok(pg_temp.has_match('T3-001', 'Tese A'), 'área compatível dá match');
select ok(pg_temp.has_match('T3-002', 'Tese A'), 'metragem exatamente no limite dá match; sem valor não trava ticket');
select ok(not pg_temp.has_match('T3-003', 'Tese A'), 'metragem 1 m² acima do limite não dá match');
select ok(not pg_temp.has_match('T3-004', 'Tese A'), 'tipo de ativo fora da tese não dá match');
select ok(not pg_temp.has_match('T3-005', 'Tese A'), 'cidade fora da tese não dá match');
select ok(not pg_temp.has_match('T3-006', 'Tese A'), 'área ainda qualificando não entra');
select ok(not pg_temp.has_match('T3-007', 'Tese A'), 'valor acima do ticket não dá match');
select ok(not pg_temp.has_match('T3-008', 'Tese A'), 'formato de negócio incompatível não dá match');

select is((pg_temp.match_row('T3-001', 'Tese A')).score, 93, 'área completa: nota alta (sem histórico = parcial)');
select ok((pg_temp.match_row('T3-001', 'Tese A')).score > (pg_temp.match_row('T3-002', 'Tese A')).score,
  'área sem zoneamento/coeficiente/projeto pontua menos');
select ok(exists (select 1 from jsonb_array_elements((pg_temp.match_row('T3-001', 'Tese A')).reasons) r
                   where r ->> 'detail' = 'Compatível: metragem 10.000 m² dentro de 5.000–20.000 m²'),
  'motivo legível de metragem');
select ok(exists (select 1 from jsonb_array_elements((pg_temp.match_row('T3-001', 'Tese A')).reasons) r
                   where r ->> 'criterion' = 'ticket' and r ->> 'detail' like 'Compatível: valor R$ 20,0 mi dentro de máx. R$ 50,0 mi'),
  'motivo legível de ticket');
select ok(exists (select 1 from jsonb_array_elements((pg_temp.match_row('T3-002', 'Tese A')).reasons) r
                   where r ->> 'criterion' = 'ticket' and r ->> 'result' = 'partial'),
  'área sem valor: ticket aparece como não conferido');
select ok(exists (select 1 from jsonb_array_elements((pg_temp.match_row('T3-001', 'Tese A')).reasons) r
                   where r ->> 'criterion' = 'proximity' and r ->> 'result' = 'pass'),
  'bairro preferido conta na proximidade (sem acento/caixa)');

-- tese sem nenhum filtro: tudo qualificado entra (região vazia, sem ticket)
insert into public.buyer_theses (organization_id, name) values ('b6000000-0000-0000-0000-000000000002', 'Tese aberta');
select is((select count(*)::int from public.matches m join public.buyer_theses t on t.id = m.thesis_id
            where t.name = 'Tese aberta' and m.opportunity_id::text like 'c6000000-%'), 7,
  'tese sem filtros casa com as 7 áreas qualificadas (não com a que está qualificando)');

-- ---------------------------------------------------------------- recálculo
update public.buyer_theses set max_area_m2 = 30000 where name = 'Tese A';
select ok(pg_temp.has_match('T3-003', 'Tese A'), 'alterar a tese recalcula: nova área entra');
update public.buyer_theses set cities = '{Outra Cidade}', states = '{}' where name = 'Tese A';
select ok(not pg_temp.has_match('T3-001', 'Tese A'), 'alterar a tese recalcula: área que saiu da região sai');
select is((select count(*)::int from public.matches m join public.buyer_theses t on t.id = m.thesis_id where t.name = 'Tese A'), 1,
  'sugestões que deixaram de combinar são removidas');
update public.buyer_theses set cities = '{Cidade Teste}', max_area_m2 = 20000 where name = 'Tese A';
select is((select count(*)::int from public.matches m join public.buyer_theses t on t.id = m.thesis_id where t.name = 'Tese A'), 2,
  'recalcular de novo é idempotente (sem duplicar)');

reset role;
update public.opportunities set status = 'qualified', published_at = now() where memorial_number = 'T3-006';
set local role authenticated;
select ok(pg_temp.has_match('T3-006', 'Tese A'), 'área que passa a qualificada entra no match');

-- ---------------------------------------------------------------- decisão da curadoria
select lives_ok(format($$ select public.decide_match(%L, 'approved', 'Boa área', 95) $$,
  (pg_temp.match_row('T3-001', 'Tese A')).id), 'curadoria aprova e ajusta a nota');
select is((pg_temp.match_row('T3-001', 'Tese A')).status, 'approved'::public.match_status, 'match aprovado');
select is((pg_temp.match_row('T3-001', 'Tese A')).manual_score, 95, 'nota ajustada guardada à parte');
update public.opportunities set asset_type = 'galpao' where memorial_number = 'T3-001';
select is((pg_temp.match_row('T3-001', 'Tese A')).status, 'approved'::public.match_status,
  'aprovado não some quando a área muda');
select ok(not (pg_temp.match_row('T3-001', 'Tese A')).still_matches, 'mas fica marcado como "não combina mais"');
select ok((select count(*) > 0 from public.admin_list_matches() where memorial_number = 'T3-001'),
  'lista da curadoria traz o match');

-- auto-aprovação acima de uma nota
update public.platform_settings set value = jsonb_set(value, '{auto_approve_score}', '80') where key = 'match_config';
insert into public.buyer_theses (organization_id, name, cities) values ('b6000000-0000-0000-0000-000000000002', 'Tese auto', '{Cidade Teste}');
select is((pg_temp.match_row('T3-002', 'Tese auto')).status, 'approved'::public.match_status,
  'acima da nota configurada, aprova sozinho');
select is((pg_temp.match_row('T3-002', 'Tese auto')).decision_note, 'Aprovado automaticamente (nota ≥ 80)',
  'auto-aprovação explica o porquê');

-- ---------------------------------------------------------------- corretor padrão das áreas do proprietário
select throws_ok($$ select public.set_owner_lead_default_broker('a6000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'só corretor com CRECI verificado pode ser o padrão');
select lives_ok($$ select public.set_owner_lead_default_broker('a6000000-0000-0000-0000-000000000005') $$,
  'curadoria define o corretor padrão');
reset role;
insert into public.owner_leads (respondent_relation, name, phone, city, state, location_text, source)
values ('owner', 'Dono T3', '(51) 90000-0003', 'Cidade Teste', 'RS', 'Rua T3', 'public_form');
select is((select assigned_to::text from public.owner_leads where name = 'Dono T3'), 'a6000000-0000-0000-0000-000000000005',
  'lead do proprietário já nasce com o corretor padrão');

-- ---------------------------------------------------------------- dossiê cego: unidades e dinheiro × permuta
update public.opportunities set estimated_units = 1400, cash_share_pct = 40 where memorial_number = 'T3-002';
set local role authenticated;
select pg_temp.as_user('a6000000-0000-0000-0000-000000000001');
select is((select estimated_units from public.opportunities_blind where memorial_number = 'T3-002'), 1400,
  'dossiê cego mostra as unidades estimadas');

select * from finish();
rollback;
