-- Fase 2 (bloco 2.6): gerar o PDF do dossiê cego fica no access_log; só quem vê o dossiê pode registrar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email, aud, role) values
  ('a6000000-0000-0000-0000-000000000001', 'curadoria@t26.invalid', 'authenticated', 'authenticated'),
  ('a6000000-0000-0000-0000-000000000002', 'estranho@t26.invalid', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id) values ('a6000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a6000000-%';
insert into public.opportunities (id, memorial_number, city) values ('c6000000-0000-0000-0000-000000000001', 'MD-T26', 'Porto Alegre');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.log_dossier_print('c6000000-0000-0000-0000-000000000001') $$, '42501', null,
  'quem não vê o dossiê não registra impressão');
select set_config('request.jwt.claims', '{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.log_dossier_print('c6000000-0000-0000-0000-000000000001') $$, 'curadoria gera o PDF');
select is((select count(*)::int from public.access_log where action = 'print_dossier'
            and opportunity_id = 'c6000000-0000-0000-0000-000000000001'
            and actor_id = 'a6000000-0000-0000-0000-000000000001'), 1, 'geração do PDF fica no log com o autor');

select * from finish();
rollback;
