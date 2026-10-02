import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BlindMedia, BlindOpportunity, SensitiveData } from './types';

export function useBlindOpportunities() {
  return useQuery({
    queryKey: ['opportunities-blind'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities_blind')
        .select('*')
        .order('memorial_number');
      if (error) throw error;
      return data as BlindOpportunity[];
    },
  });
}

export function useBlindOpportunity(id: string) {
  return useQuery({
    queryKey: ['opportunities-blind', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities_blind')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as BlindOpportunity | null;
    },
  });
}

/** Só mídias marcadas como seguras para o dossiê cego (garantido também pela RLS). */
export function useBlindMedia(opportunityId: string) {
  return useQuery({
    queryKey: ['opportunity-media', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunity_media')
        .select('id, kind, storage_path, caption, sort_order')
        .eq('opportunity_id', opportunityId)
        .eq('is_blind_safe', true)
        .order('sort_order');
      if (error) throw error;
      const media = data as BlindMedia[];
      if (!media.length) return [];
      // URLs assinadas curtas (bucket privado).
      const { data: signed, error: sErr } = await supabase.storage
        .from('opportunity-media')
        .createSignedUrls(
          media.map((m) => m.storage_path),
          60 * 10,
        );
      if (sErr) throw sErr;
      return media.map((m, i) => ({ ...m, url: signed[i]?.signedUrl ?? null }));
    },
  });
}

/** Revela dado sensível: a RPC checa permissão e grava access_log ANTES de devolver. */
export function useRevealSensitive(opportunityId: string) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('get_opportunity_sensitive', {
        p_opportunity_id: opportunityId,
      });
      if (error) throw error;
      return ((data as SensitiveData[])[0] ?? null) as SensitiveData | null;
    },
  });
}
