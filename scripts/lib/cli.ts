import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Cliente com service_role: só para scripts locais. Nunca importar no frontend. */
export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env (veja .env.example).');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? true;
    } else positional.push(a);
  }
  return { positional, flags };
}

/** Relatórios vão para import-reports/ (ignorado pelo git: podem conter dados reais). */
export async function saveReport(name: string, content: unknown, ext = 'json'): Promise<string> {
  const dir = join(process.cwd(), 'import-reports');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`);
  await writeFile(path, JSON.stringify(content, null, 2), 'utf-8');
  return path;
}

export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
