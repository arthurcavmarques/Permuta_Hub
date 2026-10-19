/** Normaliza nome para comparação: sem acento, caixa, pontuação e espaços extras. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Semelhança 0–1 entre dois nomes (trigramas, como o pg_trgm do banco). Só orienta a curadoria na tela:
 * o valor gravado é o do banco (name_match_score).
 */
export function nameMatch(a: string | null, b: string | null): number | null {
  if (!a?.trim() || !b?.trim()) return null;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (const w of normalizeName(s).split(' ')) {
      const p = `  ${w} `;
      for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    }
    return set;
  };
  const x = grams(a);
  const y = grams(b);
  let common = 0;
  x.forEach((g) => {
    if (y.has(g)) common++;
  });
  return common / (x.size + y.size - common);
}
