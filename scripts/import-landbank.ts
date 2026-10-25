/**
 * Importa a planilha do Land Bank (CSV/XLSX) pela mesma função do banco usada na tela (import_landbank):
 * prévia sem gravar, mesclagem a três vias (edição manual não é sobrescrita; conflito no relatório),
 * lote append-only que pode ser desfeito pela tela. Idempotente pelo número do MD.
 *
 * Uso: npm run import:landbank -- <arquivo> [--sheet=Nome] [--mapping=caminho.json] [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { adminClient, fail, parseArgs, saveReport } from './lib/cli';
import { parseLandbank, type LandbankMapping } from '../src/lib/import/landbank';
import { readTableBytes, sha256Hex } from '../src/lib/import/table';

interface RowResult {
  line: number;
  memorial_number: string;
  action: string;
  changes: Array<{ field: string }>;
  conflicts: Array<{ field: string }>;
  warnings: string[];
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file) fail('Informe o arquivo: npm run import:landbank -- data/landbank.xlsx [--dry-run]');
  const dryRun = flags['dry-run'] === true;
  const mappingPath = resolve(
    typeof flags.mapping === 'string' ? flags.mapping : 'scripts/mappings/landbank.json',
  );
  const mapping = JSON.parse(await readFile(mappingPath, 'utf-8')) as LandbankMapping;

  const bytes = new Uint8Array(await readFile(file));
  const table = await readTableBytes(
    bytes,
    basename(file),
    typeof flags.sheet === 'string' ? flags.sheet : undefined,
  );
  const parsed = parseLandbank(table.rows, mapping);

  console.log(`\nArquivo: ${file}${table.sheet ? ` (aba ${table.sheet})` : ''}`);
  console.log(`Cabeçalho na linha ${parsed.headerLine}. Colunas reconhecidas:`);
  for (const [field, header] of Object.entries(parsed.recognizedColumns))
    console.log(`  ${header} → ${field}`);
  if (parsed.unrecognizedColumns.length) {
    console.log(`Colunas ignoradas (sem mapeamento): ${parsed.unrecognizedColumns.join(', ')}`);
  }

  const parseReport = {
    header_line: parsed.headerLine,
    recognized_columns: parsed.recognizedColumns,
    unrecognized_columns: parsed.unrecognizedColumns,
    ignored: parsed.ignored,
    rejected: parsed.rejected,
  };
  const { data, error } = await adminClient().rpc('import_landbank', {
    p_file_name: basename(file),
    p_file_sha256: await sha256Hex(bytes),
    p_mapping: mapping,
    p_rows: parsed.valid,
    p_parse_report: parseReport,
    p_dry_run: dryRun,
  });
  if (error) fail(`Erro no banco: ${error.message}`);
  const result = data as {
    batch_id: string | null;
    counts: Record<string, number>;
    rows: RowResult[];
    already_imported_batch_id: string | null;
  };
  const path = await saveReport('landbank', { file, dry_run: dryRun, ...parseReport, ...result });

  const c = result.counts;
  console.log(`\n${dryRun ? '[PRÉVIA — nada gravado] ' : `Lote ${result.batch_id} `}Resultado:`);
  console.log(`  novas: ${c.inserted}   atualizadas: ${c.updated}   inalteradas: ${c.unchanged}`);
  console.log(`  com conflito: ${c.conflict_rows}   status rebaixado: ${c.status_capped}`);
  console.log(`  ignoradas: ${c.ignored}   rejeitadas: ${c.rejected}`);
  if (result.already_imported_batch_id)
    console.log(`  ! este arquivo já foi importado no lote ${result.already_imported_batch_id}`);
  for (const r of parsed.rejected)
    console.log(
      `  ✖ linha ${r.line}${r.memorial_number ? ` (${r.memorial_number})` : ''}: ${r.reason}`,
    );
  for (const r of result.rows.filter((x) => x.conflicts.length))
    console.log(
      `  ⚠ ${r.memorial_number}: conflito em ${r.conflicts.map((x) => x.field).join(', ')}`,
    );
  for (const r of result.rows.filter((x) => x.warnings.length))
    console.log(`  ! linha ${r.line} (${r.memorial_number}): ${r.warnings.join('; ')}`);
  console.log(`\nRelatório completo: ${path}\n`);
}

main().catch((e: Error) => fail(e.message));
