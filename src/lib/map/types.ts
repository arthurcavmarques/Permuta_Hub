import type { Geometry } from 'geojson';

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

export type LngLat = [number, number];

/**
 * Editor da localização EXATA (só curadoria e corretor responsável veem). Mostra a geometria salva e o
 * polígono em desenho; o clique no mapa devolve a coordenada para quem controla o desenho.
 */
export interface GeometryEditorMapProps {
  geometry: Geometry | null;
  draft: LngLat[];
  onMapClick?: (point: LngLat) => void;
  className?: string;
}
