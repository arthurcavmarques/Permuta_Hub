import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('usa ponto e vírgula, BOM e escapa aspas, separador e quebra de linha', () => {
    const csv = toCsv([
      { a: 'simples', b: 'com;ponto', c: 'diz "oi"' },
      { a: null, b: 'linha\nnova', c: 3 },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'a;b;c',
      'simples;"com;ponto";"diz ""oi"""',
      ';"linha\nnova";3',
    ]);
  });

  it('sem linhas, vazio', () => {
    expect(toCsv([])).toBe('');
  });
});
