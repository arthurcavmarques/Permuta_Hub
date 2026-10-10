/**
 * Contratos dos adapters (seção 6.4). Cada capacidade tem uma interface e implementações trocáveis,
 * escolhidas por `integration_settings` (banco). Código puro: roda no navegador, em scripts Node e
 * em Edge Functions (Deno). Segredos (chaves de API) entram por injeção, nunca pelo banco.
 */

export interface SendResult {
  ok: boolean;
  /** Identificador do envio no provedor (para webhook de status). */
  providerRef?: string;
  error?: string;
  /** Falha definitiva (ex.: e-mail inválido): não adianta tentar de novo. */
  permanent?: boolean;
}

// ---------------------------------------------------------------- E-mail
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Chave do modelo (ex.: `invitation`, `creci_approved`) — para métricas e auditoria. */
  templateKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

// ---------------------------------------------------------------- WhatsApp / mensageria
export interface OutboundMessage {
  /** Telefone em E.164 (ex.: +5551999990000). */
  to: string;
  body: string;
  templateKey?: string;
  /** Prova de opt-in exigida pela regra 8; sem ela o envio é recusado antes do provedor. */
  consentVersion: string;
}

export type InboundEventKind = 'delivered' | 'read' | 'failed' | 'reply' | 'opt_out';

export interface InboundEvent {
  kind: InboundEventKind;
  providerRef?: string;
  from?: string;
  text?: string;
  at: Date;
}

export interface MessagingProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
  /** Converte o webhook do provedor em eventos normalizados (inclui detecção de "sair"/"parar"). */
  parseWebhook(payload: unknown): InboundEvent[];
}

// ---------------------------------------------------------------- Aceite de termos
export interface AgreementSignInput {
  renderedBody: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface SignedAgreement {
  /** SHA-256 (hex) do texto exatamente como foi exibido. */
  renderedBodyHash: string;
  signedAt: Date;
  provider: string;
  providerRef?: string;
}

export interface AgreementSigner {
  readonly name: string;
  sign(input: AgreementSignInput): Promise<SignedAgreement>;
}

// ---------------------------------------------------------------- Verificação de CRECI
export interface BrokerVerificationRequest {
  userId: string;
  creciNumber: string;
  creciState: string;
  documentPath?: string | null;
}

export interface BrokerVerificationResult {
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
}

export interface BrokerVerifier {
  readonly name: string;
  verify(request: BrokerVerificationRequest): Promise<BrokerVerificationResult>;
}

// ---------------------------------------------------------------- Cobrança (preparação, seção 9.8)
export interface BillingProvider {
  readonly name: string;
  /** Sem gateway nesta etapa: nenhuma cobrança é possível. */
  readonly chargesEnabled: boolean;
}

// ---------------------------------------------------------------- Configuração
export type Capability =
  'email' | 'messaging' | 'agreement_signer' | 'broker_verifier' | 'map' | 'billing';

/** Linha de `integration_settings` (config NÃO secreta). */
export interface IntegrationSetting {
  capability: Capability;
  provider: string;
  config: Record<string, unknown>;
}
