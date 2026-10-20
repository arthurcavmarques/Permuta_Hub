import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { NegotiationModel, OpportunityStatus } from '@/features/opportunities/types';

/** Espelha a migration 20261019000003_owner_leads. */
export type RespondentRelation = 'owner' | 'authorized_intermediary' | 'knows_owner';
export type LeadStatus = 'new' | 'qualifying' | 'forwarded' | 'discarded' | 'converted';

export interface OwnerLeadInput {
  relation: RespondentRelation;
  locationText: string;
  city: string;
  neighborhood: string;
  state: string;
  approxAreaM2: number | null;
  negotiationModels: NegotiationModel[];
  notes: string;
  name: string;
  phone: string | null;
  email: string | null;
  privacyAccepted: boolean;
  /** Campo invisível: pessoa não preenche, robô sim. */
  honeypot: string;
}

export class TooManySubmissions extends Error {}

/** Validação, rate limit, consentimento e honeypot ficam no banco (submit_owner_lead). */
export function useSubmitOwnerLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: OwnerLeadInput) => {
      const utm = Object.fromEntries(
        [...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith('utm_')),
      );
      const { error } = await supabase.rpc('submit_owner_lead', {
        p_relation: v.relation,
        p_location_text: v.locationText,
        p_city: v.city,
        p_neighborhood: v.neighborhood || null,
        p_state: v.state,
        p_approx_area_m2: v.approxAreaM2,
        p_negotiation_models: v.negotiationModels,
        p_notes: v.notes || null,
        p_name: v.name,
        p_phone: v.phone,
        p_email: v.email,
        p_privacy_accepted: v.privacyAccepted,
        p_honeypot: v.honeypot || null,
        p_utm: utm,
      });
      if (error) {
        if (error.code === '54000') throw new TooManySubmissions();
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-areas'] }),
  });
}

export interface OwnerArea {
  lead_id: string;
  location_text: string;
  city: string;
  neighborhood: string | null;
  approx_area_m2: number | null;
  lead_status: LeadStatus;
  created_at: string;
  memorial_number: string | null;
  opportunity_status: OpportunityStatus | null;
  awaiting_responsible: boolean;
  responsible_name: string | null;
  responsible_phone: string | null;
  recipients_count: number;
  interested_count: number;
}

export function useOwnerAreas() {
  return useQuery({
    queryKey: ['owner-areas'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('owner_my_areas');
      if (error) throw error;
      return data as OwnerArea[];
    },
  });
}
