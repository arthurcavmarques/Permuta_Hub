/** Tipos de identidade espelhando o banco (migration 20261010000001_identity_orgs). */
export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type SignupKind = 'broker' | 'buyer' | 'owner';
export type MemberRole = 'admin' | 'broker' | 'buyer' | 'viewer';
export type VerificationStatus = 'pending' | 'approved' | 'rejected';
export type ContactChannel = 'whatsapp' | 'email';
export type ConsentPurpose = 'privacy_policy' | 'whatsapp' | 'email';
export type OrganizationType =
  'developer' | 'builder' | 'urbanizer' | 'land_developer' | 'investor' | 'brokerage' | 'other';

export interface Profile {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  account_status: AccountStatus;
  signup_kind: SignupKind | null;
  preferred_channel: ContactChannel | null;
  whatsapp_opt_in: boolean;
  review_note: string | null;
}

export interface BrokerRecord {
  creci_number: string;
  creci_state: string;
  verification_status: VerificationStatus;
  document_path: string | null;
  rejection_reason: string | null;
}

export interface Membership {
  organization_id: string;
  role: MemberRole;
  organization: { id: string; name: string; type: OrganizationType; active: boolean };
}

export const ORGANIZATION_TYPES = [
  'developer',
  'builder',
  'urbanizer',
  'land_developer',
  'investor',
  'brokerage',
  'other',
] as const satisfies readonly OrganizationType[];

export const UF = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

/** Celular brasileiro → E.164 (+55DDNNNNNNNNN). Devolve null se não parecer um celular válido. */
export function normalizeBrazilianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  // DDD (2) + 9 dígitos começando por 9 (celular) ou 8 dígitos (fixo).
  if (!/^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(digits)) return null;
  return `+55${digits}`;
}
