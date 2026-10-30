import type { NegotiationModel } from '@/features/opportunities/types';
import type { Thesis, ThesisInput } from './api';

/** Valores do formulário: listas como texto separado por vírgula, números como texto (vírgula decimal ok). */
export interface ThesisFormValues {
  name: string;
  active: boolean;
  asset_types: string[];
  states: string;
  cities: string;
  region_tags: string;
  min_area_m2: string;
  max_area_m2: string;
  negotiation_models: NegotiationModel[];
  min_ticket: string;
  max_ticket: string;
  zonings: string;
  min_coefficient: string;
  project_types: string;
  neighborhoods: string;
  notes: string;
}

export const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** "1.200.000" (milhar) e "2,5" (decimal) viram número; vazio vira null. */
export function parseNumber(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)
    ? v.replace(/\./g, '').replace(',', '.')
    : v.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export function emptyThesisForm(): ThesisFormValues {
  return {
    name: '',
    active: true,
    asset_types: [],
    states: '',
    cities: '',
    region_tags: '',
    min_area_m2: '',
    max_area_m2: '',
    negotiation_models: [],
    min_ticket: '',
    max_ticket: '',
    zonings: '',
    min_coefficient: '',
    project_types: '',
    neighborhoods: '',
    notes: '',
  };
}

export function thesisToForm(t: Thesis): ThesisFormValues {
  const num = (n: number | null) => (n === null ? '' : String(n));
  return {
    name: t.name,
    active: t.active,
    asset_types: t.asset_types,
    states: t.states.join(', '),
    cities: t.cities.join(', '),
    region_tags: t.region_tags.join(', '),
    min_area_m2: num(t.min_area_m2),
    max_area_m2: num(t.max_area_m2),
    negotiation_models: t.negotiation_models,
    min_ticket: num(t.min_ticket),
    max_ticket: num(t.max_ticket),
    zonings: t.zonings.join(', '),
    min_coefficient: num(t.min_coefficient),
    project_types: t.project_types.join(', '),
    neighborhoods: t.neighborhoods.join(', '),
    notes: t.notes ?? '',
  };
}

export type ThesisFormErrors = Partial<Record<keyof ThesisFormValues, 'name' | 'number' | 'range'>>;

/** Valida e converte. Devolve os erros por campo (código) ou a linha pronta para gravar. */
export function formToThesis(
  v: ThesisFormValues,
  organizationId: string,
): { errors: ThesisFormErrors } | { input: ThesisInput } {
  const errors: ThesisFormErrors = {};
  if (v.name.trim().length < 2) errors.name = 'name';
  const nums = {
    min_area_m2: parseNumber(v.min_area_m2),
    max_area_m2: parseNumber(v.max_area_m2),
    min_ticket: parseNumber(v.min_ticket),
    max_ticket: parseNumber(v.max_ticket),
    min_coefficient: parseNumber(v.min_coefficient),
  };
  for (const [k, n] of Object.entries(nums)) {
    if (Number.isNaN(n)) errors[k as keyof ThesisFormValues] = 'number';
  }
  const ok = (n: number | null) => n !== null && !Number.isNaN(n);
  if (ok(nums.min_area_m2) && ok(nums.max_area_m2) && nums.min_area_m2! > nums.max_area_m2!)
    errors.max_area_m2 = 'range';
  if (ok(nums.min_ticket) && ok(nums.max_ticket) && nums.min_ticket! > nums.max_ticket!)
    errors.max_ticket = 'range';
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      organization_id: organizationId,
      name: v.name.trim(),
      active: v.active,
      asset_types: v.asset_types,
      states: splitList(v.states).map((s) => s.toUpperCase()),
      cities: splitList(v.cities),
      region_tags: splitList(v.region_tags),
      min_area_m2: nums.min_area_m2,
      max_area_m2: nums.max_area_m2,
      negotiation_models: v.negotiation_models,
      min_ticket: nums.min_ticket,
      max_ticket: nums.max_ticket,
      zonings: splitList(v.zonings),
      min_coefficient: nums.min_coefficient,
      project_types: splitList(v.project_types),
      neighborhoods: splitList(v.neighborhoods),
      notes: v.notes.trim() || null,
    },
  };
}
