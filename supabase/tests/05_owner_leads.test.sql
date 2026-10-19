-- Aceite da Fase 2 (bloco 2.2): proprietário cadastra área (retida), vê só o que é dele e números
-- agregados, sem identificar comprador. Formulário público com validação, honeypot e rate limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Limites conhecidos (o seed local afrouxa para os E2E).
update public.platform_settings set value = '5' where key = 'lead_rate_limit_per_hour';
update public.platform_settings set value = '3' where key = 'lead_rate_limit_per_contact_day';

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-000000000001', 'curadoria@t22.invalid', 'authenticated', 'authenticated', '{}'),
  ('a2000000-0000-0000-0000-000000000002', 'dona@t22.invalid', 'authenticated', 'authenticated', '{"full_name":"Dona Terra","signup_kind":"owner"}'),
  ('a2000000-0000-0000-0000-000000000003', 'outro.dono@t22.invalid', 'authenticated', 'authenticated', '{"signup_kind":"owner"}'),
  ('a2000000-0000-0000-0000-000000000004', 'comprador@t22.invalid', 'authenticated', 'authenticated', '{"signup_kind":"buyer"}'),
  ('a2000000-0000-0000-0000-000000000005', 'corretor@t22.invalid', 'authenticated', 'authenticated', '{"full_name":"Corretor Resp","phone":"+5551999990000","signup_kind":"broker"}');
insert into public.platform_admins (user_id) values ('a2000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved'
 where user_id in ('a2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000005');
insert into public.brokers (user_id, creci_number, verification_status) values
  ('a2000000-0000-0000-0000-000000000005', '555-F', 'approved');
insert into public.organizations (id, name, type) values
  ('b2000000-0000-0000-0000-000000000001', 'Compradora Secreta SA', 'developer'),
  ('b2000000-0000-0000-0000-000000000002', 'Outra Compradora SA', 'builder');
insert into public.organization_members (organization_id, user_id, role) values
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000004', 'admin');

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.with_ip(p_ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', p_ip, 'user-agent', 'pgtap')::text, true);
$$;

select is((select signup_kind::text from public.profiles where user_id = 'a2000000-0000-0000-0000-000000000002'),
  'owner', 'cadastro aceita o tipo proprietário');
select is((select account_status::text from public.profiles where user_id = 'a2000000-0000-0000-0000-000000000002'),
  'pending', 'proprietário também nasce pendente');

-- ---------------------------------------------------------------- formulário público (anon)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.with_ip('10.0.0.1');
select throws_ok($$ select 1 from public.owner_leads $$, '42501', null, 'anon: não lê leads');
select throws_ok($$ select public.submit_owner_lead('owner', 'Perto do parque', 'Porto Alegre', null, 'RS', 5000, '{sale}',
  null, 'Fulano', '+5551999990001', null, false) $$, '22023', null, 'anon: sem aceite de privacidade é recusado');
select throws_ok($$ select public.submit_owner_lead('owner', 'Perto do parque', 'Porto Alegre', null, 'RS', 5000, '{sale}',
  null, 'Fulano', null, null, true) $$, '22023', null, 'anon: sem telefone nem e-mail é recusado');
select is(public.submit_owner_lead('owner', 'Perto do parque', 'Porto Alegre', null, 'RS', 5000, '{sale}',
  null, 'Robô', '+5551999990009', null, true, 'http://spam'), null, 'honeypot preenchido: aceita sem gravar');
select isnt(public.submit_owner_lead('knows_owner', 'Rua das Flores, perto do nº 100', 'Porto Alegre', 'Centro', 'RS', 5000,
  '{sale,swap}', 'Dono quer permuta', 'Fulano', '+5551999990001', 'Fulano@Exemplo.invalid', true), null,
  'anon: envia o formulário público');
select throws_ok($$ select public.owner_my_areas() $$, '42501', null, 'anon: sem "minhas áreas"');

-- rate limit por contato (3/dia) e por IP (5/hora)
select lives_ok($$ select public.submit_owner_lead('owner', 'Área 2', 'Canoas', null, 'RS', null, '{}', null, 'Fulano',
  '+5551999990001', null, true) $$, 'mesmo contato: 2º envio ok');
select lives_ok($$ select public.submit_owner_lead('owner', 'Área 3', 'Canoas', null, 'RS', null, '{}', null, 'Fulano',
  '+5551999990001', null, true) $$, 'mesmo contato: 3º envio ok');
select throws_ok($$ select public.submit_owner_lead('owner', 'Área 4', 'Canoas', null, 'RS', null, '{}', null, 'Fulano',
  '+5551999990001', null, true) $$, '54000', null, 'mesmo contato: 4º envio no dia é barrado');
select lives_ok($$ select public.submit_owner_lead('owner', 'Área 5', 'Canoas', null, 'RS', null, '{}', null, 'Beltrano',
  '+5551999990002', null, true) $$, 'mesmo IP: 4º envio na hora ok');
select lives_ok($$ select public.submit_owner_lead('owner', 'Área 6', 'Canoas', null, 'RS', null, '{}', null, 'Ciclano',
  '+5551999990003', null, true) $$, 'mesmo IP: 5º envio na hora ok');
select throws_ok($$ select public.submit_owner_lead('owner', 'Área 7', 'Canoas', null, 'RS', null, '{}', null, 'Outro',
  '+5551999990004', null, true) $$, '54000', null, 'mesmo IP: 6º envio na hora é barrado');

reset role;
select is((select count(*)::int from public.owner_leads), 5, 'cinco leads gravados (honeypot e barrados ficaram de fora)');
select is((select email from public.owner_leads where name = 'Fulano' order by created_at limit 1), 'fulano@exemplo.invalid',
  'e-mail normalizado');
select is((select count(*)::int from public.contact_consents c join public.owner_leads l on l.consent_id = c.id
            where c.purpose = 'privacy_policy' and c.ip = '10.0.0.1'), 5, 'cada lead tem consentimento com IP');

-- ---------------------------------------------------------------- proprietário logado
set local role authenticated;
select pg_temp.with_ip('10.0.0.2');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.owner_leads $$, 'proprietário: não vê leads de outros');
select throws_ok($$ select public.submit_owner_lead('owner', 'Minha área', 'Porto Alegre', 'Ipanema', 'RS', 8000, '{sale}',
  null, 'Dona Terra', '+5551988880000', null, true) $$, '42501', null, 'proprietário: sem o termo do proprietário não cadastra');
select lives_ok($$ select public.accept_agreement('owner_terms') $$, 'proprietário pendente: aceita o termo do proprietário');
select lives_ok($$ select public.submit_owner_lead('owner', 'Minha área', 'Porto Alegre', 'Ipanema', 'RS', 8000, '{sale}',
  null, 'Dona Terra', '+5551988880000', null, true) $$, 'proprietário: cadastra a própria área');
select is((select count(*)::int from public.owner_my_areas()), 1, 'proprietário: vê a própria área');
select is((select source::text from public.owner_leads), 'owner_account', 'lead do proprietário marcado como da conta');
select is((select count(*)::int from public.opportunities_blind), 0, 'proprietário: não vê catálogo');

-- curadoria converte e distribui (simulado aqui; telas no bloco 2.4)
reset role;
insert into public.opportunities (id, memorial_number, city, status) values
  ('c2000000-0000-0000-0000-000000000001', 'MD-T22', 'Porto Alegre', 'qualifying');
update public.owner_leads set status = 'converted', converted_opportunity_id = 'c2000000-0000-0000-0000-000000000001'
 where owner_user_id = 'a2000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.as_user('a2000000-0000-0000-0000-000000000002');
select is((select awaiting_responsible from public.owner_my_areas()), true,
  'área convertida sem corretor: "aguardando corretor responsável"');

reset role;
update public.opportunities set responsible_party_user_id = 'a2000000-0000-0000-0000-000000000005', status = 'distributing'
 where id = 'c2000000-0000-0000-0000-000000000001';
insert into public.distributions (opportunity_id, recipient_user_id, recipient_org_id, channel, idempotency_key) values
  ('c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000001', 'email', 't22-1'),
  ('c2000000-0000-0000-0000-000000000001', null, 'b2000000-0000-0000-0000-000000000002', 'email', 't22-2');
insert into public.distribution_events (distribution_id, event) select id, 'interested' from public.distributions where idempotency_key = 't22-1';
set local role authenticated;
select pg_temp.as_user('a2000000-0000-0000-0000-000000000002');
select results_eq($$ select recipients_count, interested_count, responsible_name, awaiting_responsible from public.owner_my_areas() $$,
  $$ values (2, 1, 'Corretor Resp'::text, false) $$, 'proprietário vê números agregados e o corretor responsável');
select is_empty($$ select 1 from public.distributions $$, 'proprietário: não vê distribuições (quem recebeu)');
select is_empty($$ select 1 from public.organizations $$, 'proprietário: não vê organizações compradoras');
select throws_ok($$ select * from public.get_opportunity_sensitive('c2000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'proprietário: não usa a RPC do dado sensível');

-- outro proprietário não vê nada
select pg_temp.as_user('a2000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.owner_my_areas()), 0, 'outro proprietário: não vê a área alheia');

-- comprador não usa a porta do proprietário
select pg_temp.as_user('a2000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.submit_owner_lead('owner', 'X', 'Porto Alegre', null, 'RS', null, '{}', null, 'X',
  '+5551977770000', null, true) $$, '42501', null, 'comprador logado: não cadastra pela porta do proprietário');

select * from finish();
rollback;
