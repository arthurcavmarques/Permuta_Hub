import { estimatedPotential, formatArea, formatCoefficient } from './format';

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
});
