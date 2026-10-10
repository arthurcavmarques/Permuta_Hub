import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ConsentPurpose, ContactChannel, OrganizationType, SignupKind } from '@/lib/identity';

export interface ConsentText {
  id: string;
  purpose: ConsentPurpose;
  version: string;
  body: string;
}

/** Textos ATIVOS: o que a pessoa lê é exatamente o que o banco registra (record_consent). */
export function useActiveConsentTexts() {
  return useQuery({
    queryKey: ['consent-texts'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consent_texts')
        .select('id, purpose, version, body')
        .eq('active', true);
      if (error) throw error;
      return Object.fromEntries((data as ConsentText[]).map((c) => [c.purpose, c])) as Partial<
        Record<ConsentPurpose, ConsentText>
      >;
    },
  });
}

export interface CurrentConsent {
  purpose: ConsentPurpose;
  granted: boolean;
  text_version: string;
  at: string;
}

export function useMyConsents(userId: string | undefined) {
  return useQuery({
    queryKey: ['my-consents', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('current_contact_consents')
        .select('purpose, granted, text_version, at')
        .eq('user_id', userId!);
      if (error) throw error;
      return data as CurrentConsent[];
    },
  });
}

export async function recordConsent(purpose: ConsentPurpose, granted: boolean) {
  const { error } = await supabase.rpc('record_consent', {
    p_purpose: purpose,
    p_granted: granted,
  });
  if (error) throw error;
}

export function useRecordConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ purpose, granted }: { purpose: ConsentPurpose; granted: boolean }) =>
      recordConsent(purpose, granted),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-consents'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export interface SignupInput {
  kind: SignupKind;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  whatsapp: boolean;
  emailContact: boolean;
}

export class EmailAlreadyRegistered extends Error {}

/** Cria a conta (nasce pendente, D014) e registra os consentimentos com o texto ativo. */
export async function signUp(input: SignupInput) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName, phone: input.phone, signup_kind: input.kind },
    },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) throw new EmailAlreadyRegistered();
    throw error;
  }
  // Supabase devolve usuário "fantasma" sem identidades quando o e-mail já existe.
  if (data.user && data.user.identities?.length === 0) throw new EmailAlreadyRegistered();
  if (!data.session) throw new Error('Conta criada sem sessão (confirmação de e-mail ligada?)');

  await recordConsent('privacy_policy', true);
  if (input.whatsapp) await recordConsent('whatsapp', true);
  if (input.emailContact) await recordConsent('email', true);
  return data.user!;
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      full_name: string;
      phone: string | null;
      preferred_channel: ContactChannel | null;
    }) => {
      const { userId, ...patch } = input;
      const { error } = await supabase.from('profiles').update(patch).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (password: string) => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
  });
}

/** CRECI: grava a linha (o banco força "pending") e sobe o documento em <user_id>/... */
export function useSubmitCreci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      creciNumber: string;
      creciState: string;
      file: File | null;
      currentPath: string | null;
    }) => {
      let documentPath = input.currentPath;
      if (input.file) {
        const ext = input.file.name.split('.').pop()?.toLowerCase() ?? 'bin';
        documentPath = `${input.userId}/creci-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('broker-documents')
          .upload(documentPath, input.file, { contentType: input.file.type });
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from('brokers').upsert(
        {
          user_id: input.userId,
          creci_number: input.creciNumber,
          creci_state: input.creciState,
          document_path: documentPath,
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      type: OrganizationType;
      documentId: string;
      city: string;
      state: string;
    }) => {
      const { data, error } = await supabase.rpc('create_my_organization', {
        p_name: input.name,
        p_type: input.type,
        p_document_id: input.documentId,
        p_city: input.city,
        p_state: input.state,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}
