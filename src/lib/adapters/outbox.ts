import type { EmailProvider } from './types';

/** Linha de `email_outbox` (D015). */
export interface OutboxItem {
  id: string;
  to_email: string;
  subject: string;
  body_text: string;
  template_key: string;
  attempts: number;
}

/** Acesso à caixa de saída; implementação real usa Supabase com service_role (scripts/Edge Function). */
export interface OutboxStore {
  fetchQueued(limit: number): Promise<OutboxItem[]>;
  markSent(id: string, provider: string, providerRef: string | undefined): Promise<void>;
  /** `final = true` encerra (status `failed`); senão volta para a fila com `attempts` atualizado. */
  markFailed(
    id: string,
    provider: string,
    error: string,
    attempts: number,
    final: boolean,
  ): Promise<void>;
}

export interface OutboxReport {
  sent: number;
  retrying: number;
  failed: number;
}

export async function processOutbox(
  store: OutboxStore,
  provider: EmailProvider,
  { limit = 50, maxAttempts = 5 }: { limit?: number; maxAttempts?: number } = {},
): Promise<OutboxReport> {
  const report: OutboxReport = { sent: 0, retrying: 0, failed: 0 };
  for (const item of await store.fetchQueued(limit)) {
    const result = await provider.send({
      to: item.to_email,
      subject: item.subject,
      text: item.body_text,
      templateKey: item.template_key,
    });
    if (result.ok) {
      await store.markSent(item.id, provider.name, result.providerRef);
      report.sent++;
      continue;
    }
    const attempts = item.attempts + 1;
    const final = !!result.permanent || attempts >= maxAttempts;
    await store.markFailed(
      item.id,
      provider.name,
      result.error ?? 'erro desconhecido',
      attempts,
      final,
    );
    if (final) report.failed++;
    else report.retrying++;
  }
  return report;
}
