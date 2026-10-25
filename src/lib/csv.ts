/** CSV com ";" e BOM: abre certo no Excel em pt-BR. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    '﻿' +
    [headers, ...rows.map((r) => headers.map((h) => r[h]))]
      .map((l) => l.map(cell).join(';'))
      .join('\r\n')
  );
}
