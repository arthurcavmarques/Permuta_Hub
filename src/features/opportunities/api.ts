import { useMutation, useQuery } from '@tanstack/react-query';
import type { Geometry } from 'geojson';
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

/** Fotos do dossiê: quem vê a área vê todas (D030; a RLS decide quem vê a área). */
export function useBlindMedia(opportunityId: string) {
  return useQuery({
    queryKey: ['opportunity-media', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunity_media')
        .select('id, kind, storage_path, caption, sort_order')
        .eq('opportunity_id', opportunityId)
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

/**
 * Polígono exato para quem pode ver: curadoria, corretor responsável e quem recebeu a área (D030). A leitura do
 * comprador fica no access_log. Sem permissão (ex.: área do catálogo da curadoria) → null, e a tela usa o raio.
 */
export function useDossierGeometry(opportunityId: string) {
  return useQuery({
    queryKey: ['dossier-geometry', opportunityId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_opportunity_geometry', {
        p_opportunity_id: opportunityId,
      });
      if (error) return null;
      return (data ?? null) as Geometry | null;
    },
  });
}

export interface BrokerContact {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  creci: string | null;
  organization_name: string | null;
}

/** Contato do corretor responsável (o comprador fala com ele, D030). */
export function useBrokerContact(opportunityId: string) {
  return useQuery({
    queryKey: ['broker-contact', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_opportunity_broker_contact', {
        p_opportunity_id: opportunityId,
      });
      if (error) throw error;
      return ((data as BrokerContact[])[0] ?? null) as BrokerContact | null;
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
