/** Remove acentos, caixa e pontuação; colapsa espaços. Usado para comparar cabeçalhos e valores. */
export function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[º°ª]/g, '')
    .replace(/m²/g, 'm2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Texto limpo: sem espaços duplicados/invisíveis; vazio vira null. */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[\u00a0\u200b\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' || s === '-' || s === '—' ? null : s;
}

/**
 * Número em formato brasileiro ou internacional. Aceita "12.400,50 m²", "12400", "1,5 ha" (→ m²),
 * "R$ 1.200.000,00". Pontos sozinhos em grupos de 3 são milhar ("12.400" = 12400).
 */
export function parseNumberBR(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = cleanText(value);
  if (!raw) return null;
  const lower = normalizeKey(raw);
  const isHectare = /\b(ha|hectare|hectares)\b/.test(lower);
  const match = raw.match(/-?\d[\d.,]*/);
  if (!match) return null;
  let n = match[0].replace(/[.,]$/, '');
  const hasDot = n.includes('.');
  const hasComma = n.includes(',');
  if (hasDot && hasComma) {
    // O último separador é o decimal.
    n =
      n.lastIndexOf(',') > n.lastIndexOf('.')
        ? n.replace(/\./g, '').replace(',', '.')
        : n.replace(/,/g, '');
  } else if (hasComma) {
    // Planilha brasileira: vírgula sozinha é sempre decimal ("1,500" = 1,5).
    n = n.replace(',', '.');
  } else if (hasDot) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '');
  }
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return isHectare ? num * 10_000 : num;
}

/** Divide listas escritas à mão: "Alfa; Beta / Gama, Delta" → ["Alfa","Beta","Gama","Delta"]. */
export function splitList(value: unknown): string[] {
  const s = cleanText(value);
  if (!s) return [];
  const seen = new Set<string>();
  return s
    .split(/[;\n/|]|,(?!\d)/)
    .map((x) => cleanText(x))
    .filter((x): x is string => !!x)
    .filter((x) => {
      const k = normalizeKey(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
