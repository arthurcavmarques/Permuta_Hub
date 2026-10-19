import { useEffect, useRef, useState } from 'react';
import {
  Map as MLMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapOptions,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// O MapLibre acha o worker relativo ao próprio arquivo; no bundle de produção esse arquivo não
// existe e o mapa fica em branco. O Vite empacota o worker e devolve a URL final.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { cn } from '@/lib/utils';
import { boundsOf, circlePolygon } from './geo';
import type { Geometry } from 'geojson';
import type {
  ApproxLocationMapProps,
  GeometryEditorMapProps,
  LngLat,
  OpportunitiesMapProps,
} from './types';

// OpenFreeMap: dados OSM, gratuito, sem chave, uso comercial permitido (D010).
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const PORTO_ALEGRE: [number, number] = [-51.2177, -30.0346];

setWorkerUrl(workerUrl);

/** Lê a cor do token CSS: o mapa segue o design system sem cor hard-coded. */
function token(name: string): string {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
  return `rgb(${rgb.split(/\s+/).join(',')})`;
}

function createMap(container: HTMLElement, opts: Partial<MapOptions> = {}): MLMap {
  const map = new MLMap({
    container,
    style: STYLE_URL,
    center: PORTO_ALEGRE,
    zoom: 10,
    attributionControl: { compact: true },
    // necessário para o mapa sair na impressão/PDF
    canvasContextAttributes: { preserveDrawingBuffer: true },
    ...opts,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  return map;
}

export function OpportunitiesMap({
  points,
  selectedId,
  onSelect,
  className,
}: OpportunitiesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    const map = createMap(containerRef.current!, { cooperativeGestures: false });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('opps', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'opps-halo',
        type: 'circle',
        source: 'opps',
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 14, 0],
          'circle-color': token('accent'),
          'circle-opacity': 0.5,
        },
      });
      map.addLayer({
        id: 'opps',
        type: 'circle',
        source: 'opps',
        paint: {
          'circle-radius': 8,
          'circle-color': token('primary'),
          'circle-stroke-width': 2,
          'circle-stroke-color': token('surface'),
        },
      });
      map.on('click', 'opps', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current?.(id);
      });
      map.on('mouseenter', 'opps', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'opps', () => (map.getCanvas().style.cursor = ''));
      setReady(true);
    });
    return () => {
      setReady(false);
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('opps') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { id: p.id, label: p.label, selected: p.id === selectedId },
      })),
    });
  }, [points, selectedId, ready]);

  // Enquadra ao mudar o conjunto filtrado (não ao selecionar). No celular o mapa pode estar
  // escondido (aba Lista, tamanho zero): aí o enquadramento fica pendente até ele aparecer.
  useEffect(() => {
    const map = mapRef.current;
    const b = boundsOf(points);
    if (!map || !ready || !b) return;
    const fit = () => {
      // O container pode ter mudado de tamanho desde a criação (layout/abas): sincroniza antes.
      map.resize();
      map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 0 });
    };
    if (map.getContainer().clientWidth > 0) {
      fit();
      return;
    }
    const onResize = () => {
      if (map.getContainer().clientWidth === 0) return;
      map.off('resize', onResize);
      fit();
    };
    map.on('resize', onResize);
    return () => {
      map.off('resize', onResize);
    };
  }, [points, ready]);

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full', className)}
      role="region"
      aria-label="Mapa de oportunidades"
    />
  );
}

export function ApproxLocationMap({ lat, lng, radiusM, className }: ApproxLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const circle = circlePolygon(lat, lng, radiusM);
    const map = createMap(containerRef.current!, {
      center: [lng, lat],
      zoom: 13.5,
      cooperativeGestures: true,
    });
    map.on('load', () => {
      map.addSource('approx', {
        type: 'geojson',
        data: { type: 'Feature', geometry: circle, properties: {} },
      });
      map.addLayer({
        id: 'approx-fill',
        type: 'fill',
        source: 'approx',
        paint: { 'fill-color': token('action'), 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'approx-line',
        type: 'line',
        source: 'approx',
        paint: { 'line-color': token('action'), 'line-width': 2, 'line-dasharray': [2, 2] },
      });
      const b = boundsOf(circle.coordinates[0].map(([x, y]) => ({ lng: x, lat: y })))!;
      map.fitBounds(b, { padding: 32, duration: 0 });
    });
    return () => map.remove();
  }, [lat, lng, radiusM]);

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full', className)}
      role="img"
      aria-label="Localização aproximada"
    />
  );
}

function coordsOf(g: Geometry | null): LngLat[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates as LngLat];
  if (g.type === 'Polygon') return g.coordinates.flat() as LngLat[];
  if (g.type === 'MultiPolygon') return g.coordinates.flat(2) as LngLat[];
  return [];
}

export function GeometryEditorMap({
  geometry,
  draft,
  onMapClick,
  className,
}: GeometryEditorMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const onClickRef = useRef(onMapClick);
  useEffect(() => {
    onClickRef.current = onMapClick;
  });

  useEffect(() => {
    const map = createMap(containerRef.current!, { cooperativeGestures: true });
    mapRef.current = map;
    map.on('load', () => {
      const empty = { type: 'FeatureCollection' as const, features: [] };
      map.addSource('saved', { type: 'geojson', data: empty });
      map.addSource('draft', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'saved-fill',
        type: 'fill',
        source: 'saved',
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'fill-color': token('primary'), 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: 'saved-line',
        type: 'line',
        source: 'saved',
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'line-color': token('primary'), 'line-width': 2 },
      });
      map.addLayer({
        id: 'saved-point',
        type: 'circle',
        source: 'saved',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 7, 'circle-color': token('primary') },
      });
      map.addLayer({
        id: 'draft-line',
        type: 'line',
        source: 'draft',
        paint: { 'line-color': token('action'), 'line-width': 2, 'line-dasharray': [2, 1] },
      });
      map.addLayer({
        id: 'draft-vertex',
        type: 'circle',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': token('action'),
          'circle-stroke-width': 2,
          'circle-stroke-color': token('surface'),
        },
      });
      map.on('click', (e) => onClickRef.current?.([e.lngLat.lng, e.lngLat.lat]));
      setReady(true);
    });
    return () => {
      setReady(false);
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('saved') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: geometry ? [{ type: 'Feature', geometry, properties: {} }] : [],
    });
    const b = boundsOf(coordsOf(geometry).map(([lng, lat]) => ({ lng, lat })));
    if (b) map.fitBounds(b, { padding: 48, maxZoom: 17, duration: 0 });
  }, [geometry, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const ring = draft.length >= 3 ? [...draft, draft[0]] : draft;
    (map.getSource('draft') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [
        ...draft.map((c) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: c },
          properties: {},
        })),
        ...(ring.length >= 2
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: ring },
                properties: {},
              },
            ]
          : []),
      ],
    });
  }, [draft, ready]);

  return (
    <div
      ref={containerRef}
      className={cn('h-full w-full', onMapClick && '[&_canvas]:cursor-crosshair', className)}
      role="region"
      aria-label="Mapa da localização exata"
    />
  );
}
