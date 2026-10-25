import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mappingJson from '../../../scripts/mappings/landbank.json';
import { normalizeMemorial, parseLandbank, type LandbankMapping } from './landbank';
import { decodeText, parseCsv } from './table';

const mapping = mappingJson as unknown as LandbankMapping;
const fixture = () =>
  parseCsv(decodeText(readFileSync(resolve(import.meta.dirname, '../../../scripts/fixtures/landbank-sujo.csv'))));

describe('normalizeMemorial', () => {
  it.each([
    ['42', 'MD-042'],
    ['md 42', 'MD-042'],
    ['MD-042', 'MD-042'],
    ['Md.42', 'MD-042'],
    ['MD 1234', 'MD-1234'],
    ['LOTE-A7', 'LOTE-A7'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeMemorial(input)).toBe(expected);
  });
});

describe('parseLandbank (planilha suja)', () => {
  const r = parseLandbank(fixture(), mapping);

  it('acha o cabeçalho abaixo do título', () => {
    expect(r.headerLine).toBe(3);
    expect(r.unrecognizedColumns).toContain('Coluna Estranha');
  });

  it('importa linhas válidas com número normalizado e metragem BR', () => {
    expect(r.valid.map((v) => v.opportunity.memorial_number)).toEqual([
      'MD-042',
      'MD-043',
      'MD-045',
    ]);
    expect(r.valid[0].opportunity.area_m2).toBe(12400.5);
    expect(r.valid[1].opportunity.area_m2).toBe(15000);
    expect(r.valid[1].opportunity.neighborhood).toBe('Sarandi');
  });

  it('mapeia status, inclusive com acento e texto livre', () => {
    expect(r.valid[0].opportunity.status).toBe('negotiating');
    expect(r.valid[1].opportunity.status).toBe('qualified');
    expect(r.valid[2].opportunity.status).toBeNull(); // não mapeado: o banco usa o padrão só em área nova
    expect(r.valid[2].warnings.join()).toContain('status maluco');
  });

  it('guarda "oferecida para" como histórico legado (D006), sem duplicar empresa', () => {
    expect(r.valid[0].opportunity.extra.legacy_offered_to).toMatchObject({
      companies: ['Construtora Alfa', 'Incorporadora Beta'],
    });
    expect(r.valid[1].opportunity.extra.legacy_offered_to).toBeUndefined();
  });

  it('separa dado sensível do resto', () => {
    expect(r.valid[0].sensitive).toMatchObject({
      owner_name: 'Fulano Fictício',
      owner_contacts: { raw: '(51) 90000-0001' },
    });
    expect(JSON.stringify(r.valid[0].opportunity)).not.toContain('Fulano');
    expect(r.valid[1].sensitive).toBeNull();
  });

  it('relata ignoradas e rejeitadas com motivo', () => {
    expect(r.ignored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 6, reason: expect.stringContaining('duplicado') }),
        expect.objectContaining({ line: 8, reason: 'linha vazia' }),
      ]),
    );
    expect(r.rejected).toEqual([
      { line: 7, reason: 'sem número do memorial descritivo' },
      { line: 9, memorial_number: 'MD-044', reason: 'área inválida: "abc"' },
    ]);
  });

  it('falha com mensagem útil quando não há cabeçalho reconhecível', () => {
    expect(() =>
      parseLandbank(
        [
          ['a', 'b'],
          ['1', '2'],
        ],
        mapping,
      ),
    ).toThrow(/Cabeçalho não encontrado/);
  });
});

describe('decodeText', () => {
  it('lê CSV em Windows-1252 (Excel BR)', () => {
    expect(decodeText(new Uint8Array([0xc1, 0x72, 0x65, 0x61]))).toBe('Área');
  });
});

describe('parseLandbank — regras da Fase 2B', () => {
  const r = parseLandbank(fixture(), mapping);

  it('deduz o tipo de ativo do "tipo de terreno" quando o mapa reconhece (D026)', () => {
    expect(r.valid.map((v) => v.opportunity.asset_type)).toEqual(['terreno', 'gleba', 'terreno']);
  });

  it('não aplica padrões (cidade, UF): o banco aplica só em área nova', () => {
    expect(r.valid[0].opportunity.city).toBeNull();
    expect(r.valid[0].opportunity.state).toBeNull();
  });

  it('extra sem data nem linha: reimportar o mesmo arquivo não parece mudança', () => {
    expect(r.valid[0].opportunity.extra.landbank).toEqual({
      status_raw: 'Em negociação',
      commercial_progress: 'Proposta enviada em ago',
    });
    expect(parseLandbank(fixture(), mapping).valid).toEqual(r.valid);
  });

  it('tipo de ativo em coluna própria e não reconhecido vira aviso', () => {
    const p = parseLandbank(
      [
        ['MD', 'Tipo de ativo', 'Modelo de negociação'],
        ['7', 'Nave espacial', 'Venda / Permuta'],
      ],
      mapping,
    );
    expect(p.valid[0].opportunity.asset_type).toBeNull();
    expect(p.valid[0].warnings.join()).toContain('Nave espacial');
    expect(p.valid[0].opportunity.negotiation_models).toEqual(['sale', 'swap']);
  });
});
