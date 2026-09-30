/**
 * Importa geometrias do Google Earth (KML/KMZ) e vincula às oportunidades pelo número do MD
 * encontrado no nome/descrição do marcador. O que não vincula vai para um GeoJSON de revisão manual.
 *
 * Uso: npm run import:kml -- <arquivo.kml|kmz> [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { FeatureCollection } from 'geojson';
import mapping from './mappings/landbank.json';
import { adminClient, fail, parseArgs, saveReport } from './lib/cli';
import { groupByMemorial, kmlTextFromFile, parseKml, type KmlFeature } from './lib/kml';

function toFeatureCollection(features: Array<KmlFeature & { reason: string }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { name: f.name, description: f.description, reason: f.reason },
    })),
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file) fail('Informe o arquivo: npm run import:kml -- data/areas.kmz [--dry-run]');
  const dryRun = flags['dry-run'] === true;

  const features = parseKml(await kmlTextFromFile(await readFile(file), basename(file)));
  const { linked, unlinked } = groupByMemorial(
    features,
    mapping.memorial_prefix,
    mapping.memorial_pad,
  );
  const pending: Array<KmlFeature & { reason: string }> = unlinked.map((f) => ({
    ...f,
    reason: 'nome/descrição sem número de MD',
  }));
  const updated: string[] = [];

  if (!dryRun) {
    const db = adminClient();
    for (const [memorial, feats] of linked) {
      const { data, error } = await db.rpc('set_opportunity_geometry', {
        p_memorial_number: memorial,
        p_geometries: feats.map((f) => f.geometry),
      });
      if (error) fail(`Erro ao gravar ${memorial}: ${error.message}`);
      if (data) updated.push(memorial);
      else
        feats.forEach((f) =>
          pending.push({
            ...f,
            reason: `${memorial} não existe no banco (importe o Land Bank antes)`,
          }),
        );
    }
  }

  let pendingPath: string | null = null;
  if (pending.length) {
    pendingPath = await saveReport('kml-nao-vinculados', toFeatureCollection(pending), 'geojson');
  }
  const reportPath = await saveReport('kml', {
    file,
    dry_run: dryRun,
    features: features.length,
    linked_memorials: [...linked.keys()],
    updated,
    pending: pending.map((p) => ({
      name: p.name,
      reason: p.reason,
      geometry_type: p.geometry.type,
    })),
    pending_geojson: pendingPath,
  });

  console.log(
    `\n${dryRun ? '[SIMULAÇÃO — nada gravado] ' : ''}${features.length} feições lidas de ${file}`,
  );
  console.log(
    `  vinculadas a MD: ${linked.size}${dryRun ? '' : `  (gravadas: ${updated.length})`}`,
  );
  console.log(`  pendentes de vínculo manual: ${pending.length}`);
  for (const p of pending) console.log(`  ? "${p.name ?? '(sem nome)'}": ${p.reason}`);
  if (pendingPath) console.log(`\nPendentes (abra no Google Earth/geojson.io): ${pendingPath}`);
  console.log(`Relatório: ${reportPath}\n`);
}

main().catch((e: Error) => fail(e.message));
