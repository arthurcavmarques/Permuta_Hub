-- Seed de DESENVOLVIMENTO. TODOS OS DADOS SÃO FICTÍCIOS.
-- Nomes, matrículas, endereços, valores e zoneamentos são inventados.
-- Usuários locais (só existem no banco local):
--   admin@permutahub.local   / admin-local-123   (admin da plataforma)
--   usuario@permutahub.local / usuario-local-123 (logado, sem permissão)

-- ---------------------------------------------------------------------------
-- Usuários locais
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-0000-0000-00000000a001'::uuid, 'admin@permutahub.local', 'admin-local-123', 'Admin Local'),
      ('00000000-0000-0000-0000-00000000a002'::uuid, 'usuario@permutahub.local', 'usuario-local-123', 'Usuário Sem Permissão')
    ) as t(id, email, pwd, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt(u.pwd, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end;
$$;

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000a001');

-- ---------------------------------------------------------------------------
-- Organizações fictícias
-- ---------------------------------------------------------------------------
insert into public.organizations (name, type, city, state) values
  ('Construtora Exemplo Alfa (fictícia)', 'builder', 'Porto Alegre', 'RS'),
  ('Incorporadora Exemplo Beta (fictícia)', 'developer', 'Porto Alegre', 'RS'),
  ('Loteadora Exemplo Gama (fictícia)', 'land_developer', 'Canoas', 'RS'),
  ('Imobiliária Exemplo Delta (fictícia)', 'brokerage', 'Porto Alegre', 'RS');

-- ---------------------------------------------------------------------------
-- Oportunidades fictícias (Porto Alegre e Região Metropolitana)
-- Polígono = quadrado com a área informada, centrado num ponto do bairro (SIRGAS 2000 / UTM 22S).
-- ---------------------------------------------------------------------------
with src (md, neighborhood, city, region, lng, lat, area, land_type, status, zoning, coef, project_types, models, asking, mandate, offered) as (
  values
  ('MD-001', 'Petrópolis', 'Porto Alegre', 'Centro-Leste', -51.1850, -30.0400, 3200, 'urbano', 'qualified', 'Mista 03 (fictício)', 2.4, array['residencial vertical'], array['sale','swap']::public.negotiation_model[], 18500000, 'exclusive', array['Construtora Exemplo Alfa (fictícia)']),
  ('MD-002', 'Três Figueiras', 'Porto Alegre', 'Centro-Leste', -51.1720, -30.0290, 5400, 'urbano', 'distributing', 'Residencial 02 (fictício)', 1.9, array['residencial vertical','uso misto'], array['swap']::public.negotiation_model[], 32000000, 'exclusive', array['Incorporadora Exemplo Beta (fictícia)','Construtora Exemplo Alfa (fictícia)']),
  ('MD-003', 'Moinhos de Vento', 'Porto Alegre', 'Centro', -51.2020, -30.0260, 1250, 'urbano', 'qualified', 'Mista 05 (fictício)', 3.0, array['residencial vertical','comercial'], array['sale']::public.negotiation_model[], 14000000, 'non_exclusive', array[]::text[]),
  ('MD-004', 'Menino Deus', 'Porto Alegre', 'Centro-Sul', -51.2240, -30.0530, 2100, 'urbano', 'qualifying', 'Mista 03 (fictício)', 2.4, array['residencial vertical'], array['sale','swap']::public.negotiation_model[], 11000000, 'being_obtained', array[]::text[]),
  ('MD-005', 'Cristal', 'Porto Alegre', 'Zona Sul', -51.2400, -30.0900, 12400, 'gleba urbana', 'qualified', 'Mista 02 (fictício)', 1.6, array['residencial vertical','uso misto'], array['swap','partnership']::public.negotiation_model[], 48000000, 'exclusive', array['Incorporadora Exemplo Beta (fictícia)']),
  ('MD-006', 'Tristeza', 'Porto Alegre', 'Zona Sul', -51.2520, -30.1130, 4300, 'urbano', 'captured', 'Residencial 01 (fictício)', 1.3, array['condomínio horizontal'], array['sale']::public.negotiation_model[], null, 'none', array[]::text[]),
  ('MD-007', 'Ipanema', 'Porto Alegre', 'Zona Sul', -51.2280, -30.1380, 8800, 'urbano', 'qualified', 'Residencial 02 (fictício)', 1.5, array['condomínio horizontal','residencial vertical'], array['swap']::public.negotiation_model[], 21000000, 'non_exclusive', array['Construtora Exemplo Alfa (fictícia)']),
  ('MD-008', 'Sarandi', 'Porto Alegre', 'Zona Norte', -51.1300, -29.9900, 36000, 'gleba urbana', 'qualified', 'Industrial 01 (fictício)', 1.0, array['logístico','comercial'], array['sale','partnership']::public.negotiation_model[], 27000000, 'exclusive', array[]::text[]),
  ('MD-009', 'Jardim Europa', 'Porto Alegre', 'Centro-Leste', -51.1550, -30.0200, 6100, 'urbano', 'negotiating', 'Mista 04 (fictício)', 2.8, array['residencial vertical','uso misto'], array['swap']::public.negotiation_model[], 55000000, 'exclusive', array['Incorporadora Exemplo Beta (fictícia)','Construtora Exemplo Alfa (fictícia)']),
  ('MD-010', 'Passo d''Areia', 'Porto Alegre', 'Zona Norte', -51.1600, -30.0080, 2700, 'urbano', 'qualified', 'Mista 03 (fictício)', 2.4, array['residencial vertical'], array['sale']::public.negotiation_model[], 9800000, 'non_exclusive', array[]::text[]),
  ('MD-011', 'Cavalhada', 'Porto Alegre', 'Zona Sul', -51.2300, -30.1000, 15800, 'gleba urbana', 'qualifying', 'Residencial 02 (fictício)', 1.5, array['loteamento','condomínio horizontal'], array['partnership']::public.negotiation_model[], null, 'being_obtained', array[]::text[]),
  ('MD-012', 'Restinga', 'Porto Alegre', 'Extremo Sul', -51.1350, -30.1500, 142000, 'gleba', 'qualified', 'Rural-urbana (fictício)', 0.8, array['loteamento'], array['partnership','swap']::public.negotiation_model[], 16000000, 'exclusive', array['Loteadora Exemplo Gama (fictícia)']),
  ('MD-013', 'Lomba do Pinheiro', 'Porto Alegre', 'Zona Leste', -51.1250, -30.1100, 68000, 'gleba', 'captured', 'Residencial 01 (fictício)', 1.0, array['loteamento','condomínio horizontal'], array['partnership']::public.negotiation_model[], null, 'none', array[]::text[]),
  ('MD-014', 'Humaitá', 'Porto Alegre', 'Zona Norte', -51.1950, -29.9920, 22000, 'gleba urbana', 'distributing', 'Mista 02 (fictício)', 1.8, array['residencial vertical','logístico'], array['sale','swap']::public.negotiation_model[], 38000000, 'exclusive', array['Construtora Exemplo Alfa (fictícia)']),
  ('MD-015', 'Navegantes', 'Porto Alegre', 'Zona Norte', -51.2050, -29.9950, 9500, 'urbano', 'qualified', 'Mista 04 (fictício)', 2.6, array['uso misto','comercial'], array['sale']::public.negotiation_model[], 24000000, 'non_exclusive', array[]::text[]),
  ('MD-016', 'Partenon', 'Porto Alegre', 'Zona Leste', -51.1700, -30.0600, 3900, 'urbano', 'qualified', 'Mista 03 (fictício)', 2.2, array['residencial vertical'], array['swap']::public.negotiation_model[], 12500000, 'exclusive', array[]::text[]),
  ('MD-017', 'Agronomia', 'Porto Alegre', 'Zona Leste', -51.1300, -30.0700, 54000, 'gleba', 'lost', 'Residencial 01 (fictício)', 1.0, array['loteamento'], array['partnership']::public.negotiation_model[], null, 'non_exclusive', array['Loteadora Exemplo Gama (fictícia)']),
  ('MD-018', 'Belém Novo', 'Porto Alegre', 'Extremo Sul', -51.1800, -30.2000, 96000, 'gleba', 'qualified', 'Rural-urbana (fictício)', 0.6, array['condomínio horizontal','loteamento'], array['partnership','swap']::public.negotiation_model[], 19000000, 'exclusive', array[]::text[]),
  ('MD-019', 'Vila Nova', 'Porto Alegre', 'Zona Sul', -51.2050, -30.1150, 7200, 'urbano', 'qualifying', 'Residencial 02 (fictício)', 1.5, array['condomínio horizontal'], array['sale']::public.negotiation_model[], 8700000, 'being_obtained', array[]::text[]),
  ('MD-020', 'Aberta dos Morros', 'Porto Alegre', 'Zona Sul', -51.1850, -30.1450, 31000, 'gleba', 'captured', 'Residencial 01 (fictício)', 0.9, array['loteamento'], array['partnership']::public.negotiation_model[], null, 'none', array[]::text[]),
  ('MD-021', 'Centro', 'Canoas', 'Região Metropolitana', -51.1800, -29.9180, 11000, 'urbano', 'qualified', 'Mista (fictício)', 2.0, array['residencial vertical','uso misto'], array['swap']::public.negotiation_model[], 29000000, 'exclusive', array['Construtora Exemplo Alfa (fictícia)']),
  ('MD-022', 'Centro', 'Gravataí', 'Região Metropolitana', -50.9920, -29.9440, 45000, 'gleba urbana', 'qualified', 'Industrial (fictício)', 1.0, array['logístico'], array['sale']::public.negotiation_model[], 22000000, 'non_exclusive', array[]::text[]),
  ('MD-023', 'Centro', 'Eldorado do Sul', 'Região Metropolitana', -51.3800, -30.0850, 210000, 'gleba', 'qualifying', 'Expansão urbana (fictício)', 0.5, array['loteamento','logístico'], array['partnership']::public.negotiation_model[], null, 'being_obtained', array[]::text[]),
  ('MD-024', 'Centro', 'Viamão', 'Região Metropolitana', -51.0230, -30.0810, 18500, 'urbano', 'qualified', 'Residencial (fictício)', 1.2, array['condomínio horizontal','loteamento'], array['swap','partnership']::public.negotiation_model[], 9500000, 'exclusive', array[]::text[]),
  ('MD-025', 'Centro', 'Cachoeirinha', 'Região Metropolitana', -51.0940, -29.9510, 8300, 'urbano', 'archived', 'Mista (fictício)', 1.8, array['residencial vertical'], array['sale']::public.negotiation_model[], 13000000, 'none', array[]::text[])
),
ins as (
  insert into public.opportunities (
    memorial_number, status, land_type, area_m2, city, neighborhood, state, region_tags, zoning,
    master_plan_notes, buildable_potential_notes, coefficient, project_types, negotiation_conditions,
    asking_value, negotiation_models, geometry, mandate_status, extra, published_at
  )
  select
    md, status::public.opportunity_status, land_type, area, city, neighborhood, 'RS', array[region], zoning,
    'Texto fictício de plano diretor para desenvolvimento. Substituir pelos dados reais do MD.',
    'Potencial construtivo estimado ~' || replace(to_char(round(area * coef), 'FM999,999,999'), ',', '.') || ' m² (fictício).',
    coef, project_types,
    case when 'swap' = any(models) then 'Aceita permuta física/financeira; demais condições a negociar (fictício).'
         else 'Venda com pagamento a combinar (fictício).' end,
    asking, models,
    extensions.st_transform(
      extensions.st_expand(
        extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326), 31982),
        sqrt(area) / 2
      ),
      4326
    ),
    mandate::public.mandate_status,
    jsonb_build_object('fictitious', true)
      || case when cardinality(offered) > 0
              then jsonb_build_object('legacy_offered_to', jsonb_build_object('companies', to_jsonb(offered), 'raw', array_to_string(offered, '; ')))
              else '{}'::jsonb end,
    case when status in ('qualified', 'distributing', 'negotiating') then now() - (random() * interval '60 days') end
  from src
  returning id, memorial_number
)
insert into public.opportunity_sensitive (opportunity_id, registry_number, exact_address, owner_name, owner_contacts, notes)
select
  id,
  'MAT-' || substr(memorial_number, 4) || '-FICT',
  'Rua Fictícia, ' || (100 + substr(memorial_number, 4)::int * 17) || ' (endereço inventado)',
  'Proprietário Fictício ' || substr(memorial_number, 4),
  jsonb_build_object('phone', '+55 51 90000-00' || substr(memorial_number, 4), 'email', 'proprietario' || substr(memorial_number, 4) || '@exemplo.invalid'),
  'Dado sensível fictício para testes de bloqueio.'
from ins;
