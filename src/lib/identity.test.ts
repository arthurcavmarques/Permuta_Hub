import { normalizeBrazilianPhone } from './identity';

describe('normalizeBrazilianPhone', () => {
  it.each([
    ['(51) 99999-0000', '+5551999990000'],
    ['51999990000', '+5551999990000'],
    ['+55 51 99999-0000', '+5551999990000'],
    ['(51) 3333-4444', '+555133334444'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBrazilianPhone(input)).toBe(expected);
  });

  it.each(['', '99999-0000', '(01) 99999-0000', '51 8999-00000', '5199999000011', 'abc'])(
    '"%s" é inválido',
    (input) => {
      expect(normalizeBrazilianPhone(input)).toBeNull();
    },
  );
});
