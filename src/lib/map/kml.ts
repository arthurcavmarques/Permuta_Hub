import { kml } from '@tmcw/togeojson';
import JSZip from 'jszip';
import type { Geometry, MultiPolygon, Point, Polygon, Position } from 'geojson';

export type AreaGeometry = Polygon | MultiPolygon | Point;

/**
 * Lê um KML/KMZ do Google Earth no navegador e devolve uma geometria para a área: os polígonos viram um
 * (multi)polígono; sem polígono, o primeiro ponto. Coordenada Z é descartada. O banco valida de novo.
 */
export async function geometryFromKmlFile(file: File): Promise<AreaGeometry> {
  let text: string;
  if (file.name.toLowerCase().endsWith('.kmz')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('doc.kml') ?? zip.file(/\.kml$/i)[0];
    if (!entry) throw new Error('KMZ sem arquivo .kml');
    text = await entry.async('string');
  } else {
    text = await file.text();
  }
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const geometries = kml(doc)
    .features.map((f) => f.geometry)
    .filter((g): g is Geometry => !!g);
  return pickAreaGeometry(geometries);
}

const strip = (c: Position): Position => [c[0], c[1]];

export function pickAreaGeometry(geometries: Geometry[]): AreaGeometry {
  const polygons: Position[][][] = [];
  let point: Point | null = null;
  const visit = (g: Geometry) => {
    if (g.type === 'Polygon') polygons.push(g.coordinates.map((r) => r.map(strip)));
    else if (g.type === 'MultiPolygon')
      g.coordinates.forEach((p) => polygons.push(p.map((r) => r.map(strip))));
    else if (g.type === 'Point' && !point)
      point = { type: 'Point', coordinates: strip(g.coordinates) };
    else if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
  };
  geometries.forEach(visit);
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  if (polygons.length > 1) return { type: 'MultiPolygon', coordinates: polygons };
  if (point) return point;
  throw new Error('O arquivo não tem polígono nem ponto');
}
