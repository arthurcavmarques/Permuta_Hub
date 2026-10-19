// Implementação ativa do MapProvider. Para trocar de provedor, aponte para outro arquivo.
export { OpportunitiesMap, ApproxLocationMap, GeometryEditorMap } from './maplibre';
export type { MapPoint, LngLat } from './types';
export { geometryFromKmlFile, type AreaGeometry } from './kml';
