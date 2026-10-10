import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { MemberRole, OrganizationType } from '@/lib/identity';

export interface InvitationPreview {
  organization_name: string;
  email: string;
  role: MemberRole;
  valid: boolean;
}

/** Prévia pública (anon pode chamar): só organização, e-mail convidado e papel. */
export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: ['invitation-preview', token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_invitation_preview', { p_token: token! });
      if (error) throw error;
      return ((data as InvitationPreview[])[0] ?? null) as InvitationPreview | null;
    },
  });
}

export async function acceptInvitation(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) throw error;
  return data as string;
}

export interface OrganizationDetail {
  id: string;
  name: string;
  type: OrganizationType;
  city: string | null;
  state: string | null;
  active: boolean;
}

export interface MemberRow {
  id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  profile: { full_name: string | null } | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: MemberRole;
  expires_at: string;
  created_at: string;
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['organization', id],
    queryFn: async () => {
      const [org, members, invites] = await Promise.all([
        supabase
          .from('organizations')
          .select('id, name, type, city, state, active')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('organization_members')
          .select('id, user_id, role, created_at')
          .eq('organization_id', id)
          .order('created_at'),
        supabase
          .from('invitations')
          .select('id, email, role, expires_at, created_at')
          .eq('organization_id', id)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ]);
      for (const r of [org, members, invites]) if (r.error) throw r.error;
      // Nomes vêm de profiles (RLS: colegas de organização se veem).
      const ids = (members.data ?? []).map((m) => m.user_id);
      const { data: profiles, error } = ids.length
        ? await supabase.from('profiles').select('user_id, full_name').in('user_id', ids)
        : { data: [], error: null };
      if (error) throw error;
      const names = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name as string | null]));
      return {
        organization: org.data as OrganizationDetail | null,
        members: (members.data ?? []).map((m) => ({
          ...m,
          profile: { full_name: names.get(m.user_id) ?? null },
        })) as MemberRow[],
        invitations: (invites.data ?? []) as InvitationRow[],
      };
    },
  });
}

export interface CreatedInvitation {
  invitation_id: string;
  token: string;
  accept_url: string;
}

export function useCreateInvitation(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: MemberRole }) => {
      const { data, error } = await supabase.rpc('create_invitation', {
        p_organization_id: organizationId,
        p_email: email,
        p_role: role,
      });
      if (error) throw error;
      const created = (data as CreatedInvitation[])[0];
      // O banco monta a URL com app_base_url; no navegador, a origem atual é a verdade.
      return { ...created, accept_url: `${window.location.origin}/convite/${created.token}` };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', organizationId] }),
  });
}

export function useRevokeInvitation(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase
        .from('invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', invitationId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', organizationId] }),
  });
}

export function useRemoveMember(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('organization_members').delete().eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', organizationId] }),
  });
}
