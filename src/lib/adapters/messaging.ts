import type { InboundEvent, MessagingProvider, OutboundMessage, SendResult } from './types';
import type { LogSink } from './email';

/** Palavras que encerram o contato (regra 8). Comparação sem acento/maiúscula, mensagem inteira. */
const OPT_OUT_WORDS = ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'];

export function normalizeReply(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOptOut(text: string): boolean {
  return OPT_OUT_WORDS.includes(normalizeReply(text));
}

export const OPT_OUT_FOOTER = 'Para não receber mais, responda SAIR.';

/** Toda mensagem leva a opção de sair (regra 8). Idempotente. */
export function withOptOutFooter(body: string): string {
  return body.includes(OPT_OUT_FOOTER) ? body : `${body.trimEnd()}\n\n${OPT_OUT_FOOTER}`;
}

/** Barreira comum a todos os provedores: sem consentimento não sai nada. */
export function assertSendable(message: OutboundMessage): OutboundMessage {
  if (!message.consentVersion) throw new Error('Envio sem consentimento registrado (regra 8)');
  if (!/^\+\d{10,15}$/.test(message.to)) throw new Error('Telefone fora do formato E.164');
  return { ...message, body: withOptOutFooter(message.body) };
}

interface LogWebhookPayload {
  events?: { kind?: string; ref?: string; from?: string; text?: string; at?: string }[];
}

/** Implementação inicial (seção 6.4): não envia, só registra. Webhook em formato próprio, para testes. */
export class LogMessagingProvider implements MessagingProvider {
  readonly name = 'log';
  readonly sent: OutboundMessage[] = [];
  constructor(private readonly sink: LogSink = console.log) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const ready = assertSendable(message);
    this.sent.push(ready);
    this.sink(`[whatsapp:log] para=${ready.to} modelo=${ready.templateKey ?? '-'}`);
    return { ok: true, providerRef: `log-${this.sent.length}` };
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    const events = (payload as LogWebhookPayload)?.events ?? [];
    return events.flatMap((e): InboundEvent[] => {
      const at = e.at ? new Date(e.at) : new Date();
      if (e.kind === 'reply') {
        const text = e.text ?? '';
        return [
          {
            kind: isOptOut(text) ? 'opt_out' : 'reply',
            providerRef: e.ref,
            from: e.from,
            text,
            at,
          },
        ];
      }
      if (e.kind === 'delivered' || e.kind === 'read' || e.kind === 'failed') {
        return [{ kind: e.kind, providerRef: e.ref, from: e.from, at }];
      }
      return [];
    });
  }
}
