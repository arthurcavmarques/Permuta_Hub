import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { LeadStatus, RespondentRelation } from '@/features/owner/api';
import type {
  MandateStatus,
  NegotiationModel,
  OpportunityStatus,
} from '@/features/opportunities/types';

// ---------------------------------------------------------------- leads
export interface Lead {
  id: string;
  respondent_relation: RespondentRelation;
  location_text: string;
  city: string;
  neighborhood: string | null;
  state: string;
  approx_area_m2: number | null;
  negotiation_models: NegotiationModel[];
  notes: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  status: LeadStatus;
  status_note: string | null;
  assigned_to: string | null;
  source: 'public_form' | 'owner_account';
  converted_opportunity_id: string | null;
  created_at: string;
}

/** Curadoria vê todos; corretor vê os encaminhados a ele (RLS). */
export function useLeads() {
  return useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owner_leads')
        .select(
          'id, respondent_relation, location_text, city, neighborhood, state, approx_area_m2, negotiation_models, notes, name, phone, email, status, status_note, assigned_to, source, converted_opportunity_id, created_at',
        )
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Lead[];
    },
  });
}

export function useCurateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      leadId: string;
      status: LeadStatus;
      note?: string;
      assignTo?: string;
    }) => {
      const { error } = await supabase.rpc('curate_lead', {
        p_lead_id: v.leadId,
        p_status: v.status,
        p_note: v.note ?? null,
        p_assign_to: v.assignTo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { data, error } = await supabase.rpc('convert_lead', { p_lead_id: leadId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['leads'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'areas'] }),
      ]),
  });
}

export interface BrokerOption {
  user_id: string;
  full_name: string | null;
  email: string;
  creci_number: string;
  creci_state: string;
}

export function useBrokers() {
  return useQuery({
    queryKey: ['admin', 'brokers-approved'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_brokers');
      if (error) throw error;
      return data as BrokerOption[];
    },
  });
}

// ---------------------------------------------------------------- áreas (pipeline)
export interface AdminArea {
  id: string;
  memorial_number: string;
  status: OpportunityStatus;
  mandate_status: MandateStatus;
  city: string | null;
  neighborhood: string | null;
  area_m2: number | null;
  responsible_party_user_id: string | null;
  published_at: string | null;
  updated_at: string;
}

export function useAdminAreas() {
  return useQuery({
    queryKey: ['admin', 'areas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select(
          'id, memorial_number, status, mandate_status, city, neighborhood, area_m2, responsible_party_user_id, published_at, updated_at',
        )
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as AdminArea[];
    },
  });
}

export type BlockerCode =
  | 'missing_city'
  | 'missing_neighborhood'
  | 'missing_area'
  | 'missing_zoning'
  | 'missing_coefficient'
  | 'missing_asking_value'
  | 'missing_models'
  | 'missing_geometry'
  | 'missing_blind_photo'
  | 'no_responsible'
  | 'responsible_creci_not_verified'
  | 'no_area_term'
  | 'no_owner_authorization'
  | 'no_mandate';

export function useBlockers(id: string) {
  return useQuery({
    queryKey: ['admin', 'blockers', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('opportunity_publish_blockers', {
        p_opportunity_id: id,
      });
      if (error) throw error;
      return data as BlockerCode[];
    },
  });
}

function useInvalidateArea(id: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin'] }),
      qc.invalidateQueries({ queryKey: ['editor', id] }),
      qc.invalidateQueries({ queryKey: ['opportunity-events', id] }),
      qc.invalidateQueries({ queryKey: ['opportunities-blind'] }),
    ]);
}

export function usePublish(id: string) {
  const invalidate = useInvalidateArea(id);
  return useMutation({
    mutationFn: async (note: string | null) => {
      const { error } = await supabase.rpc('publish_opportunity', {
        p_opportunity_id: id,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useCurateArea(id: string) {
  const invalidate = useInvalidateArea(id);
  return useMutation({
    mutationFn: async (v: {
      status?: OpportunityStatus;
      mandate?: MandateStatus;
      responsibleUserId?: string;
      clearResponsible?: boolean;
      unpublish?: boolean;
      note?: string;
    }) => {
      const { error } = await supabase.rpc('curate_opportunity', {
        p_opportunity_id: id,
        p_status: v.status ?? null,
        p_mandate: v.mandate ?? null,
        p_responsible_user_id: v.responsibleUserId ?? null,
        p_clear_responsible: v.clearResponsible ?? false,
        p_unpublish: v.unpublish ?? false,
        p_note: v.note || null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export interface OpportunityEvent {
  id: string;
  kind: 'created' | 'status' | 'mandate' | 'responsible' | 'published' | 'unpublished' | 'note';
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  actor_id: string | null;
  at: string;
}

export function useOpportunityEvents(id: string) {
  return useQuery({
    queryKey: ['opportunity-events', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunity_events')
        .select('id, kind, from_value, to_value, note, actor_id, at')
        .eq('opportunity_id', id)
        .order('at', { ascending: false });
      if (error) throw error;
      return data as OpportunityEvent[];
    },
  });
}

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: string) => {
      const { error } = await supabase.rpc('add_opportunity_note', {
        p_opportunity_id: id,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity-events', id] }),
  });
}

// ---------------------------------------------------------------- logs de acesso
export interface AccessLogRow {
  seq: number;
  at: string;
  action: string;
  actor_name: string | null;
  actor_email: string | null;
  resource_type: string;
  memorial_number: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface AccessLogFilters {
  from: string;
  to: string;
  action: string;
  memorial: string;
}

export function useAccessLog(f: AccessLogFilters) {
  return useQuery({
    queryKey: ['admin', 'access-log', f],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_access_log', {
        p_from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : null,
        p_to: f.to
          ? new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000).toISOString()
          : null,
        p_action: f.action || null,
        p_memorial: f.memorial.trim() || null,
        p_limit: 2000,
      });
      if (error) throw error;
      return data as AccessLogRow[];
    },
  });
}
