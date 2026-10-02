import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { groupByMemorial, kmlTextFromFile, memorialFromFeature, parseKml } from './kml';

const kmlText = readFileSync(resolve(import.meta.dirname, '../fixtures/exemplo.kml'), 'utf-8');

describe('parseKml', () => {
  it('extrai polígonos e pontos como GeoJSON', () => {
    const features = parseKml(kmlText);
    expect(features).toHaveLength(3);
    expect(features[0].geometry.type).toBe('Polygon');
    expect(features[1].geometry.type).toBe('Point');
  });

  it('vincula por número do MD e lista os não vinculados', () => {
    const { linked, unlinked } = groupByMemorial(parseKml(kmlText));
    expect([...linked.keys()]).toEqual(['MD-042', 'MD-043']);
    expect(unlinked.map((f) => f.name)).toEqual(['Terreno do seu João']);
  });

  it('lê KMZ (zip com doc.kml)', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', kmlText);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    expect(parseKml(await kmlTextFromFile(buf, 'areas.KMZ'))).toHaveLength(3);
  });
});

describe('memorialFromFeature', () => {
  const geometry = { type: 'Point' as const, coordinates: [0, 0] };
  it.each([
    ['MD 42 - Petrópolis', 'MD-042'],
    ['Memorial descritivo nº 7', 'MD-007'],
    ['042', 'MD-042'],
    ['Área do Cristal', null],
  ])('%s → %s', (name, expected) => {
    expect(memorialFromFeature({ name, description: null, geometry })).toBe(expected);
  });
});
