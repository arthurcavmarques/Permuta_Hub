import { normalizeKey, parseNumberBR, splitList } from './text';

describe('parseNumberBR', () => {
  it.each([
    ['12.400,50', 12400.5],
    ['12.400', 12400],
    ['12400', 12400],
    ['1.234.567', 1234567],
    ['3,5', 3.5],
    ['1,5 ha', 15000],
    ['2 hectares', 20000],
    ['R$ 1.200.000,00', 1200000],
    ['12,400.75', 12400.75],
    ['2.4', 2.4],
    [' 800 m² ', 800],
    [1500, 1500],
  ])('%s → %s', (input, expected) => {
    expect(parseNumberBR(input)).toBe(expected);
  });

  it.each([null, '', 'abc', '-', undefined])('%s → null', (input) => {
    expect(parseNumberBR(input)).toBeNull();
  });
});

describe('normalizeKey', () => {
  it('remove acentos, caixa e pontuação', () => {
    expect(normalizeKey('  Nº MD ')).toBe('n md');
    expect(normalizeKey('Área (m²)')).toBe('area m2');
    expect(normalizeKey('Status da Negociação')).toBe('status da negociacao');
  });
});

describe('splitList', () => {
  it('divide por ; / e vírgula, sem duplicar', () => {
    expect(splitList('Construtora Alfa; Incorporadora Beta / construtora ALFA')).toEqual([
      'Construtora Alfa',
      'Incorporadora Beta',
    ]);
  });
});
