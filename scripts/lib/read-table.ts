import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import type { Cell } from './landbank';

/** CSV exportado do Excel brasileiro costuma vir em Windows-1252; tenta UTF-8 primeiro. */
export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\ufeff/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export function parseCsv(text: string): Cell[][] {
  // delimitador automático: Excel BR usa ";", outros ","
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: '' });
  return parsed.data;
}

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result as ExcelJS.CellValue); // fórmula
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text); // hyperlink
    if ('error' in value) return null;
  }
  return String(value);
}

export async function readTable(path: string, sheetName?: string): Promise<Cell[][]> {
  const ext = extname(path).toLowerCase();
  const buf = await readFile(path);
  if (ext === '.csv' || ext === '.txt') return parseCsv(decodeText(buf));
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws)
      throw new Error(
        `Aba "${sheetName}" não encontrada. Abas: ${wb.worksheets.map((w) => w.name).join(', ')}`,
      );
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values: Cell[] = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(cellValue(row.getCell(c).value));
      rows[n - 1] = values;
    });
    return Array.from(rows, (r) => r ?? []);
  }
  throw new Error(`Formato não suportado: ${ext}. Use .csv ou .xlsx (salve .xls como .xlsx).`);
}
