import { LogEmailProvider, ResendEmailProvider, type LogSink } from './email';
import { LogMessagingProvider } from './messaging';
import { InternalHashSigner, ManualQueueBrokerVerifier, NoBillingProvider } from './others';
import type {
  AgreementSigner,
  BillingProvider,
  BrokerVerifier,
  Capability,
  EmailProvider,
  IntegrationSetting,
  MessagingProvider,
} from './types';

/** Segredos vêm do ambiente de quem roda (script/Edge Function), nunca de `integration_settings`. */
export interface ProviderSecrets {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export interface Providers {
  email: EmailProvider;
  messaging: MessagingProvider;
  agreementSigner: AgreementSigner;
  brokerVerifier: BrokerVerifier;
  billing: BillingProvider;
}

function providerFor(
  settings: IntegrationSetting[],
  capability: Capability,
  fallback: string,
): string {
  return settings.find((s) => s.capability === capability)?.provider ?? fallback;
}

function unknown(capability: Capability, provider: string): never {
  throw new Error(`Provedor desconhecido para ${capability}: "${provider}"`);
}

/** Monta os adapters a partir de `integration_settings`. Sem linha = implementação inicial. */
export function createProviders(
  settings: IntegrationSetting[],
  secrets: ProviderSecrets = {},
  sink?: LogSink,
): Providers {
  const emailName = providerFor(settings, 'email', 'log');
  let email: EmailProvider;
  if (emailName === 'log') email = new LogEmailProvider(sink);
  else if (emailName === 'resend') {
    if (!secrets.RESEND_API_KEY || !secrets.EMAIL_FROM)
      throw new Error('Provedor "resend" exige RESEND_API_KEY e EMAIL_FROM no ambiente');
    email = new ResendEmailProvider({ apiKey: secrets.RESEND_API_KEY, from: secrets.EMAIL_FROM });
  } else unknown('email', emailName);

  const messagingName = providerFor(settings, 'messaging', 'log');
  if (messagingName !== 'log') unknown('messaging', messagingName);

  const signerName = providerFor(settings, 'agreement_signer', 'internal_hash');
  if (signerName !== 'internal_hash') unknown('agreement_signer', signerName);

  const verifierName = providerFor(settings, 'broker_verifier', 'manual_queue');
  if (verifierName !== 'manual_queue') unknown('broker_verifier', verifierName);

  const billingName = providerFor(settings, 'billing', 'none');
  if (billingName !== 'none') unknown('billing', billingName);

  return {
    email,
    messaging: new LogMessagingProvider(sink),
    agreementSigner: new InternalHashSigner(),
    brokerVerifier: new ManualQueueBrokerVerifier(),
    billing: new NoBillingProvider(),
  };
}
