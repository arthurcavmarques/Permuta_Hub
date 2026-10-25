import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AssetTypeOption {
  value: string;
  label: string;
}

/** Tipos de ativo aceitos (platform_settings.asset_types, editável sem deploy; D026). */
export function useAssetTypes() {
  return useQuery({
    queryKey: ['platform-settings', 'asset_types'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'asset_types')
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? []) as AssetTypeOption[];
    },
  });
}
