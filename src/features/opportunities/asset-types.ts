import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AssetTypeOption {
  value: string;
  label: string;
}

function useOptionsSetting(key: string) {
  return useQuery({
    queryKey: ['platform-settings', key],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? []) as AssetTypeOption[];
    },
  });
}

/** Tipos de ativo aceitos: área urbana ou rural (platform_settings.asset_types, editável sem deploy; D030). */
export function useAssetTypes() {
  return useOptionsSetting('asset_types');
}

/** Vocação da área = tipos de projeto (platform_settings.project_type_options; D030). */
export function useProjectTypes() {
  return useOptionsSetting('project_type_options');
}

/** Rótulo de um valor; valor antigo fora da lista aparece como foi gravado. */
export function optionLabel(options: AssetTypeOption[] | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}
