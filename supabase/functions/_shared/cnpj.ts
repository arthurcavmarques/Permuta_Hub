// CNPJ: validação local e consulta a provedores públicos (seção 9.9 do plano, regra 11).
// Sem imports: o mesmo arquivo roda na Edge Function (Deno) e no navegador (validação antes da rede).

export const onlyDigits = (s: string) => s.replace(/\D/g, '');

/** Dígitos verificadores do CNPJ (módulo 11). Recusa sequências repetidas. */
export function isValidCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function formatCnpj(input: string): string {
  const d = onlyDigits(input).padStart(14, '0').slice(-14);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** O que guardamos do retorno: só dados da empresa. Quadro societário (nomes de pessoas) fica de fora (LGPD). */
export interface CnpjData {
  cnpj: string;
  legal_name: string;
  trade_name: string | null;
  registry_status: string; // ex.: ATIVA, BAIXADA, INAPTA, SUSPENSA
  is_active: boolean;
  opened_at: string | null; // AAAA-MM-DD
  legal_nature: string | null;
  cnae_main: string | null; // 7 dígitos
  cnae_main_description: string | null;
  cnae_secondary: string[];
  address: string | null;
  city: string | null;
  state: string | null;
}

export type LookupResult = 'ok' | 'not_found' | 'invalid' | 'error' | 'timeout';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const cnae7 = (v: unknown) => (v === null || v === undefined || v === '' ? null : onlyDigits(String(v)).padStart(7, '0'));

export function normalizeBrasilApi(j: Record<string, unknown>): CnpjData {
  const status = str(j.descricao_situacao_cadastral) ?? 'DESCONHECIDA';
  const addr = [str(j.descricao_tipo_de_logradouro), str(j.logradouro), str(j.numero), str(j.complemento), str(j.bairro)]
    .filter(Boolean)
    .join(', ');
  return {
    cnpj: onlyDigits(String(j.cnpj ?? '')),
    legal_name: str(j.razao_social) ?? '',
    trade_name: str(j.nome_fantasia),
    registry_status: status.toUpperCase(),
    is_active: status.toUpperCase() === 'ATIVA',
    opened_at: str(j.data_inicio_atividade),
    legal_nature: str(j.natureza_juridica),
    cnae_main: cnae7(j.cnae_fiscal),
    cnae_main_description: str(j.cnae_fiscal_descricao),
    cnae_secondary: Array.isArray(j.cnaes_secundarios)
      ? (j.cnaes_secundarios as { codigo?: unknown }[]).map((c) => cnae7(c.codigo)).filter((c): c is string => !!c && c !== '0000000')
      : [],
    address: addr || null,
    city: str(j.municipio),
    state: str(j.uf),
  };
}

/** ReceitaWS (provedor secundário): datas em DD/MM/AAAA e CNAE com pontuação. */
export function normalizeReceitaWs(j: Record<string, unknown>): CnpjData {
  const status = (str(j.situacao) ?? 'DESCONHECIDA').toUpperCase();
  const br = str(j.abertura);
  const main = Array.isArray(j.atividade_principal) ? (j.atividade_principal[0] as { code?: string; text?: string }) : undefined;
  const addr = [str(j.logradouro), str(j.numero), str(j.complemento), str(j.bairro)].filter(Boolean).join(', ');
  return {
    cnpj: onlyDigits(String(j.cnpj ?? '')),
    legal_name: str(j.nome) ?? '',
    trade_name: str(j.fantasia),
    registry_status: status,
    is_active: status === 'ATIVA',
    opened_at: br && /^\d{2}\/\d{2}\/\d{4}$/.test(br) ? br.split('/').reverse().join('-') : null,
    legal_nature: str(j.natureza_juridica),
    cnae_main: main?.code ? cnae7(main.code) : null,
    cnae_main_description: str(main?.text),
    cnae_secondary: Array.isArray(j.atividades_secundarias)
      ? (j.atividades_secundarias as { code?: string }[]).map((c) => cnae7(c.code)).filter((c): c is string => !!c && c !== '0000000')
      : [],
    address: addr || null,
    city: str(j.municipio),
    state: str(j.uf),
  };
}

export interface Provider {
  name: string;
  url: (cnpj: string) => string;
  normalize: (j: Record<string, unknown>) => CnpjData;
  /** Alguns provedores respondem 200 com {status: "ERROR"} em vez de 404. */
  isNotFound?: (status: number, j: Record<string, unknown> | null) => boolean;
}

export const PROVIDERS: Record<string, Provider> = {
  brasilapi: {
    name: 'brasilapi',
    url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
    normalize: normalizeBrasilApi,
    isNotFound: (status) => status === 404,
  },
  receitaws: {
    name: 'receitaws',
    url: (c) => `https://receitaws.com.br/v1/cnpj/${c}`,
    normalize: normalizeReceitaWs,
    isNotFound: (status, j) => status === 404 || (j?.status === 'ERROR' && /não encontrado|not found/i.test(String(j.message ?? ''))),
  },
};

export interface Attempt {
  provider: string;
  result: LookupResult;
  latency_ms: number;
  data: CnpjData | null;
  error?: string;
}

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Tenta cada provedor em ordem: timeout por tentativa, uma retentativa em erro/timeout, e cai para o próximo.
 * "Não encontrado" é resposta definitiva (não adianta perguntar a outro). Devolve todas as tentativas para o log.
 */
export async function lookupCnpj(
  cnpj: string,
  providers: Provider[],
  fetchImpl: Fetch,
  opts: { timeoutMs?: number; retries?: number; now?: () => number } = {},
): Promise<{ final: Attempt; attempts: Attempt[] }> {
  const digits = onlyDigits(cnpj);
  const now = opts.now ?? (() => Date.now());
  const attempts: Attempt[] = [];
  if (!isValidCnpj(digits)) {
    const a: Attempt = { provider: 'local', result: 'invalid', latency_ms: 0, data: null };
    return { final: a, attempts: [a] };
  }
  for (const p of providers) {
    for (let i = 0; i <= (opts.retries ?? 1); i++) {
      const started = now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 6000);
      let a: Attempt;
      try {
        const res = await fetchImpl(p.url(digits), { signal: ctrl.signal, headers: { accept: 'application/json' } });
        let body: Record<string, unknown> | null = null;
        try {
          body = (await res.json()) as Record<string, unknown>;
        } catch {
          body = null;
        }
        if (p.isNotFound?.(res.status, body)) a = { provider: p.name, result: 'not_found', latency_ms: now() - started, data: null };
        else if (res.status >= 200 && res.status < 300 && body && !(body.status === 'ERROR')) {
          const data = p.normalize(body);
          a = data.legal_name
            ? { provider: p.name, result: 'ok', latency_ms: now() - started, data }
            : { provider: p.name, result: 'error', latency_ms: now() - started, data: null, error: 'resposta sem razão social' };
        } else a = { provider: p.name, result: 'error', latency_ms: now() - started, data: null, error: `HTTP ${res.status}` };
      } catch (e) {
        const aborted = ctrl.signal.aborted;
        a = { provider: p.name, result: aborted ? 'timeout' : 'error', latency_ms: now() - started, data: null, error: aborted ? 'timeout' : String(e) };
      } finally {
        clearTimeout(timer);
      }
      attempts.push(a);
      if (a.result === 'ok' || a.result === 'not_found') return { final: a, attempts };
    }
  }
  return { final: attempts[attempts.length - 1], attempts };
}

/** CNAE compatível com atividade imobiliária/construção (só aviso à curadoria, nunca bloqueia). */
export function isRealEstateCnae(cnae: string | null, prefixes: string[]): boolean {
  if (!cnae) return false;
  return prefixes.some((p) => cnae.startsWith(p));
}
