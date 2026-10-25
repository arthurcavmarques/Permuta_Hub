import type { Cell, RowIssue } from './landbank';
import { cleanText, normalizeKey } from './text';

export interface BuyersMapping {
  header_search_rows: number;
  columns: Record<string, string[]>;
}

export interface ParsedBuyer {
  line: number;
  organization_name: string;
  cnpj: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  warnings: string[];
}

export interface BuyersParseResult {
  headerLine: number;
  recognizedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  valid: ParsedBuyer[];
  ignored: RowIssue[];
  rejected: RowIssue[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Base de compradores: chega SEM opt-in (regra 8). Só a curadoria vê; ninguém recebe mensagem por estar aqui. */
export function parseBuyers(rows: Cell[][], mapping: BuyersMapping): BuyersParseResult {
  let header: { line: number; index: Record<string, number>; unrecognized: string[] } | null = null;
  for (let i = 0; i < Math.min(rows.length, mapping.header_search_rows) && !header; i++) {
    const index: Record<string, number> = {};
    const unrecognized: string[] = [];
    rows[i].forEach((cell, col) => {
      const key = normalizeKey(cell);
      if (!key) return;
      const field = Object.keys(mapping.columns).find((f) => mapping.columns[f].includes(key));
      if (field && index[field] === undefined) index[field] = col;
      else unrecognized.push(String(cell).trim());
    });
    if (index.organization_name !== undefined && Object.keys(index).length >= 2) {
      header = { line: i, index, unrecognized };
    }
  }
  if (!header) {
    throw new Error(
      'Cabeçalho não encontrado: nenhuma linha reconhece a coluna da empresa e mais uma. Ajuste o mapeamento.',
    );
  }
  const h = header;
  const result: BuyersParseResult = {
    headerLine: h.line + 1,
    recognizedColumns: Object.fromEntries(
      Object.entries(h.index).map(([f, col]) => [f, String(rows[h.line][col]).trim()]),
    ),
    unrecognizedColumns: h.unrecognized,
    valid: [],
    ignored: [],
    rejected: [],
  };
  for (let i = h.line + 1; i < rows.length; i++) {
    const line = i + 1;
    const row = rows[i] ?? [];
    const get = (field: string) =>
      h.index[field] === undefined ? null : cleanText(row[h.index[field]]);
    if (row.every((c) => cleanText(c) === null)) {
      result.ignored.push({ line, reason: 'linha vazia' });
      continue;
    }
    const org = get('organization_name');
    if (!org) {
      result.rejected.push({ line, reason: 'sem nome da empresa' });
      continue;
    }
    const warnings: string[] = [];
    let cnpj = get('cnpj');
    if (cnpj) {
      const digits = cnpj.replace(/\D/g, '');
      if (digits.length !== 14) {
        warnings.push('CNPJ com número de dígitos errado; ignorado');
        cnpj = null;
      } else cnpj = digits;
    }
    let email = get('email');
    if (email && !EMAIL.test(email)) {
      warnings.push('e-mail inválido; ignorado');
      email = null;
    }
    result.valid.push({
      line,
      organization_name: org,
      cnpj,
      contact_name: get('contact_name'),
      phone: get('phone'),
      email: email?.toLowerCase() ?? null,
      notes: get('notes'),
      warnings,
    });
  }
  return result;
}
