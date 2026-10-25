import mappingJson from '../../../scripts/mappings/buyers.json';
import { parseBuyers, type BuyersMapping } from './buyers';

const mapping = mappingJson as unknown as BuyersMapping;

describe('parseBuyers', () => {
  const r = parseBuyers(
    [
      ['BASE DE COMPRADORES (FICTÍCIA)'],
      [],
      ['Empresa', 'CNPJ', 'Contato', 'Celular', 'E-mail', 'Coluna X'],
      [
        'Incorporadora Ômega',
        '11.222.333/0001-81',
        'Ana',
        '(51) 90000-0000',
        'ANA@OMEGA.invalid',
        'x',
      ],
      ['Construtora Sem CNPJ', '123', null, null, 'nao-e-email', null],
      [null, '11.222.333/0001-81', 'Sem empresa', null, null, null],
      [],
    ],
    mapping,
  );

  it('acha o cabeçalho e as colunas', () => {
    expect(r.headerLine).toBe(3);
    expect(r.recognizedColumns.email).toBe('E-mail');
    expect(r.unrecognizedColumns).toContain('Coluna X');
  });

  it('normaliza CNPJ e e-mail; inválidos viram aviso, não erro', () => {
    expect(r.valid[0]).toMatchObject({
      cnpj: '11222333000181',
      email: 'ana@omega.invalid',
      warnings: [],
    });
    expect(r.valid[1]).toMatchObject({ cnpj: null, email: null });
    expect(r.valid[1].warnings).toHaveLength(2);
  });

  it('sem empresa é rejeitado; linha vazia, ignorada', () => {
    expect(r.rejected).toEqual([{ line: 6, reason: 'sem nome da empresa' }]);
    expect(r.ignored).toEqual([{ line: 7, reason: 'linha vazia' }]);
  });
});
