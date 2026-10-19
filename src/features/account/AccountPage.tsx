import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import {
  normalizeBrazilianPhone,
  ORGANIZATION_TYPES,
  UF,
  type AccountStatus,
  type ConsentPurpose,
  type VerificationStatus,
} from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Badge, FieldError, FormAlert, Notice, Section, type Tone } from '@/components/ui/section';
import {
  useActiveConsentTexts,
  useChangePassword,
  useCreateOrganization,
  useMyConsents,
  useRecordConsent,
  useCreciLookupUrl,
  useSubmitCreci,
  useUpdateProfile,
} from './api';
import { CnpjField, type CnpjValue } from './CnpjField';

const accountTone: Record<AccountStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
};

const creciTone: Record<VerificationStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export function AccountPage() {
  const { profile, isPlatformAdmin, broker, memberships } = useAuth();
  if (!profile) return null;
  const status: AccountStatus = isPlatformAdmin ? 'approved' : profile.account_status;
  const showBroker = profile.signup_kind === 'broker' || !!broker;
  // Corretor também cadastra a imobiliária (CNPJ) para vincular ao CRECI.
  const showOrganization =
    profile.signup_kind === 'buyer' || profile.signup_kind === 'broker' || memberships.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold text-primary">{t.account.title}</h1>
      <Notice tone={accountTone[status]} title={t.account.status[status]}>
        {t.account.statusBody[status]}
        {profile.review_note && status !== 'approved' && (
          <p className="mt-1">
            {t.account.reviewNote}: {profile.review_note}
          </p>
        )}
      </Notice>
      {profile.signup_kind === 'owner' && (
        <Notice title={t.account.owner.title}>
          {t.account.owner.body}{' '}
          <Link to="/minhas-areas" className="text-action hover:underline">
            {t.account.owner.link}
          </Link>
        </Notice>
      )}
      <ProfileSection />
      {showBroker && <BrokerSection />}
      {showOrganization && <OrganizationSection />}
      <ConsentSection />
      <PasswordSection />
    </div>
  );
}

// ---------------------------------------------------------------- Dados pessoais
const profileSchema = z.object({
  full_name: z.string().trim().min(3, t.signup.errors.name),
  phone: z
    .string()
    .refine((v) => v.trim() === '' || normalizeBrazilianPhone(v) !== null, t.signup.errors.phone),
  preferred_channel: z.enum(['', 'whatsapp', 'email']),
});
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileSection() {
  const { profile } = useAuth();
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
      preferred_channel: profile?.preferred_channel ?? '',
    },
  });

  const onSubmit = async (v: ProfileValues) => {
    setSaved(false);
    await update.mutateAsync({
      userId: profile!.user_id,
      full_name: v.full_name.trim(),
      phone: v.phone.trim() ? normalizeBrazilianPhone(v.phone) : null,
      preferred_channel: v.preferred_channel || null,
    });
    setSaved(true);
  };

  return (
    <Section title={t.account.profile.title}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="full_name">{t.signup.fullName}</Label>
          <Input id="full_name" {...register('full_name')} />
          <FieldError message={errors.full_name?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">{t.signup.phone}</Label>
          <Input id="phone" type="tel" {...register('phone')} />
          <FieldError message={errors.phone?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferred_channel">{t.account.profile.preferredChannel}</Label>
          <Select id="preferred_channel" {...register('preferred_channel')}>
            <option value="">{t.account.profile.noPreference}</option>
            <option value="whatsapp">{t.enums.channel.whatsapp}</option>
            <option value="email">{t.enums.channel.email}</option>
          </Select>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={update.isPending}>
            {t.account.profile.save}
          </Button>
          {saved && <span className="text-sm text-success">{t.account.profile.saved}</span>}
          {update.isError && <span className="text-sm text-danger">{t.common.error}</span>}
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------- Senha
const passwordSchema = z
  .object({
    password: z.string().min(10, t.signup.errors.password),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: t.signup.errors.passwordMatch,
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const change = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = async (v: PasswordValues) => {
    await change.mutateAsync(v.password);
    reset();
  };

  return (
    <Section title={t.account.password.title}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">{t.account.password.new}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
          <FieldError message={errors.password?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">{t.account.password.confirm}</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            {...register('confirm')}
          />
          <FieldError message={errors.confirm?.message} />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={change.isPending}>
            {t.account.password.submit}
          </Button>
          {change.isSuccess && (
            <span className="text-sm text-success">{t.account.password.done}</span>
          )}
          {change.isError && <span className="text-sm text-danger">{t.common.error}</span>}
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------- Consentimentos (regras 7 e 8)
function ConsentSection() {
  const { profile } = useAuth();
  const texts = useActiveConsentTexts();
  const consents = useMyConsents(profile?.user_id);
  const record = useRecordConsent();
  const purposes: ConsentPurpose[] = ['whatsapp', 'email', 'privacy_policy'];

  return (
    <Section title={t.account.consents.title} description={t.account.consents.body}>
      <ul className="divide-y divide-border">
        {purposes.map((p) => {
          const current = consents.data?.find((c) => c.purpose === p);
          const granted = current?.granted ?? false;
          const text = texts.data?.[p];
          return (
            <li
              key={p}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 sm:flex-1">
                <p className="text-sm font-medium text-ink">{t.enums.consentPurpose[p]}</p>
                {text && <p className="mt-1 text-xs text-muted">{text.body}</p>}
                {current && (
                  <p className="mt-1 text-[11px] text-muted">
                    v{current.text_version} ·{' '}
                    {t.account.consents.since(formatDate(new Date(current.at)))}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={granted ? 'success' : 'neutral'}>
                  {granted ? t.account.consents.granted : t.account.consents.revoked}
                </Badge>
                {/* Política de privacidade é condição de uso: não se revoga por aqui. */}
                {p !== 'privacy_policy' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={record.isPending}
                    onClick={() => record.mutate({ purpose: p, granted: !granted })}
                  >
                    {granted ? t.account.consents.revoke : t.account.consents.grant}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- CRECI
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const creciSchema = z.object({
  creciNumber: z.string().trim().min(3, t.common.error),
  creciState: z.enum(UF),
  creciType: z.enum(['PF', 'PJ']),
  brokerageOrgId: z.string(),
});
type CreciValues = z.infer<typeof creciSchema>;

function BrokerSection() {
  const { profile, broker, memberships } = useAuth();
  const submit = useSubmitCreci();
  const brokerages = memberships.filter((m) => m.organization.type === 'brokerage');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreciValues>({
    resolver: zodResolver(creciSchema),
    defaultValues: {
      creciNumber: broker?.creci_number ?? '',
      creciState: (broker?.creci_state as CreciValues['creciState']) ?? 'RS',
      creciType: broker?.creci_type ?? 'PF',
      brokerageOrgId: broker?.brokerage_org_id ?? '',
    },
  });
  const creciState = useWatch({ control, name: 'creciState' });
  const lookupUrl = useCreciLookupUrl(creciState);

  const onSubmit = async (v: CreciValues) => {
    await submit.mutateAsync({
      userId: profile!.user_id,
      creciNumber: v.creciNumber.trim(),
      creciState: v.creciState,
      creciType: v.creciType,
      brokerageOrgId: v.brokerageOrgId || null,
      file,
      currentPath: broker?.document_path ?? null,
    });
    setFile(null);
  };

  return (
    <Section
      title={t.account.broker.title}
      description={t.account.broker.body}
      aside={
        broker && (
          <Badge tone={creciTone[broker.verification_status]}>
            {t.account.broker.status[broker.verification_status]}
          </Badge>
        )
      }
    >
      {broker?.verification_status === 'approved' && broker.next_review_at && (
        <p className="mb-4 text-xs text-muted">
          {t.account.broker.nextReview(formatDate(new Date(broker.next_review_at)))}
        </p>
      )}
      {broker?.verification_status === 'rejected' && broker.rejection_reason && (
        <Notice tone="danger" className="mb-4">
          {t.account.broker.rejectionReason}: {broker.rejection_reason}
        </Notice>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-3" noValidate>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="creciNumber">{t.account.broker.number}</Label>
          <Input id="creciNumber" {...register('creciNumber')} />
          <FieldError message={errors.creciNumber && t.account.broker.number} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="creciState">{t.account.broker.state}</Label>
          <Select id="creciState" {...register('creciState')}>
            {UF.map((uf) => (
              <option key={uf}>{uf}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="creciType">{t.account.broker.type}</Label>
          <Select id="creciType" {...register('creciType')}>
            <option value="PF">{t.account.broker.types.PF}</option>
            <option value="PJ">{t.account.broker.types.PJ}</option>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="brokerageOrgId">{t.account.broker.brokerage}</Label>
          <Select id="brokerageOrgId" {...register('brokerageOrgId')}>
            <option value="">{t.account.broker.noBrokerage}</option>
            {brokerages.map((m) => (
              <option key={m.organization_id} value={m.organization_id}>
                {m.organization.name}
              </option>
            ))}
          </Select>
          {brokerages.length === 0 && (
            <p className="text-[11px] text-muted">{t.account.broker.brokerageHint}</p>
          )}
        </div>
        <div className="sm:col-span-3">
          <Notice>
            {t.account.broker.assisted}{' '}
            {lookupUrl.data ? (
              <a
                href={lookupUrl.data}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-action hover:underline"
              >
                {t.account.broker.openLookup(creciState)}
              </a>
            ) : (
              t.account.broker.noLookup
            )}
          </Notice>
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="creciDoc">{t.account.broker.document}</Label>
          <Input
            id="creciDoc"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="py-1.5"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFileError(f && f.size > MAX_DOC_BYTES ? t.account.broker.fileTooBig : null);
              setFile(f && f.size <= MAX_DOC_BYTES ? f : null);
            }}
          />
          {broker?.document_path && !file && (
            <p className="text-xs text-muted">
              {t.account.broker.currentDocument}: {broker.document_path.split('/').pop()}
            </p>
          )}
          <FieldError message={fileError ?? undefined} />
        </div>
        {broker?.verification_status === 'approved' && (
          <p className="text-xs text-warning sm:col-span-3">{t.account.broker.changeWarning}</p>
        )}
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={submit.isPending || !!fileError}>
            {broker ? t.account.broker.resubmit : t.account.broker.submit}
          </Button>
          {submit.isSuccess && (
            <span className="text-sm text-success">{t.account.broker.submitted}</span>
          )}
          {submit.isError && <span className="text-sm text-danger">{t.common.error}</span>}
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------- Organização
const orgSchema = z.object({
  name: z.string().trim().min(2, t.common.error),
  type: z.enum(ORGANIZATION_TYPES),
  city: z.string().trim(),
  state: z.enum(UF),
});
type OrgValues = z.infer<typeof orgSchema>;

function OrganizationSection() {
  const { memberships } = useAuth();
  const create = useCreateOrganization();
  const [cnpj, setCnpj] = useState<CnpjValue | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: { type: 'developer', state: 'RS', city: '' },
  });
  const onCnpj = (v: CnpjValue | null) => {
    setCnpj(v);
    // Nome de exibição: pré-preenche com o da Receita (a pessoa pode ajustar o apelido).
    if (v?.data && !getValues('name')) setValue('name', v.data.trade_name ?? v.data.legal_name);
    if (v?.data?.city && !getValues('city')) setValue('city', v.data.city);
  };

  if (memberships.length > 0)
    return (
      <Section title={t.account.organization.title} description={t.account.organization.body}>
        <ul className="divide-y divide-border">
          {memberships.map((m) => (
            <li
              key={m.organization_id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div>
                <p className="text-sm font-medium text-ink">
                  {m.organization.name}
                  {!m.organization.active && (
                    <span className="ml-2 text-xs text-muted">
                      ({t.account.organization.inactive})
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {t.enums.organizationType[m.organization.type]} · {t.account.organization.role}:{' '}
                  {t.enums.memberRole[m.role]}
                </p>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link to={`/organizacao/${m.organization_id}`}>
                  {t.account.organization.manage}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    );

  const onSubmit = (v: OrgValues) =>
    create.mutate({
      name: v.name,
      type: v.type,
      documentId: cnpj?.cnpj ?? '',
      cnpjLookupId: cnpj?.lookupId ?? null,
      city: v.city,
      state: v.state,
    });

  return (
    <Section title={t.account.organization.title} description={t.account.organization.body}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <CnpjField
            id="org-doc"
            label={t.account.organization.document}
            value={cnpj}
            onChange={onCnpj}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="org-name">{t.account.organization.name}</Label>
          <Input id="org-name" {...register('name')} />
          <FieldError message={errors.name && t.account.organization.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-type">{t.account.organization.type}</Label>
          <Select id="org-type" {...register('type')}>
            {ORGANIZATION_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t.enums.organizationType[ty]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-city">{t.account.organization.city}</Label>
          <Input id="org-city" {...register('city')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-state">{t.account.organization.state}</Label>
          <Select id="org-state" {...register('state')}>
            {UF.map((uf) => (
              <option key={uf}>{uf}</option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <FormAlert message={create.isError ? t.common.error : null} />
          <Button type="submit" className="mt-2" disabled={create.isPending}>
            {create.isPending ? t.account.organization.creating : t.account.organization.create}
          </Button>
        </div>
      </form>
    </Section>
  );
}
