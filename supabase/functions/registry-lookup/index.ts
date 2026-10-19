// Edge Function: consulta de CNPJ pelo servidor (o navegador nunca chama o provedor).
// POST { cnpj } com o JWT do usuário → { lookup_id, result, data, source, verified_at }.
// Regras 11 (fonte, data e hash gravados; falha nunca derruba o cadastro) e 12 (só APIs públicas, sem raspagem).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isValidCnpj, lookupCnpj, onlyDigits, PROVIDERS, type CnpjData, type Provider } from '../_shared/cnpj.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Quem pede: só usuário logado (cadastro de organização acontece depois do login).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await service.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json({ error: 'login' }, 401);

  let cnpj = '';
  try {
    cnpj = onlyDigits(String((await req.json()).cnpj ?? ''));
  } catch {
    return json({ error: 'body' }, 400);
  }
  if (!isValidCnpj(cnpj)) return json({ result: 'invalid' }, 200);

  const setting = async (key: string, fallback: unknown) => {
    const { data } = await service.from('platform_settings').select('value').eq('key', key).maybeSingle();
    return data?.value ?? fallback;
  };

  // Rate limit por usuário (custo e abuso).
  const perHour = Number(await setting('registry_lookups_per_hour', 30));
  const { count } = await service
    .from('registry_lookups')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', user.id)
    .gte('at', new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= perHour) return json({ result: 'rate_limited' }, 429);

  const insert = async (row: Record<string, unknown>) => {
    const { data, error } = await service
      .from('registry_lookups')
      .insert({ kind: 'cnpj', query: cnpj, requested_by: user.id, ...row })
      .select('id, at')
      .single();
    if (error) throw error;
    return data as { id: string; at: string };
  };

  // Cache: consulta OK recente para o mesmo CNPJ.
  const cacheDays = Number(await setting('cnpj_cache_days', 30));
  const { data: cached } = await service
    .from('registry_lookups')
    .select('id, provider, response, at')
    .eq('kind', 'cnpj')
    .eq('query', cnpj)
    .eq('result', 'ok')
    .gte('at', new Date(Date.now() - cacheDays * 86_400_000).toISOString())
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached) {
    const row = await insert({ provider: 'cache', result: 'cache', source_lookup_id: cached.id, latency_ms: 0 });
    return json({ lookup_id: row.id, result: 'ok', data: cached.response, source: cached.provider, verified_at: cached.at });
  }

  const { data: cfg } = await service.from('integration_settings').select('config').eq('capability', 'cnpj').maybeSingle();
  const names: string[] = cfg?.config?.providers ?? ['brasilapi'];
  const providers = names.map((n) => PROVIDERS[n]).filter((p): p is Provider => !!p);
  const { final, attempts } = await lookupCnpj(cnpj, providers, (u, init) => fetch(u, init), {
    timeoutMs: Number(cfg?.config?.timeout_ms ?? 6000),
    retries: Number(cfg?.config?.retries ?? 1),
  });

  // Toda tentativa fica registrada; a final carrega os dados e o hash.
  let last: { id: string; at: string } | null = null;
  for (const a of attempts) {
    const data: CnpjData | null = a.data;
    last = await insert({
      provider: a.provider,
      result: a.result,
      response: data,
      response_hash: data ? await sha256(JSON.stringify(data)) : null,
      latency_ms: a.latency_ms,
      error: a.error ?? null,
    });
  }
  return json({
    lookup_id: final.result === 'ok' ? last?.id : null,
    result: final.result, // ok | not_found | error | timeout → a tela libera o preenchimento manual
    data: final.data,
    source: final.provider,
    verified_at: last?.at ?? null,
  });
});
