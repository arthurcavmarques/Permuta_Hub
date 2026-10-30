-- Seed de DEMONSTRAÇÃO da Fase 3. TODOS OS DADOS SÃO FICTÍCIOS. Pode ir para a nuvem (demo).
-- Teses das organizações fictícias e dados de estudo (unidades, dinheiro × permuta) em algumas áreas.
-- Idempotente: só cria tese que ainda não existe (por organização + nome). Os matches nascem pelos triggers.

update public.opportunities o
   set estimated_units = v.units, cash_share_pct = v.cash
  from (values ('MD-001', 96, 40), ('MD-002', 180, 0), ('MD-003', 48, 100), ('MD-005', 420, 30),
               ('MD-007', 140, 20), ('MD-009', 260, 0), ('MD-010', 80, 100)) as v(md, units, cash)
 where o.memorial_number = v.md and o.estimated_units is null and (o.extra ->> 'fictitious')::boolean;

insert into public.buyer_theses
  (organization_id, name, asset_types, cities, region_tags, min_area_m2, max_area_m2, negotiation_models,
   min_ticket, max_ticket, zonings, min_coefficient, project_types, neighborhoods, notes, created_by)
select org.id, t.name, t.asset_types, t.cities, t.region_tags, t.min_area, t.max_area,
       t.models::public.negotiation_model[], t.min_ticket, t.max_ticket, t.zonings, t.min_coef, t.project_types,
       t.neighborhoods, 'Tese fictícia de demonstração.', null
  from (values
    ('Incorporadora Exemplo Beta (fictícia)', 'Vertical residencial em Porto Alegre',
     array['terreno'], array['Porto Alegre'], array[]::text[], 2000::numeric, 15000::numeric, array['swap', 'sale'],
     null::numeric, 60000000::numeric, array['Mista'], 2.0::numeric, array['residencial vertical', 'uso misto'],
     array['Petrópolis', 'Três Figueiras', 'Jardim Europa']),
    ('Construtora Exemplo Alfa (fictícia)', 'Zona Sul — condomínios e vertical baixo',
     array['terreno', 'gleba'], array[]::text[], array['Zona Sul'], 4000, 40000, array['swap', 'partnership'],
     null, null, array[]::text[], null, array['condomínio horizontal', 'residencial vertical'], array[]::text[]),
    ('Loteadora Exemplo Gama (fictícia)', 'Glebas para loteamento na Região Metropolitana',
     array['gleba', 'area_rural'], array[]::text[], array[]::text[], 10000, null, array['partnership', 'swap'],
     null, null, array[]::text[], null, array['loteamento'], array[]::text[])
  ) as t(org, name, asset_types, cities, region_tags, min_area, max_area, models, min_ticket, max_ticket, zonings,
         min_coef, project_types, neighborhoods)
  join public.organizations org on org.name = t.org
 where not exists (select 1 from public.buyer_theses b where b.organization_id = org.id and b.name = t.name);
