import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { pickAreaGeometry } from './kml';

describe('pickAreaGeometry', () => {
  const square = [
    [-51.2, -30.0, 10],
    [-51.19, -30.0, 10],
    [-51.19, -30.01, 10],
    [-51.2, -30.0, 10],
  ];

  it('polígono do lote vence o marcador e perde o Z', () => {
    const g = pickAreaGeometry([
      { type: 'Point', coordinates: [-51.2, -30.0] },
      { type: 'Polygon', coordinates: [square] },
    ]);
    expect(g.type).toBe('Polygon');
    expect((g as Polygon).coordinates[0][0]).toEqual([-51.2, -30.0]);
  });

  it('vários polígonos viram MultiPolygon', () => {
    const g = pickAreaGeometry([
      { type: 'Polygon', coordinates: [square] },
      { type: 'GeometryCollection', geometries: [{ type: 'Polygon', coordinates: [square] }] },
    ]);
    expect(g.type).toBe('MultiPolygon');
  });

  it('sem polígono usa o primeiro ponto; sem nada, erro', () => {
    expect(pickAreaGeometry([{ type: 'Point', coordinates: [-51, -30, 5] }])).toEqual({
      type: 'Point',
      coordinates: [-51, -30],
    });
    expect(() => pickAreaGeometry([{ type: 'LineString', coordinates: [] }])).toThrow();
  });
});
