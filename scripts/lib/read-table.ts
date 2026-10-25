import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Cell } from '../../src/lib/import/landbank';
import { readTableBytes } from '../../src/lib/import/table';

/** Lê CSV/XLSX do disco com o mesmo leitor da tela de importação. */
export async function readTable(path: string, sheetName?: string): Promise<Cell[][]> {
  const bytes = new Uint8Array(await readFile(path));
  return (await readTableBytes(bytes, basename(path), sheetName)).rows;
}
