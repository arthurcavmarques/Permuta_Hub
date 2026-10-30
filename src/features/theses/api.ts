import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { NegotiationModel } from '@/features/opportunities/types';
import type { OrganizationType } from '@/lib/identity';

/** Tese de interesse: o que uma empresa compradora procura (vazio/nulo = sem restrição). */
export interface Thesis {
  id: string;
  organization_id: string;
  name: string;
  active: boolean;
  asset_types: string[];
  states: string[];
  cities: string[];
  region_tags: string[];
  min_area_m2: number | null;
  max_area_m2: number | null;
  negotiation_models: NegotiationModel[];
  min_ticket: number | null;
  max_ticket: number | null;
  zonings: string[];
  min_coefficient: number | null;
  project_types: string[];
  neighborhoods: string[];
  notes: string | null;
  updated_at: string;
}

export type ThesisInput = Omit<Thesis, 'id' | 'updated_at'>;

const COLUMNS =
  'id, organization_id, name, active, asset_types, states, cities, region_tags, min_area_m2, max_area_m2, negotiation_models, min_ticket, max_ticket, zonings, min_coefficient, project_types, neighborhoods, notes, updated_at';

/** RLS: curadoria vê todas; membro aprovado vê as da própria organização. */
export function useTheses(organizationId?: string) {
  return useQuery({
    queryKey: ['theses', organizationId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('buyer_theses').select(COLUMNS).order('name');
      if (organizationId) q = q.eq('organization_id', organizationId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Thesis[];
    },
  });
}

export function useSaveThesis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string; values: ThesisInput }) => {
      const { error } = v.id
        ? await supabase.from('buyer_theses').update(v.values).eq('id', v.id)
        : await supabase.from('buyer_theses').insert(v.values);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['theses'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'matches'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'buyer-orgs'] });
    },
  });
}

export interface BuyerOrganization {
  id: string;
  name: string;
  type: OrganizationType;
  theses: number;
}

export function useBuyerOrganizations() {
  return useQuery({
    queryKey: ['admin', 'buyer-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_buyer_organizations');
      if (error) throw error;
      return data as BuyerOrganization[];
    },
  });
}

// ---------------------------------------------------------------- matches (curadoria)
export type MatchStatus = 'suggested' | 'approved' | 'rejected';
export type ReasonResult = 'pass' | 'partial' | 'fail';

export interface MatchReason {
  criterion: string;
  kind: 'hard' | 'soft';
  result: ReasonResult;
  detail: string;
}

export interface MatchRow {
  id: string;
  opportunity_id: string;
  memorial_number: string;
  city: string | null;
  neighborhood: string | null;
  area_m2: number | null;
  asset_type: string | null;
  asking_value: number | null;
  organization_id: string;
  organization_name: string;
  thesis_id: string;
  thesis_name: string;
  score: number;
  manual_score: number | null;
  reasons: MatchReason[];
  status: MatchStatus;
  still_matches: boolean;
  computed_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  publish_blockers: string[];
}

export function useMatches() {
  return useQuery({
    queryKey: ['admin', 'matches'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_matches');
      if (error) throw error;
      return data as MatchRow[];
    },
  });
}

export function useDecideMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      matchId: string;
      status: MatchStatus;
      note?: string;
      manualScore?: number | null;
    }) => {
      const { error } = await supabase.rpc('decide_match', {
        p_match_id: v.matchId,
        p_status: v.status,
        p_note: v.note ?? null,
        p_manual_score: v.manualScore ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'matches'] }),
  });
}

export function useRecomputeMatches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('admin_recompute_matches');
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'matches'] }),
  });
}

export interface MatchConfig {
  weights: Record<string, number>;
  min_score: number;
  auto_approve_score: number | null;
  fresh_days: number;
  stale_days: number;
}

export function useMatchConfig() {
  return useQuery({
    queryKey: ['platform-settings', 'match_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'match_config')
        .maybeSingle();
      if (error) throw error;
      return data?.value as MatchConfig;
    },
  });
}

/** A curadoria edita a configuração direto (RLS de platform_settings); depois recalcula. */
export function useSaveMatchConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: MatchConfig) => {
      const { error } = await supabase
        .from('platform_settings')
        .update({ value })
        .eq('key', 'match_config');
      if (error) throw error;
      const { error: e2 } = await supabase.rpc('admin_recompute_matches');
      if (e2) throw e2;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings', 'match_config'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'matches'] });
    },
  });
}

// ---------------------------------------------------------------- corretor padrão (áreas do proprietário)
export function useDefaultOwnerBroker() {
  return useQuery({
    queryKey: ['platform-settings', 'owner_lead_default_broker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'owner_lead_default_broker')
        .maybeSingle();
      if (error) throw error;
      return (data?.value as string | null) ?? null;
    },
  });
}

export function useSetDefaultOwnerBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string | null) => {
      const { error } = await supabase.rpc('set_owner_lead_default_broker', { p_user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-settings', 'owner_lead_default_broker'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
