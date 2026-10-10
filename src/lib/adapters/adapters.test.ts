import {
  FakeEmailProvider,
  InternalHashSigner,
  LogEmailProvider,
  LogMessagingProvider,
  ManualQueueBrokerVerifier,
  OPT_OUT_FOOTER,
  ResendEmailProvider,
  assertSendable,
  createProviders,
  isOptOut,
  processOutbox,
  sha256Hex,
  withOptOutFooter,
  type OutboxItem,
  type OutboxStore,
} from '.';

const silent = () => {};

describe('mensageria (regra 8)', () => {
  it.each(['SAIR', 'sair', ' Parar! ', 'Pare', 'stop', 'Cancelar.'])('"%s" é opt-out', (t) => {
    expect(isOptOut(t)).toBe(true);
  });

  it.each(['Tenho interesse', 'não quero sair agora', 'parar de receber depois', ''])(
    '"%s" não é opt-out',
    (t) => {
      expect(isOptOut(t)).toBe(false);
    },
  );

  it('toda mensagem leva a opção de sair, sem duplicar', () => {
    const once = withOptOutFooter('Área de 12.000 m² na Zona Sul');
    expect(once.endsWith(OPT_OUT_FOOTER)).toBe(true);
    expect(withOptOutFooter(once)).toBe(once);
  });

  it('recusa envio sem consentimento ou com telefone inválido', () => {
    expect(() => assertSendable({ to: '+5551999990000', body: 'x', consentVersion: '' })).toThrow(
      /consentimento/,
    );
    expect(() => assertSendable({ to: '51 99999-0000', body: 'x', consentVersion: 'v1' })).toThrow(
      /E\.164/,
    );
  });

  it('LogMessagingProvider registra sem enviar e acrescenta o rodapé', async () => {
    const p = new LogMessagingProvider(silent);
    const r = await p.send({ to: '+5551999990000', body: 'Área nova', consentVersion: 'v1' });
    expect(r.ok).toBe(true);
    expect(p.sent[0].body).toContain(OPT_OUT_FOOTER);
  });

  it('webhook: resposta "sair" vira opt_out; status são normalizados; lixo é ignorado', () => {
    const p = new LogMessagingProvider(silent);
    const events = p.parseWebhook({
      events: [
        { kind: 'reply', from: '+5551999990000', text: 'SAIR' },
        { kind: 'reply', from: '+5551999990000', text: 'Tenho interesse' },
        { kind: 'delivered', ref: 'abc' },
        { kind: 'desconhecido' },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(['opt_out', 'reply', 'delivered']);
    expect(p.parseWebhook(null)).toEqual([]);
  });
});

describe('aceite de termo (InternalHashSigner)', () => {
  it('hash SHA-256 igual ao do banco (sha256_hex) e determinístico', async () => {
    // Valor conhecido de SHA-256("abc").
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const at = new Date('2026-10-10T12:00:00Z');
    const signer = new InternalHashSigner(() => at);
    const a = await signer.sign({ renderedBody: 'Termo v1 — João', userId: 'u1' });
    const b = await signer.sign({ renderedBody: 'Termo v1 — João', userId: 'u1' });
    expect(a).toEqual(b);
    expect(a.signedAt).toBe(at);
    expect(a.provider).toBe('internal_hash');
  });

  it('texto diferente gera hash diferente; termo vazio é recusado', async () => {
    const signer = new InternalHashSigner();
    const a = await signer.sign({ renderedBody: 'Termo A', userId: 'u1' });
    const b = await signer.sign({ renderedBody: 'Termo B', userId: 'u1' });
    expect(a.renderedBodyHash).not.toBe(b.renderedBodyHash);
    await expect(signer.sign({ renderedBody: '  ', userId: 'u1' })).rejects.toThrow();
  });
});

describe('verificação de CRECI', () => {
  it('fila manual nunca aprova sozinha', async () => {
    const r = await new ManualQueueBrokerVerifier().verify();
    expect(r.status).toBe('pending');
  });
});

describe('Resend', () => {
  const fakeFetch = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('envia com remetente configurado e devolve o id', async () => {
    const f = fakeFetch(200, { id: 'em_123' });
    const p = new ResendEmailProvider({ apiKey: 'k', from: 'X <a@b.c>', fetchImpl: f });
    const r = await p.send({ to: 'a@b.c', subject: 'Oi', text: 'Corpo' });
    expect(r).toEqual({ ok: true, providerRef: 'em_123' });
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'X <a@b.c>', to: ['a@b.c'] });
  });

  it('422 é falha permanente; 429 e 500 são temporárias', async () => {
    const send = (status: number) =>
      new ResendEmailProvider({
        apiKey: 'k',
        from: 'f',
        fetchImpl: fakeFetch(status, { message: 'x' }),
      }).send({
        to: 'a',
        subject: 's',
        text: 't',
      });
    expect((await send(422)).permanent).toBe(true);
    expect((await send(429)).permanent).toBe(false);
    expect((await send(500)).permanent).toBe(false);
  });
});

describe('registro de provedores (integration_settings)', () => {
  it('sem configuração usa as implementações iniciais', () => {
    const p = createProviders([], {}, silent);
    expect(p.email.name).toBe('log');
    expect(p.messaging.name).toBe('log');
    expect(p.agreementSigner.name).toBe('internal_hash');
    expect(p.brokerVerifier.name).toBe('manual_queue');
    expect(p.billing.chargesEnabled).toBe(false);
  });

  it('resend exige segredos do ambiente', () => {
    const settings = [{ capability: 'email' as const, provider: 'resend', config: {} }];
    expect(() => createProviders(settings)).toThrow(/RESEND_API_KEY/);
    expect(createProviders(settings, { RESEND_API_KEY: 'k', EMAIL_FROM: 'f' }).email.name).toBe(
      'resend',
    );
  });

  it('provedor desconhecido falha alto (não cai em silêncio)', () => {
    expect(() =>
      createProviders([{ capability: 'messaging', provider: 'zap-pirata', config: {} }]),
    ).toThrow(/desconhecido/);
  });
});

describe('caixa de saída', () => {
  class MemoryStore implements OutboxStore {
    log: string[] = [];
    constructor(public items: OutboxItem[]) {}
    async fetchQueued(limit: number) {
      return this.items.slice(0, limit);
    }
    async markSent(id: string) {
      this.log.push(`sent:${id}`);
    }
    async markFailed(id: string, _p: string, _e: string, attempts: number, final: boolean) {
      this.log.push(`${final ? 'failed' : 'retry'}:${id}:${attempts}`);
    }
  }
  const item = (id: string, attempts = 0): OutboxItem => ({
    id,
    to_email: `${id}@t.invalid`,
    subject: 's',
    body_text: 'b',
    template_key: 'k',
    attempts,
  });

  it('envia, reagenda falha temporária e encerra na última tentativa ou falha permanente', async () => {
    const provider = new FakeEmailProvider();
    const store = new MemoryStore([item('a'), item('b', 1), item('c', 4), item('d')]);
    const original = provider.send.bind(provider);
    provider.send = async (m) => {
      if (m.to.startsWith('b') || m.to.startsWith('c')) return { ok: false, error: 'timeout' };
      if (m.to.startsWith('d')) return { ok: false, error: 'inválido', permanent: true };
      return original(m);
    };
    const report = await processOutbox(store, provider, { maxAttempts: 5 });
    expect(report).toEqual({ sent: 1, retrying: 1, failed: 2 });
    expect(store.log).toEqual(['sent:a', 'retry:b:2', 'failed:c:5', 'failed:d:1']);
    expect(provider.sent.map((m) => m.to)).toEqual(['a@t.invalid']);
  });

  it('LogEmailProvider não envia de fato, só registra', async () => {
    const lines: string[] = [];
    const r = await new LogEmailProvider((l) => lines.push(l)).send({
      to: 'x@t.invalid',
      subject: 'Oi',
      text: 't',
    });
    expect(r.ok).toBe(true);
    expect(lines[0]).toContain('x@t.invalid');
  });
});
