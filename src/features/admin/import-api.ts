import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { MandateStatus, OpportunityStatus } from '@/features/opportunities/types';
import type { BlockerCode } from './curation-api';

export type ImportKind = 'landbank' | 'buyers';

export interface ImportRowResult {
  line: number;
  memorial_number?: string;
  action: string;
  /** Land Bank: [{field, from, to}] ou {field, sensitive}; compradores: nomes dos campos. */
  changes: Array<{ field: string; sensitive?: boolean } | string>;
  conflicts: Array<{ field: string; sensitive?: boolean } | string>;
  warnings: string[];
}

export interface ImportResult {
  batch_id: string | null;
  dry_run: boolean;
  counts: Record<string, number>;
  rows: ImportRowResult[];
  already_imported_batch_id: string | null;
}

export interface ImportRequest {
  kind: ImportKind;
  fileName: string;
  fileSha256: string;
  mapping: unknown;
  rows: unknown[];
  parseReport: unknown;
  dryRun: boolean;
}

const fieldName = (c: { field: string } | string) => (typeof c === 'string' ? c : c.field);
export const fieldsOf = (list: ImportRowResult['changes']) => list.map(fieldName);

export function useImportMapping(kind: ImportKind) {
  return useQuery({
    queryKey: ['admin', 'import-mapping', kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_mappings')
        .select('mapping')
        .eq('kind', kind)
        .single();
      if (error) throw error;
      return data.mapping as unknown;
    },
  });
}

export function useSaveImportMapping(kind: ImportKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mapping: unknown) => {
      const { error } = await supabase.from('import_mappings').update({ mapping }).eq('kind', kind);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'import-mapping', kind] }),
  });
}

/** Prévia (dryRun) e gravação passam pela mesma função do banco. */
export function useRunImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: ImportRequest) => {
      const { data, error } = await supabase.rpc(
        r.kind === 'landbank' ? 'import_landbank' : 'import_buyers',
        {
          p_file_name: r.fileName,
          p_file_sha256: r.fileSha256,
          p_mapping: r.mapping,
          p_rows: r.rows,
          p_parse_report: r.parseReport,
          p_dry_run: r.dryRun,
        },
      );
      if (error) throw error;
      return data as ImportResult;
    },
    onSuccess: (res) => {
      if (!res.dry_run) return qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export interface ImportBatch {
  id: string;
  kind: ImportKind | 'kml';
  file_name: string | null;
  counts: Record<string, number>;
  undoes_batch_id: string | null;
  undone_by: string | null;
  undoable: boolean;
  created_by_name: string | null;
  created_at: string;
  chain_ok: boolean;
}

export function useImportBatches() {
  return useQuery({
    queryKey: ['admin', 'import-batches'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_import_batches');
      if (error) throw error;
      return data as ImportBatch[];
    },
  });
}

export async function fetchBatchReport(id: string) {
  const { data, error } = await supabase
    .from('import_batches')
    .select('report')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data.report as {
    rows: Array<ImportRowResult & { kept_fields?: string[] }>;
    parse?: {
      rejected?: Array<{ line: number; reason: string; memorial_number?: string }>;
      ignored?: Array<{ line: number; reason: string }>;
    };
  };
}

export function useUndoBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { data, error } = await supabase.rpc('undo_import_batch', {
        p_batch_id: id,
        p_note: note || null,
      });
      if (error) throw error;
      return data as { batch_id: string; counts: Record<string, number> };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export interface ImportConflict {
  opportunity_id: string;
  memorial_number: string;
  field: string;
  sensitive: boolean;
  platform: unknown;
  sheet: unknown;
}

export function useImportConflicts() {
  return useQuery({
    queryKey: ['admin', 'import-conflicts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_import_conflicts');
      if (error) throw error;
      return data as ImportConflict[];
    },
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { opportunityId: string; field: string; useSheet: boolean }) => {
      const { error } = await supabase.rpc('resolve_import_conflict', {
        p_opportunity_id: v.opportunityId,
        p_field: v.field,
        p_use_sheet: v.useSheet,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export interface PublishableRow {
  id: string;
  memorial_number: string;
  status: OpportunityStatus;
  mandate_status: MandateStatus;
  city: string | null;
  neighborhood: string | null;
  area_m2: number | null;
  published_at: string | null;
  imported: boolean;
  open_conflicts: number;
  blockers: BlockerCode[];
}

export function usePublishableOverview() {
  return useQuery({
    queryKey: ['admin', 'publishable'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_publishable_overview');
      if (error) throw error;
      return data as PublishableRow[];
    },
  });
}

export function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
