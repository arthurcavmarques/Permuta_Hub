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

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export function formatMoney(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : brl.format(v);
}

/** Valor da área por unidade do estudo (ex.: R$ 10 mi ÷ 1.400 = R$ 7.143). */
export function valuePerUnit(value: number | null, units: number | null): number | null {
  return value !== null && units ? Math.round(value / units) : null;
}

/** Divisão do valor pretendido entre dinheiro e permuta, a partir da parte em dinheiro (%). */
export function paymentSplit(
  value: number | null,
  cashPct: number | null,
): { cashPct: number; swapPct: number; cash: number | null; swap: number | null } | null {
  if (cashPct === null) return null;
  const swapPct = Math.round((100 - cashPct) * 100) / 100;
  return {
    cashPct,
    swapPct,
    cash: value === null ? null : Math.round((value * cashPct) / 100),
    swap: value === null ? null : Math.round((value * swapPct) / 100),
  };
}
