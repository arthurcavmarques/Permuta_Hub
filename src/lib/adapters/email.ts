import type { EmailMessage, EmailProvider, SendResult } from './types';

export type LogSink = (line: string) => void;

/** Padrão sem domínio (D015): não envia, só registra. O conteúdo fica também em `email_outbox`. */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';
  constructor(private readonly sink: LogSink = console.log) {}

  async send(message: EmailMessage): Promise<SendResult> {
    this.sink(
      `[email:log] para=${message.to} assunto="${message.subject}" modelo=${message.templateKey ?? '-'}`,
    );
    return { ok: true, providerRef: `log-${Date.now()}` };
  }
}

/** Para testes: guarda o que foi "enviado" e permite simular falhas. */
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: EmailMessage[] = [];
  failNext: SendResult | null = null;

  async send(message: EmailMessage): Promise<SendResult> {
    if (this.failNext) {
      const result = this.failNext;
      this.failNext = null;
      return result;
    }
    this.sent.push(message);
    return { ok: true, providerRef: `fake-${this.sent.length}` };
  }
}

export interface ResendConfig {
  apiKey: string;
  /** Remetente num domínio verificado no Resend (ex.: "PermutaHub <nao-responda@dominio.com.br>"). */
  from: string;
  fetchImpl?: typeof fetch;
}

/** Resend (free tier) via HTTP — ativar quando houver domínio próprio (D015). */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly config: ResendConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
    } catch (e) {
      return { ok: false, error: `rede: ${(e as Error).message}` };
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (response.ok) return { ok: true, providerRef: body.id };
    // 4xx (exceto limite) = problema no pedido: repetir não resolve.
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    return {
      ok: false,
      error: `${response.status}: ${body.message ?? response.statusText}`,
      permanent,
    };
  }
}
