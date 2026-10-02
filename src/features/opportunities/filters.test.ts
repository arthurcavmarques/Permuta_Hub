import { emptyFilters, filterOpportunities, filtersFromParams, filtersToParams } from './filters';
import type { BlindOpportunity } from './types';

const base: BlindOpportunity = {
  id: '1',
  memorial_number: 'MD-001',
  title: 'x',
  asset_type: 'terreno',
  status: 'qualified',
  land_type: 'urbano',
  area_m2_approx: 3200,
  city: 'Porto Alegre',
  neighborhood: 'Petrópolis',
  state: 'RS',
  region_tags: ['Centro-Leste'],
  zoning: null,
  master_plan_notes: null,
  buildable_potential_notes: null,
  coefficient: 2.4,
  project_types: [],
  negotiation_conditions: null,
  asking_value: null,
  negotiation_models: ['sale'],
  mandate_status: 'exclusive',
  approx_lng: -51.18,
  approx_lat: -30.04,
  approx_radius_m: 500,
  published_at: null,
  updated_at: '2026-09-29',
};

const items: BlindOpportunity[] = [
  base,
  {
    ...base,
    id: '2',
    memorial_number: 'MD-002',
    neighborhood: 'Cristal',
    region_tags: ['Zona Sul'],
    area_m2_approx: 12400,
    land_type: 'gleba urbana',
  },
  {
    ...base,
    id: '3',
    memorial_number: 'MD-003',
    city: 'Canoas',
    neighborhood: 'Centro',
    region_tags: ['Região Metropolitana'],
    area_m2_approx: null,
    status: 'captured',
  },
];
const ids = (r: BlindOpportunity[]) => r.map((o) => o.id);

describe('filterOpportunities', () => {
  it('sem filtros devolve tudo', () => {
    expect(ids(filterOpportunities(items, emptyFilters))).toEqual(['1', '2', '3']);
  });
  it('região ignora acento e caixa; aceita vários termos', () => {
    expect(ids(filterOpportunities(items, { ...emptyFilters, region: 'petropolis' }))).toEqual([
      '1',
    ]);
    expect(
      ids(filterOpportunities(items, { ...emptyFilters, region: 'zona sul, canoas' })),
    ).toEqual(['2', '3']);
  });
  it('metragem inclui os limites exatos', () => {
    expect(
      ids(filterOpportunities(items, { ...emptyFilters, areaMin: 3200, areaMax: 12400 })),
    ).toEqual(['1', '2']);
    expect(ids(filterOpportunities(items, { ...emptyFilters, areaMin: 3201 }))).toEqual(['2']);
  });
  it('área desconhecida não passa por filtro de área', () => {
    expect(ids(filterOpportunities(items, { ...emptyFilters, areaMax: 1_000_000 }))).toEqual([
      '1',
      '2',
    ]);
  });
  it('tipo e status', () => {
    expect(ids(filterOpportunities(items, { ...emptyFilters, landType: 'Gleba Urbana' }))).toEqual([
      '2',
    ]);
    expect(ids(filterOpportunities(items, { ...emptyFilters, status: 'captured' }))).toEqual(['3']);
  });
});

describe('filtros na URL', () => {
  it('ida e volta', () => {
    const f = {
      region: 'Sul',
      areaMin: 1000,
      areaMax: null,
      landType: 'urbano',
      status: 'qualified' as const,
    };
    expect(filtersFromParams(filtersToParams(f))).toEqual(f);
  });
  it('valores inválidos viram vazio', () => {
    expect(filtersFromParams(new URLSearchParams('min=abc'))).toEqual(emptyFilters);
  });
});
