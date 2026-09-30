import { cleanText, normalizeKey, parseNumberBR, splitList } from './text';

export type OpportunityStatus =
  | 'captured'
  | 'qualifying'
  | 'qualified'
  | 'distributing'
  | 'negotiating'
  | 'closed'
  | 'lost'
  | 'archived';
export type NegotiationModel = 'sale' | 'swap' | 'partnership' | 'other';

export interface LandbankMapping {
  memorial_prefix: string;
  memorial_pad: number;
  header_search_rows: number;
  columns: Record<string, string[]>;
  sensitive_fields: string[];
  status_map: Record<string, OpportunityStatus>;
  negotiation_model_map: Record<string, NegotiationModel>;
  defaults: { city: string; state: string; status: OpportunityStatus };
}

export type Cell = string | number | null | undefined;

export interface ParsedOpportunity {
  opportunity: {
    memorial_number: string;
    status: OpportunityStatus;
    land_type: string | null;
    area_m2: number | null;
    city: string;
    neighborhood: string | null;
    state: string;
    zoning: string | null;
    coefficient: number | null;
    asking_value: number | null;
    negotiation_models: NegotiationModel[];
    extra: Record<string, unknown>;
  };
  sensitive: {
    registry_number: string | null;
    exact_address: string | null;
    owner_name: string | null;
    owner_contacts: Record<string, unknown>;
  } | null;
  warnings: string[];
}

export interface RowIssue {
  line: number;
  reason: string;
  memorial_number?: string;
}

export interface LandbankParseResult {
  headerLine: number;
  recognizedColumns: Record<string, string>;
  unrecognizedColumns: string[];
  valid: Array<ParsedOpportunity & { line: number }>;
  ignored: RowIssue[];
  rejected: RowIssue[];
}

/** "42", "md 42", "MD-042", "Md.42" → "MD-042". Outros formatos: só limpa e põe em caixa alta. */
export function normalizeMemorial(value: unknown, prefix = 'MD-', pad = 3): string | null {
  const s = cleanText(value);
  if (!s) return null;
  const compact = s.toUpperCase().replace(/\s+/g, '');
  const m = compact.match(/^(?:M\.?D\.?|MEMORIAL)?[-.#Nº°]*0*(\d+)$/);
  if (m) return prefix + m[1].padStart(pad, '0');
  return compact;
}

/** Acha a linha de cabeçalho: a primeira, entre as N iniciais, que reconhece a coluna do MD e ao menos mais uma. */
export function findHeader(
  rows: Cell[][],
  mapping: LandbankMapping,
): { line: number; index: Record<string, number>; unrecognized: string[] } | null {
  const limit = Math.min(rows.length, mapping.header_search_rows);
  for (let i = 0; i < limit; i++) {
    const index: Record<string, number> = {};
    const unrecognized: string[] = [];
    rows[i].forEach((cell, col) => {
      const key = normalizeKey(cell);
      if (!key) return;
      // Casamento exato primeiro; depois "começa com" para cabeçalhos longos ("Área (m²) aprox.").
      const field =
        Object.keys(mapping.columns).find((f) => mapping.columns[f].includes(key)) ??
        Object.keys(mapping.columns).find((f) =>
          mapping.columns[f].some((alias) => alias.length > 3 && key.startsWith(alias)),
        );
      if (field && index[field] === undefined) index[field] = col;
      else unrecognized.push(String(cell).trim());
    });
    if (index.memorial_number !== undefined && Object.keys(index).length >= 2) {
      return { line: i, index, unrecognized };
    }
  }
  return null;
}

function mapStatus(raw: string | null, mapping: LandbankMapping, warnings: string[]): OpportunityStatus {
  if (!raw) return mapping.defaults.status;
  const key = normalizeKey(raw);
  const hit = mapping.status_map[key] ?? Object.entries(mapping.status_map).find(([k]) => key.includes(k))?.[1];
  if (!hit) {
    warnings.push(`status "${raw}" não mapeado; usado "${mapping.defaults.status}"`);
    return mapping.defaults.status;
  }
  return hit;
}

function mapModels(raw: string | null, mapping: LandbankMapping, warnings: string[]): NegotiationModel[] {
  const out = new Set<NegotiationModel>();
  for (const item of splitList(raw)) {
    const key = normalizeKey(item);
    const hit = Object.entries(mapping.negotiation_model_map).find(([k]) => key.includes(k))?.[1];
    if (hit) out.add(hit);
    else warnings.push(`modelo de negociação "${item}" não mapeado`);
  }
  return [...out];
}

export function parseLandbank(rows: Cell[][], mapping: LandbankMapping): LandbankParseResult {
  const header = findHeader(rows, mapping);
  if (!header) {
    throw new Error(
      'Cabeçalho não encontrado: nenhuma linha reconhece a coluna do número do memorial. ' +
        'Ajuste scripts/mappings/landbank.json.',
    );
  }
  const result: LandbankParseResult = {
    headerLine: header.line + 1,
    recognizedColumns: Object.fromEntries(
      Object.entries(header.index).map(([f, col]) => [f, String(rows[header.line][col]).trim()]),
    ),
    unrecognizedColumns: header.unrecognized,
    valid: [],
    ignored: [],
    rejected: [],
  };
  const seen = new Map<string, number>();

  for (let i = header.line + 1; i < rows.length; i++) {
    const line = i + 1; // numeração da planilha (1-based)
    const row = rows[i] ?? [];
    const get = (field: string): string | null =>
      header.index[field] === undefined ? null : cleanText(row[header.index[field]]);

    if (row.every((c) => cleanText(c) === null)) {
      result.ignored.push({ line, reason: 'linha vazia' });
      continue;
    }

    const memorial = normalizeMemorial(get('memorial_number'), mapping.memorial_prefix, mapping.memorial_pad);
    if (!memorial) {
      result.rejected.push({ line, reason: 'sem número do memorial descritivo' });
      continue;
    }
    if (seen.has(memorial)) {
      result.ignored.push({
        line,
        memorial_number: memorial,
        reason: `duplicado no arquivo (primeira ocorrência na linha ${seen.get(memorial)})`,
      });
      continue;
    }

    const warnings: string[] = [];
    const areaRaw = get('area_m2');
    const area = parseNumberBR(areaRaw);
    if (areaRaw && (area === null || area <= 0)) {
      result.rejected.push({ line, memorial_number: memorial, reason: `área inválida: "${areaRaw}"` });
      continue;
    }
    const coefRaw = get('coefficient');
    const coefficient = parseNumberBR(coefRaw);
    if (coefRaw && coefficient === null) warnings.push(`coeficiente ilegível: "${coefRaw}"`);
    const valueRaw = get('asking_value');
    const askingValue = parseNumberBR(valueRaw);
    if (valueRaw && askingValue === null) warnings.push(`valor ilegível: "${valueRaw}"`);

    const offeredRaw = get('offered_to');
    const offered = splitList(offeredRaw);
    const progress = get('commercial_progress');
    const statusRaw = get('status');

    const extra: Record<string, unknown> = {
      landbank: { imported_at: new Date().toISOString(), line, status_raw: statusRaw, commercial_progress: progress },
    };
    // D006: histórico "oferecida para" preservado até virar distributions (legacy) na Fase 1.
    if (offered.length) extra.legacy_offered_to = { companies: offered, raw: offeredRaw };

    const sensitiveValues = {
      registry_number: get('registry_number'),
      exact_address: get('exact_address'),
      owner_name: get('owner_name'),
      contacts: get('contacts'),
    };
    const hasSensitive = Object.values(sensitiveValues).some((v) => v !== null);

    seen.set(memorial, line);
    result.valid.push({
      line,
      warnings,
      opportunity: {
        memorial_number: memorial,
        status: mapStatus(statusRaw, mapping, warnings),
        land_type: get('land_type'),
        area_m2: area,
        city: get('city') ?? mapping.defaults.city,
        neighborhood: get('neighborhood'),
        state: mapping.defaults.state,
        zoning: get('zoning'),
        coefficient,
        asking_value: askingValue,
        negotiation_models: mapModels(get('negotiation_models'), mapping, warnings),
        extra,
      },
      sensitive: hasSensitive
        ? {
            registry_number: sensitiveValues.registry_number,
            exact_address: sensitiveValues.exact_address,
            owner_name: sensitiveValues.owner_name,
            owner_contacts: sensitiveValues.contacts ? { raw: sensitiveValues.contacts } : {},
          }
        : null,
    });
  }
  return result;
}
