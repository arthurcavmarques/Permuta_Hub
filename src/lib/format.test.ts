import {
  estimatedPotential,
  formatArea,
  formatCoefficient,
  paymentSplit,
  valuePerUnit,
} from './format';

describe('format', () => {
  it('área em m² com separador brasileiro', () => {
    expect(formatArea(12400)).toBe('12.400 m²');
  });
  it('gleba grande em hectares', () => {
    expect(formatArea(142000)).toBe('14,2 ha');
  });
  it('nulos viram null (a UI mostra "não informado")', () => {
    expect(formatArea(null)).toBeNull();
    expect(formatCoefficient(undefined)).toBeNull();
  });
  it('potencial = área × coeficiente', () => {
    expect(estimatedPotential(3200, 2.4)).toBe(7680);
    expect(estimatedPotential(3200, null)).toBeNull();
  });
  it('valor por unidade do estudo (referência: R$ 10 mi ÷ 1.400)', () => {
    expect(valuePerUnit(10_000_000, 1400)).toBe(7143);
    expect(valuePerUnit(null, 1400)).toBeNull();
    expect(valuePerUnit(10_000_000, null)).toBeNull();
  });
  it('divisão dinheiro × permuta', () => {
    expect(paymentSplit(10_000_000, 40)).toEqual({
      cashPct: 40,
      swapPct: 60,
      cash: 4_000_000,
      swap: 6_000_000,
    });
    expect(paymentSplit(null, 100)).toEqual({ cashPct: 100, swapPct: 0, cash: null, swap: null });
    expect(paymentSplit(10_000_000, null)).toBeNull();
  });
});
