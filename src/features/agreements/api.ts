import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Espelha os enums da migration 20261019000001_agreements. */
export type AgreementType =
  | 'non_circumvention'
  | 'broker_partnership'
  | 'broker_area_authorization'
  | 'owner_terms'
  | 'platform_terms';
export type AgreementScope = 'global' | 'opportunity';
export type SensitiveAccess = 'allowed' | 'needs_agreement' | 'denied';

export interface AgreementPreview {
  template_id: string;
  version: string;
  title: string;
  body: string;
  body_hash: string;
  scope: AgreementScope;
}

/** Texto exato que será aceito, já com os dados do aceitante (renderizado no servidor). */
export function useAgreementPreview(type: AgreementType, opportunityId?: string, enabled = true) {
  return useQuery({
    queryKey: ['agreement-preview', type, opportunityId ?? null],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_agreement_preview', {
        p_type: type,
        p_opportunity_id: opportunityId ?? null,
      });
      if (error) throw error;
      return ((data as AgreementPreview[])[0] ?? null) as AgreementPreview | null;
    },
  });
}

export function useHasAgreement(type: AgreementType, opportunityId?: string) {
  return useQuery({
    queryKey: ['has-agreement', type, opportunityId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_agreement', {
        p_type: type,
        p_opportunity_id: opportunityId ?? null,
      });
      if (error) throw error;
      return data as boolean;
    },
  });
}

/** O hash da prévia vai junto: se o texto mudou entre a leitura e o clique, o banco recusa. */
export function useAcceptAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: AgreementType; opportunityId?: string; bodyHash: string }) => {
      const { data, error } = await supabase.rpc('accept_agreement', {
        p_type: input.type,
        p_opportunity_id: input.opportunityId ?? null,
        p_expected_hash: input.bodyHash,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['has-agreement'] }),
        qc.invalidateQueries({ queryKey: ['sensitive-access'] }),
        qc.invalidateQueries({ queryKey: ['agreement-preview'] }),
      ]);
    },
  });
}

export function useSensitiveAccess(opportunityId: string) {
  return useQuery({
    queryKey: ['sensitive-access', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sensitive_access_state', {
        p_opportunity_id: opportunityId,
      });
      if (error) throw error;
      return data as SensitiveAccess;
    },
  });
}

// ---------------------------------------------------------------- curadoria
export interface AgreementTemplate {
  id: string;
  type: AgreementType;
  version: string;
  title: string;
  body_markdown: string;
  body_hash: string;
  scope: AgreementScope;
  validity_months: number | null;
  active: boolean;
  created_at: string;
}

export function useAgreementTemplates() {
  return useQuery({
    queryKey: ['admin', 'agreement-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agreement_templates')
        .select('id, type, version, title, body_markdown, body_hash, scope, validity_months, active, created_at')
        .order('type')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as AgreementTemplate[];
    },
  });
}

export function usePublishAgreementTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: AgreementType;
      version: string;
      title: string;
      body: string;
      scope: AgreementScope;
      validityMonths: number | null;
    }) => {
      const { error } = await supabase.rpc('publish_agreement_template', {
        p_type: input.type,
        p_version: input.version,
        p_title: input.title,
        p_body: input.body,
        p_scope: input.scope,
        p_validity_months: input.validityMonths,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'agreement-templates'] }),
  });
}
