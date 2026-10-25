-- Aceite da Fase 2B: importar o mesmo arquivo duas vezes não duplica; desfazer o lote volta ao estado anterior;
-- nenhum dado sensível importado aparece fora da RPC; o painel mostra o que falta por área. Mais: prévia não grava,
-- edição manual não é sobrescrita (conflito), mandato desconhecido nunca publica, compradores sem opt-in.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-000000000001', 'curadoria@t2b.invalid', 'authenticated', 'authenticated', '{"full_name":"Curadora 2B"}'),
  ('a5000000-0000-0000-0000-000000000002', 'corretor@t2b.invalid', 'authenticated', 'authenticated', '{"full_name":"Corretor 2B","signup_kind":"broker"}');
insert into public.platform_admins (user_id) values ('a5000000-0000-0000-0000-000000000001');
update public.profiles set account_status = 'approved' where user_id::text like 'a5000000-%';
insert into public.brokers (user_id, creci_number, verification_status, creci_status) values
  ('a5000000-0000-0000-0000-000000000002', '2B-F', 'approved', 'active');

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

-- Linhas como o parser do app entrega.
create function pg_temp.rows_v1() returns jsonb language sql as $$
  select '[
    {"line": 4, "warnings": [], "opportunity": {"memorial_number": "MD-901", "status": "qualified", "asset_type": "terreno",
      "land_type": "Urbano", "area_m2": 12400.5, "neighborhood": "Petrópolis", "zoning": "Mista",
      "negotiation_models": ["swap"],
      "extra": {"landbank": {"status_raw": "Disponível"}, "legacy_offered_to": {"companies": ["Construtora 2B Alfa"], "raw": "Construtora 2B Alfa"}}},
     "sensitive": {"registry_number": "MAT-2B-1", "owner_name": "Dono Fictício 2B", "owner_contacts": {"raw": "(51) 90000-0901"}}},
    {"line": 5, "warnings": [], "opportunity": {"memorial_number": "MD-902", "status": "captured", "area_m2": 15000,
      "neighborhood": "Sarandi", "extra": {"landbank": {"status_raw": "Novo"}}}, "sensitive": null}
  ]'::jsonb;
$$;
create function pg_temp.mapping() returns jsonb language sql as $$
  select mapping from public.import_mappings where kind = 'landbank';
$$;

-- ---------------------------------------------------------------- permissões
set local role authenticated;
select pg_temp.as_user('a5000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.import_landbank('lb.csv', 'h1', pg_temp.mapping(), pg_temp.rows_v1(), '{}', false) $$,
  '42501', null, 'corretor não importa');
select throws_ok($$ select public.import_buyers('c.csv', 'h', '{}', '[]', '{}', false) $$, '42501', null,
  'corretor não importa compradores');
select is_empty($$ select 1 from public.import_batches $$, 'corretor não vê lotes');
select is_empty($$ select 1 from public.buyer_prospects $$, 'corretor não vê compradores');

-- ---------------------------------------------------------------- prévia (dry-run) não grava
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
create temporary table res (k text primary key, v jsonb);
grant all on res to authenticated;
insert into res select 'dry', public.import_landbank('lb.csv', 'h1', pg_temp.mapping(), pg_temp.rows_v1(), '{}', true);
select is((select v #>> '{counts,inserted}' from res where k = 'dry'), '2', 'prévia conta 2 áreas novas');
select is((select v ->> 'batch_id' from res where k = 'dry'), null, 'prévia não cria lote');
select is((select count(*)::int from public.opportunities where memorial_number in ('MD-901', 'MD-902')), 0,
  'prévia não grava áreas');
select is((select count(*)::int from public.import_batches), 0, 'prévia não grava lote');

-- ---------------------------------------------------------------- importação real
insert into res select 'b1', public.import_landbank('lb.csv', 'h1', pg_temp.mapping(), pg_temp.rows_v1(), '{"rejected": [{"line": 6, "reason": "sem número"}]}', false);
select is((select v #>> '{counts,inserted}' from res where k = 'b1'), '2', 'importa 2 áreas');
select is((select v #>> '{counts,rejected}' from res where k = 'b1'), '1', 'rejeitadas do parser entram no relatório');
select results_eq($$ select memorial_number, mandate_status::text, status::text, city, state, asset_type
                       from public.opportunities where memorial_number in ('MD-901', 'MD-902') order by 1 $$,
  $$ values ('MD-901'::text, 'unknown'::text, 'qualifying'::text, 'Porto Alegre'::text, 'RS'::text, 'terreno'::text),
            ('MD-902', 'unknown', 'captured', 'Porto Alegre', 'RS', null) $$,
  'mandato desconhecido; "qualificada" da planilha rebaixada (não publicável); padrões de cidade/UF; sem tipo = vazio');
select is((select v #>> '{counts,status_capped}' from res where k = 'b1'), '1', 'rebaixamento contado');
select is((select count(*)::int from public.distributions d join public.opportunities o on o.id = d.opportunity_id
            where o.memorial_number = 'MD-901' and d.source = 'legacy'), 1, '"oferecida para" vira distribuição legada');
select is((select owner_name from public.get_opportunity_sensitive((select id from public.opportunities where memorial_number = 'MD-901'))),
  'Dono Fictício 2B', 'dado sensível gravado na tabela restrita (lido pela RPC)');

-- Nada sensível fora da RPC
select is_empty($$ select 1 from public.import_batches b where b.report::text like '%Dono Fictício%' or b.report::text like '%MAT-2B%' $$,
  'relatório do lote sem dado sensível');
select is_empty($$ select 1 from public.import_batch_items i where i::text like '%Dono Fictício%' or i::text like '%MAT-2B%' or i::text like '%0901%' $$,
  'itens do lote sem dado sensível');
select is_empty($$ select 1 from public.opportunity_import_state s where s::text like '%Dono Fictício%' $$,
  'estado da mesclagem guarda só hash do dado sensível');
select is_empty($$ select 1 from public.opportunities o where o::text like '%Dono Fictício%' or o::text like '%MAT-2B%' $$,
  'nada sensível na tabela de áreas');
select throws_ok($$ select * from public.import_sensitive_snapshots $$, '42501', null, 'instantâneo sensível ilegível pela API');

-- ---------------------------------------------------------------- reimportar o mesmo arquivo não duplica
insert into res select 'b2', public.import_landbank('lb.csv', 'h1', pg_temp.mapping(), pg_temp.rows_v1(), '{}', false);
select is((select v #>> '{counts,unchanged}' from res where k = 'b2'), '2', 'reimportar: tudo inalterado');
select is((select v ->> 'already_imported_batch_id' from res where k = 'b2'), (select v ->> 'batch_id' from res where k = 'b1'),
  'avisa que o arquivo já foi importado');
select is((select count(*)::int from public.opportunities where memorial_number in ('MD-901', 'MD-902')), 2, 'sem duplicar áreas');
select is((select count(*)::int from public.distributions d join public.opportunities o on o.id = d.opportunity_id
            where o.memorial_number = 'MD-901'), 1, 'sem duplicar distribuição legada');

-- ---------------------------------------------------------------- edição manual × planilha (três vias)
update public.opportunities set zoning = 'Residencial (editado)' where memorial_number = 'MD-901';
insert into res select 'b3', public.import_landbank('lb-v2.csv', 'h2', pg_temp.mapping(),
  jsonb_set(jsonb_set(jsonb_set(pg_temp.rows_v1(), '{0,opportunity,area_m2}', '13000'),
                      '{0,opportunity,zoning}', '"Mista"'),
            '{1,opportunity,zoning}', '"Industrial"'), '{}', false);
select results_eq($$ select memorial_number, zoning, area_m2::int from public.opportunities
                      where memorial_number in ('MD-901', 'MD-902') order by 1 $$,
  $$ values ('MD-901'::text, 'Residencial (editado)'::text, 13000), ('MD-902', 'Industrial', 15000) $$,
  'planilha mudou só a área: aplica; edição manual (zoneamento) fica; campo vazio é preenchido');
-- agora planilha também muda o zoneamento editado → conflito
insert into res select 'b4', public.import_landbank('lb-v3.csv', 'h3', pg_temp.mapping(),
  jsonb_set(jsonb_set(pg_temp.rows_v1(), '{0,opportunity,area_m2}', '13000'), '{0,opportunity,zoning}', '"Comercial"'), '{}', false);
select is((select v #>> '{counts,conflict_rows}' from res where k = 'b4'), '1', 'ambos mudaram: conflito');
select is((select zoning from public.opportunities where memorial_number = 'MD-901'), 'Residencial (editado)',
  'conflito não sobrescreve a plataforma');
select results_eq($$ select memorial_number, field, platform #>> '{}', sheet #>> '{}' from public.admin_import_conflicts() $$,
  $$ values ('MD-901'::text, 'zoning'::text, 'Residencial (editado)'::text, 'Comercial'::text) $$,
  'conflito listado para a curadoria');
select lives_ok($$ select public.resolve_import_conflict((select id from public.opportunities where memorial_number = 'MD-901'), 'zoning', true) $$,
  'curadoria escolhe a planilha');
select is((select zoning from public.opportunities where memorial_number = 'MD-901'), 'Comercial', 'vale a planilha');
select is_empty($$ select * from public.admin_import_conflicts() $$, 'conflito resolvido sai da lista');

-- dado sensível: mesma regra, sem mostrar o valor
reset role;
update public.opportunity_sensitive set owner_name = 'Nome corrigido à mão'
 where opportunity_id = (select id from public.opportunities where memorial_number = 'MD-901');
set local role authenticated;
insert into res select 'b5', public.import_landbank('lb-v4.csv', 'h4', pg_temp.mapping(),
  jsonb_set(jsonb_set(jsonb_set(pg_temp.rows_v1(), '{0,opportunity,area_m2}', '13000'), '{0,opportunity,zoning}', '"Comercial"'),
            '{0,sensitive,owner_name}', '"Outro Dono"'), '{}', false);
select results_eq($$ select field, sensitive, platform, sheet from public.admin_import_conflicts() $$,
  $$ values ('owner_name'::text, true, null::jsonb, null::jsonb) $$, 'conflito sensível aparece sem os valores');
select is((select owner_name from public.get_opportunity_sensitive((select id from public.opportunities where memorial_number = 'MD-901'))),
  'Nome corrigido à mão', 'correção manual do dado sensível preservada');

-- ---------------------------------------------------------------- desfazer
select throws_ok($$ select public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b1')) $$,
  '22023', null, 'só desfaz o lote mais recente');
insert into res select 'u5', public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b5'));
select results_eq($$ select field from public.admin_import_conflicts() $$, $$ select 'x'::text where false $$,
  'desfazer volta os conflitos ao estado anterior ao lote');
select throws_ok($$ select public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b5')) $$,
  '22023', null, 'não desfaz duas vezes');

-- desfaz b4 (sem mudanças além do conflito, já resolvido), b3 e b2 em ordem; depois b1
select lives_ok($$ select public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b4')) $$, 'desfaz b4');
-- após desfazer b4, a resolução manual (Comercial) foi feita depois do lote: fica
select is((select zoning from public.opportunities where memorial_number = 'MD-901'), 'Comercial',
  'mudança feita depois do lote não é revertida');
select lives_ok($$ select public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b3')) $$, 'desfaz b3');
select results_eq($$ select memorial_number, area_m2::numeric, zoning from public.opportunities
                      where memorial_number in ('MD-901', 'MD-902') order by 1 $$,
  $$ values ('MD-901'::text, 12400.50::numeric, 'Comercial'::text), ('MD-902', 15000.00, null) $$,
  'campos do lote voltam ao valor anterior');
select lives_ok($$ select public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b2')) $$, 'desfaz b2');
insert into res select 'u1', public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'b1'));
select results_eq($$ select memorial_number, status::text from public.opportunities where memorial_number in ('MD-901', 'MD-902') order by 1 $$,
  $$ values ('MD-901'::text, 'archived'::text), ('MD-902', 'archived') $$,
  'áreas criadas pelo lote ficam arquivadas (histórico append-only não se apaga)');
select is_empty($$ select 1 from public.opportunities_blind where memorial_number in ('MD-901', 'MD-902') $$,
  'arquivadas somem do catálogo');
select is((select count(*)::int from public.get_opportunity_sensitive((select id from public.opportunities where memorial_number = 'MD-902'))), 0,
  'dado sensível criado pelo lote é apagado');
-- reimportar depois de desfazer: revive
insert into res select 'b6', public.import_landbank('lb.csv', 'h1', pg_temp.mapping(), pg_temp.rows_v1(), '{}', false);
select results_eq($$ select memorial_number, status::text, mandate_status::text from public.opportunities
                      where memorial_number in ('MD-901', 'MD-902') order by 1 $$,
  $$ values ('MD-901'::text, 'qualifying'::text, 'unknown'::text), ('MD-902', 'captured', 'unknown') $$,
  'reimportar depois de desfazer revive as áreas');

-- ---------------------------------------------------------------- append-only e cadeia
reset role;
select throws_ok($$ update public.import_batches set file_name = 'x' $$, '42501', null, 'lote não se altera (nem o dono)');
select throws_ok($$ delete from public.import_batch_items $$, '42501', null, 'itens não se apagam');
set local role authenticated;
select is_empty($$ select * from public.verify_hash_chain('import_batches') $$, 'cadeia dos lotes íntegra');
select ok((select bool_and(chain_ok) from public.admin_import_batches()), 'itens de cada lote conferem com o hash do lote');

-- ---------------------------------------------------------------- painel de publicáveis e mandato desconhecido
select ok((select 'mandate_unknown' = any (blockers) and 'missing_asset_type' = any (blockers)
             from public.admin_publishable_overview() where memorial_number = 'MD-902'),
  'painel diz o que falta (mandato desconhecido, tipo de ativo)');
reset role;
update public.platform_settings set value = 'true' where key = 'allow_distribution_without_mandate';
set local role authenticated;
select ok((select 'mandate_unknown' = any (blockers) from public.admin_publishable_overview() where memorial_number = 'MD-902'),
  'mandato desconhecido trava mesmo com "distribuir sem mandato" ligado');
reset role;
update public.platform_settings set value = 'false' where key = 'allow_distribution_without_mandate';
set local role authenticated;
select throws_ok($$ update public.opportunities set asset_type = 'nave espacial' where memorial_number = 'MD-902' $$,
  '23514', null, 'tipo de ativo fora da lista é recusado');

-- ---------------------------------------------------------------- compradores (sem opt-in)
insert into res select 'c1', public.import_buyers('compradores.csv', 'hc1', '{}', '[
  {"line": 2, "organization_name": "Incorporadora 2B", "cnpj": "11.222.333/0001-81", "contact_name": "Ana", "email": "ana@2b.invalid"},
  {"line": 3, "organization_name": "Incorporadora 2B (repetida)", "cnpj": "11222333000181"},
  {"line": 4, "organization_name": "Construtora Sem CNPJ", "phone": "(51) 98888-0000"}
]'::jsonb, '{}', false);
select is((select v -> 'counts' from res where k = 'c1') ->> 'inserted', '2', '2 compradores novos');
select is((select v -> 'counts' from res where k = 'c1') ->> 'duplicates', '1', 'mesmo CNPJ no arquivo = duplicado');
select is((select count(*)::int from public.buyer_prospects where consent_status = 'none'), 2, 'sem opt-in');
insert into res select 'c2', public.import_buyers('compradores2.csv', 'hc2', '{}', '[
  {"line": 2, "organization_name": "Incorporadora 2B", "cnpj": "11222333000181", "contact_name": "Outra pessoa", "phone": "(51) 97777-0000"}
]'::jsonb, '{}', false);
select results_eq($$ select contact_name, phone from public.buyer_prospects where cnpj = '11222333000181' $$,
  $$ values ('Ana'::text, '(51) 97777-0000'::text) $$, 'existente: só preenche o vazio, não sobrescreve');
select is_empty($$ select 1 from public.import_batches where report::text like '%Ana%' or report::text like '%97777%' $$,
  'relatório de compradores sem dado pessoal');
select lives_ok($$ select public.undo_import_batch((select (v ->> 'batch_id')::uuid from res where k = 'c2')) $$, 'desfaz compradores 2');
select is((select phone from public.buyer_prospects where cnpj = '11222333000181'), null, 'telefone preenchido pelo lote volta a vazio');

select * from finish();
rollback;
