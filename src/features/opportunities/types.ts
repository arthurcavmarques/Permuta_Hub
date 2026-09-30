export type OpportunityStatus =
  | 'captured'
  | 'qualifying'
  | 'qualified'
  | 'distributing'
  | 'negotiating'
  | 'closed'
  | 'lost'
  | 'archived';

export type NegotiationModel = 'sale' | 'swap' | 'partnership' | 'other';
export type MandateStatus = 'exclusive' | 'non_exclusive' | 'being_obtained' | 'none';

/** Linha da view opportunities_blind: só campos seguros para o dossiê cego. */
export interface BlindOpportunity {
  id: string;
  memorial_number: string;
  title: string;
  asset_type: string;
  status: OpportunityStatus;
  land_type: string | null;
  area_m2_approx: number | null;
  city: string | null;
  neighborhood: string | null;
  state: string | null;
  region_tags: string[];
  zoning: string | null;
  master_plan_notes: string | null;
  buildable_potential_notes: string | null;
  coefficient: number | null;
  project_types: string[];
  negotiation_conditions: string | null;
  asking_value: number | null;
  negotiation_models: NegotiationModel[];
  mandate_status: MandateStatus;
  approx_lng: number | null;
  approx_lat: number | null;
  approx_radius_m: number;
  published_at: string | null;
  updated_at: string;
}

export interface SensitiveData {
  registry_number: string | null;
  exact_address: string | null;
  owner_name: string | null;
  owner_contacts: Record<string, unknown>;
  notes: string | null;
}

export interface BlindMedia {
  id: string;
  kind: 'photo' | 'map' | 'aerial' | 'other';
  storage_path: string;
  caption: string | null;
  sort_order: number;
}
