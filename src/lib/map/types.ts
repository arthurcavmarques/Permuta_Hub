/**
 * Contrato da camada de mapas (adapter). As telas só conhecem estes componentes;
 * trocar MapLibre por Google Maps = nova implementação destes dois props, sem mexer nas telas.
 */
export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

export interface OpportunitiesMapProps {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

export interface ApproxLocationMapProps {
  lat: number;
  lng: number;
  radiusM: number;
  className?: string;
}
