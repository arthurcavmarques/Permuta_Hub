/**
 * Importa a planilha do Land Bank (CSV/XLSX) para opportunities + opportunity_sensitive.
 * Idempotente: a chave é o número do memorial descritivo (reimportar atualiza, não duplica).
 *
 * Uso: npm run import:landbank -- <arquivo> [--sheet=Nome] [--mapping=caminho.json] [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { adminClient, fail, parseArgs, saveReport } from './lib/cli';
import { parseLandbank, type LandbankMapping } from './lib/landbank';
import { readTable } from './lib/read-table';

const BATCH = 200;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file) fail('Informe o arquivo: npm run import:landbank -- data/landbank.xlsx [--dry-run]');
  const dryRun = flags['dry-run'] === true;
  const mappingPath = resolve(typeof flags.mapping === 'string' ? flags.mapping : 'scripts/mappings/landbank.json');
  const mapping = JSON.parse(await readFile(mappingPath, 'utf-8')) as LandbankMapping;

  const rows = await readTable(file, typeof flags.sheet === 'string' ? flags.sheet : undefined);
  const parsed = parseLandbank(rows, mapping);

  console.log(`\nArquivo: ${file}`);
  console.log(`Cabeçalho na linha ${parsed.headerLine}. Colunas reconhecidas:`);
  for (const [field, header] of Object.entries(parsed.recognizedColumns)) console.log(`  ${header} → ${field}`);
  if (parsed.unrecognizedColumns.length) {
    console.log(`Colunas ignoradas (sem mapeamento): ${parsed.unrecognizedColumns.join(', ')}`);
  }

  const imported: Array<{ line: number; memorial_number: string; action: 'inserted' | 'updated'; warnings: string[] }> = [];
  const rejected = [...parsed.rejected];

  if (!dryRun && parsed.valid.length) {
    const db = adminClient();
    for (let i = 0; i < parsed.valid.length; i += BATCH) {
      const chunk = parsed.valid.slice(i, i + BATCH);
      const memorials = chunk.map((v) => v.opportunity.memorial_number);

      // Preserva chaves de `extra` que não vêm da planilha (ex.: edições futuras na plataforma).
      const { data: existing, error: exErr } = await db
        .from('opportunities')
        .select('memorial_number, extra')
        .in('memorial_number', memorials);
      if (exErr) fail(`Erro ao consultar existentes: ${exErr.message}`);
      const existingExtra = new Map(existing!.map((e) => [e.memorial_number as string, e.extra as object]));

      const { data: upserted, error } = await db
        .from('opportunities')
        .upsert(
          chunk.map((v) => ({
            ...v.opportunity,
            extra: { ...(existingExtra.get(v.opportunity.memorial_number) ?? {}), ...v.opportunity.extra },
          })),
          { onConflict: 'memorial_number' },
        )
        .select('id, memorial_number');
      if (error) {
        chunk.forEach((v) =>
          rejected.push({ line: v.line, memorial_number: v.opportunity.memorial_number, reason: `banco: ${error.message}` }),
        );
        continue;
      }
      const idByMemorial = new Map(upserted!.map((u) => [u.memorial_number as string, u.id as string]));

      const sensitiveRows = chunk
        .filter((v) => v.sensitive)
        .map((v) => ({ opportunity_id: idByMemorial.get(v.opportunity.memorial_number), ...v.sensitive }));
      if (sensitiveRows.length) {
        const { error: sErr } = await db.from('opportunity_sensitive').upsert(sensitiveRows, { onConflict: 'opportunity_id' });
        if (sErr) fail(`Erro ao gravar dados sensíveis: ${sErr.message}`);
      }

      chunk.forEach((v) =>
        imported.push({
          line: v.line,
          memorial_number: v.opportunity.memorial_number,
          action: existingExtra.has(v.opportunity.memorial_number) ? 'updated' : 'inserted',
          warnings: v.warnings,
        }),
      );
    }
  }

  const report = {
    file,
    dry_run: dryRun,
    header_line: parsed.headerLine,
    recognized_columns: parsed.recognizedColumns,
    unrecognized_columns: parsed.unrecognizedColumns,
    totals: {
      valid: parsed.valid.length,
      inserted: imported.filter((i) => i.action === 'inserted').length,
      updated: imported.filter((i) => i.action === 'updated').length,
      ignored: parsed.ignored.length,
      rejected: rejected.length,
      with_warnings: parsed.valid.filter((v) => v.warnings.length).length,
    },
    imported: dryRun
      ? parsed.valid.map((v) => ({ line: v.line, memorial_number: v.opportunity.memorial_number, warnings: v.warnings }))
      : imported,
    ignored: parsed.ignored,
    rejected,
  };
  const path = await saveReport('landbank', report);

  const t = report.totals;
  console.log(`\n${dryRun ? '[SIMULAÇÃO — nada gravado] ' : ''}Resultado:`);
  console.log(`  válidas: ${t.valid}  (inseridas: ${t.inserted}, atualizadas: ${t.updated})`);
  console.log(`  ignoradas: ${t.ignored}   rejeitadas: ${t.rejected}   com avisos: ${t.with_warnings}`);
  for (const r of rejected) console.log(`  ✖ linha ${r.line}${r.memorial_number ? ` (${r.memorial_number})` : ''}: ${r.reason}`);
  for (const v of parsed.valid.filter((x) => x.warnings.length)) {
    console.log(`  ! linha ${v.line} (${v.opportunity.memorial_number}): ${v.warnings.join('; ')}`);
  }
  console.log(`\nRelatório completo: ${path}\n`);
}

main().catch((e: Error) => fail(e.message));
