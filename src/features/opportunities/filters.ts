import type { BlindOpportunity, OpportunityStatus } from './types';

export interface OpportunityFilters {
  region: string;
  areaMin: number | null;
  areaMax: number | null;
  landType: string;
  status: OpportunityStatus | '';
}

export const emptyFilters: OpportunityFilters = {
  region: '',
  areaMin: null,
  areaMax: null,
  landType: '',
  status: '',
};

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Filtro no cliente: a lista já vem restrita pela view cega (só o que o usuário pode ver) e o
 * Land Bank tem dezenas/centenas de áreas. Reavaliar para filtro no servidor acima de ~2 mil (D011).
 */
export function filterOpportunities(
  items: BlindOpportunity[],
  f: OpportunityFilters,
): BlindOpportunity[] {
  const terms = fold(f.region)
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return items.filter((o) => {
    if (f.status && o.status !== f.status) return false;
    if (f.landType && fold(o.land_type ?? '') !== fold(f.landType)) return false;
    // Área desconhecida não passa por um filtro de área explícito.
    if (f.areaMin !== null && (o.area_m2_approx === null || o.area_m2_approx < f.areaMin))
      return false;
    if (f.areaMax !== null && (o.area_m2_approx === null || o.area_m2_approx > f.areaMax))
      return false;
    if (terms.length) {
      const haystack = fold(
        [o.neighborhood, o.city, ...o.region_tags, o.memorial_number].filter(Boolean).join(' | '),
      );
      if (!terms.some((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

/** Filtros <-> URL, para poder compartilhar um link já filtrado. */
export function filtersFromParams(p: URLSearchParams): OpportunityFilters {
  const num = (k: string) => {
    const v = p.get(k);
    const n = v === null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    region: p.get('regiao') ?? '',
    areaMin: num('min'),
    areaMax: num('max'),
    landType: p.get('tipo') ?? '',
    status: (p.get('status') ?? '') as OpportunityStatus | '',
  };
}

export function filtersToParams(f: OpportunityFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.region) p.set('regiao', f.region);
  if (f.areaMin !== null) p.set('min', String(f.areaMin));
  if (f.areaMax !== null) p.set('max', String(f.areaMax));
  if (f.landType) p.set('tipo', f.landType);
  if (f.status) p.set('status', f.status);
  return p;
}
