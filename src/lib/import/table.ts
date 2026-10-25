import Papa from 'papaparse';
import type ExcelJS from 'exceljs';
import type { Cell } from './landbank';

/** CSV exportado do Excel brasileiro costuma vir em Windows-1252; tenta UTF-8 primeiro. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
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

export interface Table {
  rows: Cell[][];
  /** Abas do arquivo (XLSX); vazio para CSV. */
  sheets: string[];
  sheet: string | null;
}

function extension(fileName: string) {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i).toLowerCase();
}

/** Lê CSV/XLSX a partir dos bytes (navegador e scripts). O ExcelJS só é carregado quando o arquivo é XLSX. */
export async function readTableBytes(
  bytes: Uint8Array,
  fileName: string,
  sheetName?: string,
): Promise<Table> {
  const ext = extension(fileName);
  if (ext === '.csv' || ext === '.txt')
    return { rows: parseCsv(decodeText(bytes)), sheets: [], sheet: null };
  if (ext === '.xlsx') {
    const { default: Excel } = await import('exceljs');
    const wb = new Excel.Workbook();
    await wb.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const sheets = wb.worksheets.map((w) => w.name);
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) throw new Error(`Aba "${sheetName}" não encontrada. Abas: ${sheets.join(', ')}`);
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values: Cell[] = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(cellValue(row.getCell(c).value));
      rows[n - 1] = values;
    });
    return { rows: Array.from(rows, (r) => r ?? []), sheets, sheet: ws.name };
  }
  throw new Error(
    `Formato não suportado: ${ext || 'sem extensão'}. Use .csv ou .xlsx (salve .xls como .xlsx).`,
  );
}

/** SHA-256 do arquivo (identifica o arquivo no lote e avisa reimportação). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
