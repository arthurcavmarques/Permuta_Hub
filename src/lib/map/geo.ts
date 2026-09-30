import type { Polygon } from 'geojson';

/** Círculo geodésico aproximado (suficiente para raios de centenas de metros). */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 64): Polygon {
  const earth = 6_371_000;
  const dLat = (radiusM / earth) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

export function boundsOf(
  points: Array<{ lat: number; lng: number }>,
): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let [minLng, minLat, maxLng, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
