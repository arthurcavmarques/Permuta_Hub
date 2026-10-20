import { describe, expect, it } from 'vitest';
import {
  formatCnpj,
  isRealEstateCnae,
  isValidCnpj,
  lookupCnpj,
  normalizeBrasilApi,
  normalizeReceitaWs,
  PROVIDERS,
} from './cnpj';

// CNPJ públicos e conhecidos (Banco do Brasil, Petrobras) só como casos de dígito verificador.
const BB = '00000000000191';

describe('isValidCnpj', () => {
  it('aceita dígitos válidos, com ou sem pontuação', () => {
    expect(isValidCnpj(BB)).toBe(true);
    expect(isValidCnpj('33.000.167/0001-01')).toBe(true);
  });
  it('recusa dígito errado, tamanho errado e sequência repetida', () => {
    expect(isValidCnpj('00000000000192')).toBe(false);
    expect(isValidCnpj('1234')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });
  it('formata', () => expect(formatCnpj(BB)).toBe('00.000.000/0001-91'));
});

const brasilApiSample = {
  cnpj: '00000000000191',
  razao_social: 'BANCO DO BRASIL SA',
  nome_fantasia: 'DIRECAO GERAL',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '1966-08-01',
  natureza_juridica: 'Sociedade de Economia Mista',
  cnae_fiscal: 6422100,
  cnae_fiscal_descricao: 'Bancos múltiplos, com carteira comercial',
  cnaes_secundarios: [{ codigo: 6499999 }, { codigo: 0 }],
  descricao_tipo_de_logradouro: 'QUADRA',
  logradouro: 'SAUN QUADRA 5',
  numero: 'SN',
  bairro: 'ASA NORTE',
  municipio: 'BRASILIA',
  uf: 'DF',
  qsa: [{ nome_socio: 'PESSOA FÍSICA' }],
};

describe('normalização', () => {
  it('BrasilAPI: campos da empresa, sem quadro societário', () => {
    const d = normalizeBrasilApi(brasilApiSample);
    expect(d).toMatchObject({
      cnpj: BB,
      legal_name: 'BANCO DO BRASIL SA',
      is_active: true,
      cnae_main: '6422100',
      cnae_secondary: ['6499999'],
      city: 'BRASILIA',
      state: 'DF',
    });
    expect(JSON.stringify(d)).not.toContain('PESSOA FÍSICA');
  });
  it('ReceitaWS: data BR e CNAE pontuado', () => {
    const d = normalizeReceitaWs({
      cnpj: '00.000.000/0001-91',
      nome: 'BANCO DO BRASIL SA',
      situacao: 'BAIXADA',
      abertura: '01/08/1966',
      atividade_principal: [{ code: '64.22-1-00', text: 'Bancos' }],
      atividades_secundarias: [{ code: '00.00-0-00' }],
    });
    expect(d).toMatchObject({ cnpj: BB, is_active: false, opened_at: '1966-08-01', cnae_main: '6422100', cnae_secondary: [] });
  });
});

type Reply = { status: number; body?: unknown } | 'throw' | 'hang';
function fakeFetch(script: Record<string, Reply[]>) {
  const calls: string[] = [];
  const impl = async (url: string, init: { signal: AbortSignal }) => {
    const host = new URL(url).hostname;
    calls.push(host);
    const r = script[host]?.shift() ?? { status: 500 };
    if (r === 'throw') throw new Error('rede');
    if (r === 'hang')
      return new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort'))));
    return { status: r.status, json: async () => r.body };
  };
  return { impl, calls };
}

const both = [PROVIDERS.brasilapi, PROVIDERS.receitaws];

describe('lookupCnpj', () => {
  it('dígito inválido nem chama a rede', async () => {
    const f = fakeFetch({});
    const r = await lookupCnpj('00000000000192', both, f.impl);
    expect(r.final.result).toBe('invalid');
    expect(f.calls).toEqual([]);
  });
  it('primário responde: usa ele', async () => {
    const f = fakeFetch({ 'brasilapi.com.br': [{ status: 200, body: brasilApiSample }] });
    const r = await lookupCnpj(BB, both, f.impl);
    expect(r.final).toMatchObject({ provider: 'brasilapi', result: 'ok' });
    expect(f.calls).toEqual(['brasilapi.com.br']);
  });
  it('erro no primário: tenta de novo e depois cai para o secundário', async () => {
    const f = fakeFetch({
      'brasilapi.com.br': ['throw', { status: 503 }],
      'receitaws.com.br': [{ status: 200, body: { cnpj: BB, nome: 'BANCO DO BRASIL SA', situacao: 'ATIVA' } }],
    });
    const r = await lookupCnpj(BB, both, f.impl);
    expect(r.final).toMatchObject({ provider: 'receitaws', result: 'ok' });
    expect(r.attempts.map((a) => a.result)).toEqual(['error', 'error', 'ok']);
  });
  it('timeout conta como falha e segue', async () => {
    const f = fakeFetch({ 'brasilapi.com.br': ['hang', 'hang'], 'receitaws.com.br': ['hang', 'hang'] });
    const r = await lookupCnpj(BB, both, f.impl, { timeoutMs: 20 });
    expect(r.final.result).toBe('timeout');
    expect(r.attempts).toHaveLength(4);
  });
  it('não encontrado é definitivo (não pergunta ao secundário)', async () => {
    const f = fakeFetch({ 'brasilapi.com.br': [{ status: 404, body: { message: 'não encontrado' } }] });
    const r = await lookupCnpj(BB, both, f.impl);
    expect(r.final.result).toBe('not_found');
    expect(f.calls).toEqual(['brasilapi.com.br']);
  });
});

describe('isRealEstateCnae', () => {
  it('compara por prefixo configurável', () => {
    expect(isRealEstateCnae('4110700', ['41', '68'])).toBe(true);
    expect(isRealEstateCnae('6422100', ['41', '68'])).toBe(false);
    expect(isRealEstateCnae(null, ['41'])).toBe(false);
  });
});
