/**
 * Envia os e-mails pendentes de `email_outbox` com o provedor de `integration_settings` (D015).
 * Padrão "log": não envia, só registra no terminal. Resend: definir RESEND_API_KEY e EMAIL_FROM no .env.
 * Uso: npm run outbox:send [-- --limit=50]
 */
import { adminClient, fail, parseArgs } from './lib/cli';
import {
  createProviders,
  processOutbox,
  type IntegrationSetting,
  type OutboxStore,
} from '../src/lib/adapters';

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const limit = Number(flags.limit ?? 50);
  const db = adminClient();

  const { data: settings, error } = await db
    .from('integration_settings')
    .select('capability, provider, config');
  if (error) fail(error.message);
  const providers = createProviders((settings ?? []) as IntegrationSetting[], {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });

  const store: OutboxStore = {
    async fetchQueued(n) {
      const { data, error: e } = await db
        .from('email_outbox')
        .select('id, to_email, subject, body_text, template_key, attempts')
        .eq('status', 'queued')
        .order('created_at')
        .limit(n);
      if (e) throw e;
      return data ?? [];
    },
    async markSent(id, provider, providerRef) {
      const { error: e } = await db
        .from('email_outbox')
        .update({
          status: 'sent',
          provider,
          provider_ref: providerRef ?? null,
          sent_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (e) throw e;
    },
    async markFailed(id, provider, message, attempts, final) {
      const { error: e } = await db
        .from('email_outbox')
        .update({ status: final ? 'failed' : 'queued', provider, last_error: message, attempts })
        .eq('id', id);
      if (e) throw e;
    },
  };

  const report = await processOutbox(store, providers.email, { limit });
  console.log(
    `✔ provedor=${providers.email.name} enviados=${report.sent} reagendados=${report.retrying} falhas=${report.failed}`,
  );
}

main().catch((e: Error) => fail(e.message));
