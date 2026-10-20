import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Geometry } from 'geojson';
import { supabase } from '@/lib/supabase';
import type { MandateStatus, NegotiationModel, OpportunityStatus, SensitiveData } from '../types';

/** Linha completa de `opportunities` (sem geometria): RLS só devolve à curadoria e ao corretor responsável. */
export interface EditableOpportunity {
  id: string;
  memorial_number: string;
  title_blind: string | null;
  status: OpportunityStatus;
  land_type: string | null;
  area_m2: number | null;
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
  responsible_party_user_id: string | null;
  published_at: string | null;
}

const COLUMNS =
  'id, memorial_number, title_blind, status, land_type, area_m2, city, neighborhood, state, region_tags, zoning, master_plan_notes, buildable_potential_notes, coefficient, project_types, negotiation_conditions, asking_value, negotiation_models, mandate_status, responsible_party_user_id, published_at';

export const editorKeys = {
  opp: (id: string) => ['editor', id, 'opportunity'] as const,
  geometry: (id: string) => ['editor', id, 'geometry'] as const,
  media: (id: string) => ['editor', id, 'media'] as const,
  documents: (id: string) => ['editor', id, 'documents'] as const,
  canEdit: (id: string) => ['editor', id, 'can-edit'] as const,
};

export function useEditableOpportunity(id: string) {
  return useQuery({
    queryKey: editorKeys.opp(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select(COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as EditableOpportunity | null;
    },
  });
}

/** Mesma regra do banco (can_edit_opportunity): curadoria sempre; corretor enquanto captada/qualificando. */
export function useCanEdit(id: string) {
  return useQuery({
    queryKey: editorKeys.canEdit(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_edit_opportunity', { p_opportunity_id: id });
      if (error) throw error;
      return data as boolean;
    },
  });
}

export type OpportunityPatch = Partial<
  Omit<
    EditableOpportunity,
    | 'id'
    | 'memorial_number'
    | 'status'
    | 'mandate_status'
    | 'responsible_party_user_id'
    | 'published_at'
  >
>;

export function useUpdateOpportunity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: OpportunityPatch) => {
      const { error } = await supabase.from('opportunities').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: editorKeys.opp(id) }),
        qc.invalidateQueries({ queryKey: ['opportunities-blind'] }),
      ]),
  });
}

export function useGeometry(id: string) {
  return useQuery({
    queryKey: editorKeys.geometry(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_opportunity_geometry', {
        p_opportunity_id: id,
      });
      if (error) throw error;
      return (data ?? null) as Geometry | null;
    },
  });
}

export function useSetGeometry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (geometry: Geometry | null) => {
      const { error } = await supabase.rpc('set_opportunity_geometry_geojson', {
        p_opportunity_id: id,
        p_geojson: geometry,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: editorKeys.geometry(id) }),
        qc.invalidateQueries({ queryKey: ['opportunities-blind'] }),
      ]),
  });
}

/** Lê o dado sensível pela RPC (cada leitura fica no access_log). */
export function useLoadSensitive(id: string) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('get_opportunity_sensitive', {
        p_opportunity_id: id,
      });
      if (error) throw error;
      return ((data as SensitiveData[])[0] ?? null) as SensitiveData | null;
    },
  });
}

export function useSaveSensitive(id: string) {
  return useMutation({
    mutationFn: async (v: {
      registry_number: string;
      exact_address: string;
      owner_name: string;
      owner_phone: string;
      owner_email: string;
      notes: string;
    }) => {
      const contacts = Object.fromEntries(
        [
          ['phone', v.owner_phone.trim()],
          ['email', v.owner_email.trim()],
        ].filter(([, value]) => value),
      );
      const { error } = await supabase.rpc('upsert_opportunity_sensitive', {
        p_opportunity_id: id,
        p_registry_number: v.registry_number,
        p_exact_address: v.exact_address,
        p_owner_name: v.owner_name,
        p_owner_contacts: contacts,
        p_notes: v.notes,
      });
      if (error) throw error;
    },
  });
}

// ---------------------------------------------------------------- fotos
export type MediaKind = 'photo' | 'map' | 'aerial' | 'other';

export interface EditorMedia {
  id: string;
  kind: MediaKind;
  storage_path: string;
  caption: string | null;
  is_blind_safe: boolean;
  sort_order: number;
  url: string | null;
}

export function useEditorMedia(id: string) {
  return useQuery({
    queryKey: editorKeys.media(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunity_media')
        .select('id, kind, storage_path, caption, is_blind_safe, sort_order')
        .eq('opportunity_id', id)
        .order('sort_order');
      if (error) throw error;
      const rows = data as Omit<EditorMedia, 'url'>[];
      if (!rows.length) return [] as EditorMedia[];
      const { data: signed } = await supabase.storage.from('opportunity-media').createSignedUrls(
        rows.map((m) => m.storage_path),
        60 * 10,
      );
      return rows.map((m, i) => ({ ...m, url: signed?.[i]?.signedUrl ?? null }));
    },
  });
}

/** Nome no bucket: <opportunity_id>/<aleatório>.<ext> (a política do Storage lê a pasta). */
function objectPath(opportunityId: string, file: File) {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin';
  return `${opportunityId}/${crypto.randomUUID()}.${ext}`;
}

export function useUploadMedia(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { files: File[]; nextOrder: number }) => {
      let order = input.nextOrder;
      for (const file of input.files) {
        const path = objectPath(id, file);
        const up = await supabase.storage
          .from('opportunity-media')
          .upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        const { error } = await supabase.from('opportunity_media').insert({
          opportunity_id: id,
          storage_path: path,
          kind: 'photo',
          is_blind_safe: false,
          sort_order: order++,
        });
        if (error) {
          await supabase.storage.from('opportunity-media').remove([path]);
          throw error;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editorKeys.media(id) }),
  });
}

export function useUpdateMedia(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      mediaId: string;
      patch: Partial<Pick<EditorMedia, 'caption' | 'is_blind_safe' | 'kind'>>;
    }) => {
      const { error } = await supabase
        .from('opportunity_media')
        .update(input.patch)
        .eq('id', input.mediaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editorKeys.media(id) }),
  });
}

export function useDeleteMedia(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: EditorMedia) => {
      const { error } = await supabase.from('opportunity_media').delete().eq('id', m.id);
      if (error) throw error;
      await supabase.storage.from('opportunity-media').remove([m.storage_path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editorKeys.media(id) }),
  });
}

// ---------------------------------------------------------------- documentos
export type DocumentKind = 'owner_authorization' | 'registry' | 'technical' | 'other';
export type DocumentSensitivity = 'blind' | 'restricted';
export type ReviewStatus = 'pending' | 'accepted' | 'rejected';

export interface OpportunityDocument {
  id: string;
  kind: DocumentKind;
  sensitivity: DocumentSensitivity;
  storage_path: string;
  file_name: string;
  review_status: ReviewStatus;
  review_note: string | null;
  created_at: string;
}

export function useDocuments(id: string) {
  return useQuery({
    queryKey: editorKeys.documents(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunity_documents')
        .select(
          'id, kind, sensitivity, storage_path, file_name, review_status, review_note, created_at',
        )
        .eq('opportunity_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OpportunityDocument[];
    },
  });
}

export function useUploadDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      kind: DocumentKind;
      sensitivity: DocumentSensitivity;
    }) => {
      const path = objectPath(id, input.file);
      const up = await supabase.storage
        .from('opportunity-documents')
        .upload(path, input.file, { contentType: input.file.type });
      if (up.error) throw up.error;
      const { error } = await supabase.from('opportunity_documents').insert({
        opportunity_id: id,
        kind: input.kind,
        sensitivity: input.kind === 'owner_authorization' ? 'restricted' : input.sensitivity,
        storage_path: path,
        file_name: input.file.name.slice(0, 200),
      });
      if (error) {
        await supabase.storage.from('opportunity-documents').remove([path]);
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editorKeys.documents(id) }),
  });
}

export function useDeleteDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: OpportunityDocument) => {
      const { error } = await supabase.from('opportunity_documents').delete().eq('id', d.id);
      if (error) throw error;
      await supabase.storage.from('opportunity-documents').remove([d.storage_path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editorKeys.documents(id) }),
  });
}

export async function documentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('opportunity-documents')
    .createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export function useReviewAuthorization(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; accept: boolean; note?: string }) => {
      const { error } = await supabase.rpc('review_owner_authorization', {
        p_document_id: input.documentId,
        p_accept: input.accept,
        p_note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: editorKeys.documents(id) }),
  });
}
