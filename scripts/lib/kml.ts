import { DOMParser } from '@xmldom/xmldom';
import { kml } from '@tmcw/togeojson';
import JSZip from 'jszip';
import type { Feature, Geometry } from 'geojson';
import { normalizeMemorial } from './landbank';
import { cleanText } from './text';

export interface KmlFeature {
  name: string | null;
  description: string | null;
  geometry: Geometry;
}

export async function kmlTextFromFile(buf: Buffer, filename: string): Promise<string> {
  if (!filename.toLowerCase().endsWith('.kmz')) return buf.toString('utf-8');
  const zip = await JSZip.loadAsync(buf);
  // O Google Earth grava doc.kml; aceita qualquer .kml na raiz como alternativa.
  const entry = zip.file('doc.kml') ?? zip.file(/\.kml$/i)[0];
  if (!entry) throw new Error('KMZ sem arquivo .kml dentro');
  return entry.async('string');
}

export function parseKml(text: string): KmlFeature[] {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const fc = kml(doc as unknown as Document);
  return (fc.features as Feature[])
    .filter((f): f is Feature<Geometry> => !!f.geometry)
    .map((f) => ({
      name: cleanText(f.properties?.name),
      description: cleanText(f.properties?.description),
      geometry: f.geometry,
    }));
}

/**
 * Descobre o número do MD no nome (ou descrição) do marcador: "MD 42 - Petrópolis", "042", "Memorial 42".
 * Retorna null quando não há como vincular com segurança (vai para a lista de não vinculados).
 */
export function memorialFromFeature(f: KmlFeature, prefix = 'MD-', pad = 3): string | null {
  for (const text of [f.name, f.description]) {
    if (!text) continue;
    const m =
      text.match(/\b(?:MD|M\.D\.|memorial(?:\s+descritivo)?)\s*[-.#nº°]*\s*(\d{1,6})\b/i) ??
      text.match(/^\s*(\d{1,6})\b/);
    if (m) return normalizeMemorial(m[1], prefix, pad);
  }
  return null;
}

export function groupByMemorial(features: KmlFeature[], prefix = 'MD-', pad = 3) {
  const linked = new Map<string, KmlFeature[]>();
  const unlinked: KmlFeature[] = [];
  for (const f of features) {
    const md = memorialFromFeature(f, prefix, pad);
    if (md) linked.set(md, [...(linked.get(md) ?? []), f]);
    else unlinked.push(f);
  }
  return { linked, unlinked };
}
