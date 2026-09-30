const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatArea(m2: number | null | undefined): string | null {
  if (m2 === null || m2 === undefined) return null;
  // Acima de 10 ha, hectare comunica melhor para gleba.
  if (m2 >= 100_000) return `${decFmt.format(m2 / 10_000)} ha`;
  return `${intFmt.format(m2)} m²`;
}

export function formatCoefficient(c: number | null | undefined): string | null {
  return c === null || c === undefined ? null : decFmt.format(c);
}

export function formatMoneyCompact(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : brlCompact.format(v);
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Potencial construtivo estimado = área × coeficiente (quando ambos existem). */
export function estimatedPotential(area: number | null, coef: number | null): number | null {
  return area !== null && coef !== null ? Math.round(area * coef) : null;
}
