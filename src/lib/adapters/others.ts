import type {
  AgreementSignInput,
  AgreementSigner,
  BillingProvider,
  BrokerVerificationResult,
  BrokerVerifier,
  SignedAgreement,
} from './types';

/** SHA-256 em hex via Web Crypto (navegador, Node 18+ e Deno). Mesmo algoritmo do banco (`sha256_hex`). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Aceite próprio (seção 6.4): hash do texto renderizado + metadados; sem serviço externo. */
export class InternalHashSigner implements AgreementSigner {
  readonly name = 'internal_hash';
  constructor(private readonly now: () => Date = () => new Date()) {}

  async sign(input: AgreementSignInput): Promise<SignedAgreement> {
    if (!input.renderedBody.trim()) throw new Error('Termo vazio não pode ser aceito');
    return {
      renderedBodyHash: await sha256Hex(input.renderedBody),
      signedAt: this.now(),
      provider: this.name,
    };
  }
}

/** CRECI sem API pública: tudo vai para a fila manual da curadoria (seção 9.5). */
export class ManualQueueBrokerVerifier implements BrokerVerifier {
  readonly name = 'manual_queue';
  async verify(): Promise<BrokerVerificationResult> {
    return { status: 'pending', reason: 'Aguardando verificação manual da curadoria' };
  }
}

export class NoBillingProvider implements BillingProvider {
  readonly name = 'none';
  readonly chargesEnabled = false;
}
