-- Aceite da Fase 0: usuário sem permissão NÃO lê opportunity_sensitive por chamada direta à API.
-- Simula os papéis do PostgREST (anon/authenticated + claims do JWT), como a API real faz.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Usuários de teste (independentes do seed)
insert into auth.users (id, email, aud, role) values
  ('11111111-0000-0000-0000-000000000001', 'curador@teste.invalid', 'authenticated', 'authenticated'),
  ('11111111-0000-0000-0000-000000000002', 'comum@teste.invalid', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id) values ('11111111-0000-0000-0000-000000000001');

insert into public.opportunities (id, memorial_number, area_m2, city, neighborhood, status, geometry)
values ('22222222-0000-0000-0000-000000000001', 'MD-TESTE-1', 1234, 'Porto Alegre', 'Bairro Teste', 'qualified',
        extensions.st_setsrid(extensions.st_makepoint(-51.2, -30.03), 4326));
insert into public.opportunity_sensitive (opportunity_id, registry_number, exact_address, owner_name)
values ('22222222-0000-0000-0000-000000000001', 'MAT-SECRETA', 'Endereço Secreto 1', 'Dono Secreto');

-- ---------------------------------------------------------------- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$ select * from public.opportunity_sensitive $$, '42501', null, 'anon: SELECT direto em opportunity_sensitive negado');
select throws_ok($$ select * from public.opportunities_blind $$, '42501', null, 'anon: dossiê cego negado');
select throws_ok($$ select * from public.get_opportunity_sensitive('22222222-0000-0000-0000-000000000001') $$, '42501', null, 'anon: RPC do dado sensível negada');
select throws_ok($$ select 1 from public.opportunities $$, '42501', null, 'anon: sem acesso à tabela de oportunidades');

-- ---------------------------------------------------------------- usuário logado sem permissão
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok($$ select * from public.opportunity_sensitive $$, '42501', null, 'comum: SELECT direto em opportunity_sensitive negado');
select throws_ok($$ select * from public.get_opportunity_sensitive('22222222-0000-0000-0000-000000000001') $$, '42501', null, 'comum: RPC do dado sensível negada');
select is_empty($$ select 1 from public.opportunities $$, 'comum: tabela completa (geometria exata) invisível');
select is_empty($$ select 1 from public.opportunities_blind $$, 'comum: sem dossiê cego na Fase 0 (sem distribuição)');
select throws_ok(
  $$ insert into public.opportunities (memorial_number) values ('MD-INVASOR') $$,
  '42501', null, 'comum: não cria oportunidade');
select is_empty($$ select 1 from public.access_log $$, 'comum: não lê access_log');

-- ---------------------------------------------------------------- admin da plataforma
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select * from public.opportunity_sensitive $$, '42501', null, 'admin: nem admin lê a tabela sensível direto');
select is(
  (select registry_number from public.get_opportunity_sensitive('22222222-0000-0000-0000-000000000001')),
  'MAT-SECRETA', 'admin: lê dado sensível pela RPC');
select is(
  (select count(*)::int from public.access_log where opportunity_id = '22222222-0000-0000-0000-000000000001' and action = 'read_sensitive'),
  1, 'admin: leitura sensível ficou registrada no access_log');
select is(
  (select title from public.opportunities_blind where id = '22222222-0000-0000-0000-000000000001'),
  'Área de 1.200 m² – Bairro Teste, Porto Alegre', 'admin: título cego com metragem arredondada');
select throws_ok($$ update public.access_log set action = 'adulterado' $$, '42501', null, 'admin: não altera access_log');
select throws_ok($$ delete from public.access_log $$, '42501', null, 'admin: não apaga access_log');

-- ---------------------------------------------------------------- estrutura do dossiê cego
reset role;
select is_empty(
  $$ select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'opportunities_blind'
       and column_name in ('geometry', 'registry_number', 'exact_address', 'owner_name', 'owner_contacts', 'area_m2') $$,
  'view cega não expõe colunas sensíveis nem metragem exata');

select ok(
  extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(-51.2, -30.03), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(approx_lng, approx_lat), 4326)::extensions.geography
  ) <= approx_radius_m,
  'ponto aproximado fica dentro do círculo exibido')
from public.opportunities_blind where id = '22222222-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- append-only vale até para service_role / dono
set local role service_role;
select throws_ok($$ update public.access_log set action = 'x' $$, '42501', null, 'service_role: não altera access_log');
reset role;
select throws_ok($$ delete from public.access_log $$, '42501', null, 'postgres (dono): trigger rejeita DELETE no access_log');

select * from finish();
rollback;
