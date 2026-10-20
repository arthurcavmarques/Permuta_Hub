import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  AccountStatus,
  CreciStatus,
  CreciType,
  MemberRole,
  OrganizationType,
  SignupKind,
  VerificationStatus,
} from '@/lib/identity';

export interface AdminUser {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  account_status: AccountStatus;
  signup_kind: SignupKind | null;
  is_platform_admin: boolean;
  creci_number: string | null;
  creci_state: string | null;
  broker_status: VerificationStatus | null;
  organizations: { id: string; name: string; role: MemberRole }[];
  created_at: string;
  reviewed_at: string | null;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_users');
      if (error) throw error;
      return data as AdminUser[];
    },
  });
}

export function useReviewAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; status: AccountStatus; note?: string }) => {
      const { error } = await supabase.rpc('review_account', {
        p_user_id: input.userId,
        p_status: input.status,
        p_note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export interface BrokerQueueItem {
  user_id: string;
  full_name: string | null;
  email: string;
  account_status: AccountStatus;
  creci_number: string;
  creci_state: string;
  creci_type: CreciType;
  creci_status: CreciStatus;
  verification_status: VerificationStatus;
  document_path: string | null;
  rejection_reason: string | null;
  verified_name: string | null;
  name_match_score: number | null;
  brokerage_name: string | null;
  brokerage_cnpj: string | null;
  updated_at: string;
  next_review_at: string | null;
  sla_overdue: boolean;
  review_due: boolean;
  lookup_url: string | null;
}

/** Fila do nível B (envios pendentes) + reverificações vencidas (nível C); com SLA e link da consulta oficial. */
export function useBrokerQueue(includeReviewed: boolean) {
  return useQuery({
    queryKey: ['admin', 'brokers', includeReviewed],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_broker_queue', {
        p_include_reviewed: includeReviewed,
      });
      if (error) throw error;
      return data as BrokerQueueItem[];
    },
  });
}

/** URL assinada curta para o documento de CRECI (bucket privado). */
export async function brokerDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('broker-documents')
    .createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export function useReviewBroker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      approve: boolean;
      reason?: string;
      creciStatus?: CreciStatus;
      verifiedName?: string;
    }) => {
      const { error } = await supabase.rpc('review_broker', {
        p_user_id: input.userId,
        p_approve: input.approve,
        p_reason: input.reason ?? null,
        p_creci_status: input.creciStatus ?? 'active',
        p_verified_name: input.verifiedName ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export type OrgVerification = 'unverified' | 'verified' | 'pending_manual' | 'pending_review';

export interface AdminOrganization {
  id: string;
  name: string;
  cnpj: string | null;
  legal_name: string | null;
  registry_status: string | null;
  registry_source: string | null;
  registry_verified_at: string | null;
  cnae_main_description: string | null;
  cnae_warning: boolean;
  verification_status: OrgVerification;
  verification_note: string | null;
  type: OrganizationType;
  city: string | null;
  state: string | null;
  active: boolean;
  created_at: string;
  members: { count: number }[];
}

export function useAdminOrganizations() {
  return useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select(
          'id, name, type, city, state, active, created_at, cnpj, legal_name, registry_status, registry_source, registry_verified_at, cnae_main_description, cnae_warning, verification_status, verification_note, members:organization_members(count)',
        )
        .order('name');
      if (error) throw error;
      return data as AdminOrganization[];
    },
  });
}

export function useSetOrganizationActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('organizations').update({ active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  body_text: string;
  template_key: string;
  status: 'queued' | 'sent' | 'failed';
  last_error: string | null;
  created_at: string;
}

export function useOutbox() {
  return useQuery({
    queryKey: ['admin', 'outbox'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_outbox')
        .select('id, to_email, subject, body_text, template_key, status, last_error, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as OutboxRow[];
    },
  });
}

export function useReviewOrganizationRegistry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc('review_organization_registry', {
        p_org_id: input.id,
        p_approve: input.approve,
        p_note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}
