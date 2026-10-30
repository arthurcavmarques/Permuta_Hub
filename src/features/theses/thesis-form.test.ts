import { emptyThesisForm, formToThesis, parseNumber, thesisToForm } from './thesis-form';

describe('tese: formulário ↔ banco', () => {
  it('números brasileiros: milhar com ponto e decimal com vírgula', () => {
    expect(parseNumber('1.200.000')).toBe(1_200_000);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('15000')).toBe(15000);
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
  });

  it('listas separadas por vírgula e UF em maiúsculas; vazio = sem restrição', () => {
    const r = formToThesis(
      {
        ...emptyThesisForm(),
        name: ' Vertical POA ',
        states: 'rs, sc',
        cities: 'Porto Alegre, , Canoas',
        min_area_m2: '2.000',
        max_area_m2: '15000',
      },
      'org-1',
    );
    expect('input' in r).toBe(true);
    if (!('input' in r)) return;
    expect(r.input).toMatchObject({
      organization_id: 'org-1',
      name: 'Vertical POA',
      states: ['RS', 'SC'],
      cities: ['Porto Alegre', 'Canoas'],
      region_tags: [],
      min_area_m2: 2000,
      max_area_m2: 15000,
      min_ticket: null,
      notes: null,
    });
  });

  it('mínimo maior que máximo e número inválido viram erro de campo', () => {
    const r = formToThesis(
      {
        ...emptyThesisForm(),
        name: 'X',
        min_area_m2: '9000',
        max_area_m2: '100',
        min_ticket: 'dez',
      },
      'org-1',
    );
    expect(r).toEqual({ errors: { name: 'name', max_area_m2: 'range', min_ticket: 'number' } });
  });

  it('ida e volta preserva a tese', () => {
    const form = {
      ...emptyThesisForm(),
      name: 'Glebas',
      asset_types: ['gleba'],
      zonings: 'Mista, Residencial',
      min_coefficient: '1.5',
      negotiation_models: ['swap' as const],
    };
    const r = formToThesis(form, 'org-2');
    if (!('input' in r)) throw new Error('esperava input');
    const back = thesisToForm({ ...r.input, id: 't', updated_at: '' });
    expect(back).toMatchObject({
      name: 'Glebas',
      zonings: 'Mista, Residencial',
      min_coefficient: '1.5',
    });
  });
});
