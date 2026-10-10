-- Aceite da Fase 1: UPDATE/DELETE/TRUNCATE em tabelas append-only falham para TODOS os papéis,
-- inclusive service_role e o dono do banco (trigger). Cadeia de hashes detecta adulteração (D017).
-- Também: convites (D015) e conversão idempotente do legado (D018).
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (id, email, aud, role) values
  ('d0000000-0000-0000-0000-000000000001', 'curadoria2@t.invalid', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000002', 'convidado@t.invalid', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000003', 'intruso@t.invalid', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id) values ('d0000000-0000-0000-0000-000000000001');
insert into public.organizations (id, name, type) values ('e0000000-0000-0000-0000-000000000001', 'Org Convite', 'developer');
insert into public.opportunities (id, memorial_number, extra) values
  ('f0000000-0000-0000-0000-000000000001', 'MD-T-LEGADO',
   '{"legacy_offered_to": {"companies": ["Org Convite", "  org   convite ", "Empresa Nova Legada"], "raw": "Org Convite; Empresa Nova Legada"}}');

insert into public.distributions (opportunity_id, recipient_org_id, channel, idempotency_key)
values ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'whatsapp', 'append-k1');
insert into public.distribution_events (distribution_id, event)
select id, 'queued' from public.distributions where idempotency_key = 'append-k1';
insert into public.distribution_events (distribution_id, event)
select id, 'sent' from public.distributions where idempotency_key = 'append-k1';
insert into public.access_log (actor_id, action, resource_type) values (null, 'teste-1', 'teste'), (null, 'teste-2', 'teste');
select public.record_consent('email', true) from (select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true)) x;

-- ---------------------------------------------------------------- append-only por papel
create function pg_temp.check_append_only(p_role text) returns setof text language plpgsql as $f$
declare
  t text;
begin
  foreach t in array array['distributions', 'distribution_events', 'access_log', 'contact_consents'] loop
    if p_role <> 'postgres' then execute format('set local role %I', p_role); end if;
    return next throws_ok(format('update public.%I set created_at = now()', t), '42501', null,
                          format('%s: UPDATE em %s falha', p_role, t));
    return next throws_ok(format('delete from public.%I', t), '42501', null,
                          format('%s: DELETE em %s falha', p_role, t));
    reset role;
  end loop;
end;
$f$;

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select * from pg_temp.check_append_only('authenticated');   -- curadoria: nem admin altera
select * from pg_temp.check_append_only('service_role');
select * from pg_temp.check_append_only('postgres');        -- dono: barrado pelo trigger
select throws_ok($$ truncate public.distributions cascade $$, '42501', null, 'postgres: TRUNCATE em distributions falha');
select throws_ok($$ truncate public.distribution_events $$, '42501', null, 'postgres: TRUNCATE em distribution_events falha');

-- ---------------------------------------------------------------- cadeia de hashes
select is_empty($$ select * from public.verify_hash_chain('distributions') $$, 'cadeia de distributions íntegra');
select is_empty($$ select * from public.verify_hash_chain('distribution_events') $$, 'cadeia de distribution_events íntegra');
select is_empty($$ select * from public.verify_hash_chain('access_log') $$, 'cadeia do access_log íntegra (inclui linhas antigas)');
select is((select prev_hash from public.distribution_events order by seq desc limit 1),
          (select row_hash from public.distribution_events order by seq desc offset 1 limit 1),
          'cada linha aponta para o hash da anterior');

-- Adulteração "por fora" (dono desliga o trigger): a cadeia denuncia.
alter table public.distributions disable trigger distributions_append_only;
update public.distributions set channel = 'email' where idempotency_key = 'append-k1';
alter table public.distributions enable trigger distributions_append_only;
select is((select reason from public.verify_hash_chain('distributions')), 'conteúdo alterado', 'alteração de conteúdo detectada');

alter table public.access_log disable trigger access_log_append_only;
delete from public.access_log where seq = (select min(seq) from public.access_log);
alter table public.access_log enable trigger access_log_append_only;
select is((select reason from public.verify_hash_chain('access_log')), 'prev_hash não confere (linha removida ou reordenada)',
  'remoção de linha detectada');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.verify_hash_chain('distributions') $$, '42501', null, 'verificação só para curadoria');
reset role;

-- ---------------------------------------------------------------- convites
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temp table inv as select * from public.create_invitation('e0000000-0000-0000-0000-000000000001', ' Convidado@T.invalid ', 'buyer');
grant select on inv to anon, authenticated;
select is((select count(*)::int from public.invitations where email = 'convidado@t.invalid'), 1, 'convite normaliza e-mail');
select isnt((select token_hash from public.invitations where email = 'convidado@t.invalid'),
            (select token from inv), 'banco guarda só o hash do token');
select ok((select accept_url from inv) like '%/convite/' || (select token from inv), 'link de aceite com o token');
select is((select count(*)::int from public.email_outbox where template_key = 'invitation' and to_email = 'convidado@t.invalid'), 1,
  'convite enfileira e-mail');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select organization_name from public.get_invitation_preview((select token from inv))), 'Org Convite', 'anon: prévia mostra a organização');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.accept_invitation(%L)', (select token from inv)), '42501', null,
  'link encaminhado a outro e-mail não funciona');

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.accept_invitation((select token from inv)), 'e0000000-0000-0000-0000-000000000001'::uuid, 'convidado aceita');
select is((select role::text from public.organization_members where user_id = 'd0000000-0000-0000-0000-000000000002'), 'buyer',
  'convidado vira membro com o papel do convite');
select is((select account_status::text from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000002'), 'approved',
  'convite aprova a conta (D014)');
select throws_ok(format('select public.accept_invitation(%L)', (select token from inv)), '22023', null, 'convite não é reutilizável');
reset role;

-- ---------------------------------------------------------------- legado (D018)
select set_config('request.jwt.claims', '', true); -- como a migration/seed: sem usuário
select is(public.import_legacy_distributions() >= 2, true, 'legado: cria distributions');
select is((select count(*)::int from public.distributions where opportunity_id = 'f0000000-0000-0000-0000-000000000001' and source = 'legacy'), 2,
  'legado: nomes iguais com espaços/maiúsculas viram a mesma organização');
select is((select count(*)::int from public.organizations where normalized_name = 'empresa nova legada'), 1, 'legado: empresa nova vira organização');
select is(public.import_legacy_distributions(), 0, 'legado: reimportar não duplica');

select * from finish();
rollback;
