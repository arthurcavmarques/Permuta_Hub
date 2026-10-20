import { describe, expect, it } from 'vitest';
import { nameMatch, normalizeName } from './names';

describe('nomes', () => {
  it('normaliza acento, caixa e pontuação', () => {
    expect(normalizeName('  José  da Silva-Júnior ')).toBe('jose da silva junior');
  });
  it('mesmo nome com grafia diferente casa; nome diferente não', () => {
    expect(nameMatch('JOSE DA SILVA', 'José da Silva')).toBe(1);
    expect(nameMatch('Maria Oliveira', 'José da Silva')!).toBeLessThan(0.3);
    expect(nameMatch('', 'x')).toBeNull();
  });
});
