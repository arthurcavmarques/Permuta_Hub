import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { normalizeBrazilianPhone, UF } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/form';
import { FieldError, FormAlert, Notice } from '@/components/ui/section';
import { Wordmark } from '@/app/AppShell';
import { AgreementCard } from '@/features/agreements/AgreementCard';
import { useHasAgreement } from '@/features/agreements/api';
import { useActiveConsentTexts } from '@/features/account/api';
import type { NegotiationModel } from '@/features/opportunities/types';
import { TooManySubmissions, useSubmitOwnerLead, type RespondentRelation } from './api';

const RELATIONS = Object.keys(t.ownerLead.relations) as RespondentRelation[];
const MODELS = Object.keys(t.enums.negotiationModel) as NegotiationModel[];
const e = t.ownerLead.errors;

const schema = z
  .object({
    relation: z.enum(RELATIONS as [RespondentRelation, ...RespondentRelation[]]),
    city: z.string().trim().min(2, e.city),
    neighborhood: z.string().trim(),
    state: z.enum(UF),
    locationText: z.string().trim().min(5, e.location).max(500),
    approxArea: z
      .string()
      .trim()
      .regex(/^(\d{1,3}(\.\d{3})*|\d+)?$/, e.area),
    negotiationModels: z.array(z.enum(MODELS as [NegotiationModel, ...NegotiationModel[]])),
    notes: z.string().trim().max(2000),
    name: z.string().trim().min(3, e.name),
    phone: z
      .string()
      .refine((v) => v.trim() === '' || normalizeBrazilianPhone(v) !== null, e.phone),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === '' || z.email().safeParse(v).success, e.email),
    privacy: z.boolean(),
    website: z.string(), // honeypot
  })
  .refine((v) => v.phone.trim() !== '' || v.email !== '', { path: ['phone'], message: e.contact })
  .refine((v) => v.privacy, { path: ['privacy'], message: t.signup.errors.privacy });
type FormValues = z.infer<typeof schema>;

// Campos validados em cada etapa (o formulário é um só; as etapas só reduzem a carga no celular).
const STEPS: (keyof FormValues)[][] = [
  ['relation'],
  ['city', 'neighborhood', 'state', 'locationText'],
  ['approxArea', 'negotiationModels', 'notes'],
  ['name', 'phone', 'email', 'privacy'],
];

/**
 * Porta do proprietário (D021): formulário público em etapas, mobile-first. Sem login vira lead
 * anônimo; com conta de proprietário, exige o termo do proprietário e liga a área à conta.
 */
export function OwnerLeadPage() {
  const { session, profile } = useAuth();
  const isOwner = profile?.signup_kind === 'owner';
  if (session && profile && !isOwner) {
    return (
      <Layout>
        <Notice tone="warning">{t.ownerLead.onlyOwners}</Notice>
      </Layout>
    );
  }
  return <Layout>{isOwner ? <OwnerGate /> : <LeadForm loggedOwner={false} />}</Layout>;
}

function OwnerGate() {
  const terms = useHasAgreement('owner_terms');
  if (terms.isLoading) return <p className="text-sm text-muted">{t.common.loading}</p>;
  if (!terms.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{t.ownerLead.termsFirst}</p>
        <AgreementCard type="owner_terms" />
      </div>
    );
  }
  return <LeadForm loggedOwner />;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-primary px-4 py-4 text-primary-foreground">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <Link to={session ? '/minhas-areas' : '/entrar'}>
            <Wordmark />
          </Link>
          {!session && (
            <Link to="/entrar" className="text-sm text-primary-foreground/80 hover:underline">
              {t.auth.submit}
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        <h1 className="text-xl font-semibold text-primary">{t.ownerLead.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.ownerLead.subtitle}</p>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

function LeadForm({ loggedOwner }: { loggedOwner: boolean }) {
  const { profile, session } = useAuth();
  const submit = useSubmitOwnerLead();
  const consents = useActiveConsentTexts();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      relation: 'owner',
      state: 'RS',
      neighborhood: '',
      approxArea: '',
      negotiationModels: [],
      notes: '',
      name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
      email: session?.user.email ?? '',
      privacy: false,
      website: '',
    },
  });

  if (done) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center" role="status">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden />
        <h2 className="mt-2 text-lg font-semibold text-primary">{t.ownerLead.doneTitle}</h2>
        <p className="mt-1 text-sm text-muted">{t.ownerLead.doneBody}</p>
        {loggedOwner ? (
          <Button asChild className="mt-4">
            <Link to="/minhas-areas">{t.ownerLead.goToMyAreas}</Link>
          </Button>
        ) : (
          <p className="mt-4 text-sm">
            {t.ownerLead.createAccountHint}{' '}
            <Link to="/cadastro?tipo=owner" className="text-action hover:underline">
              {t.auth.createAccount}
            </Link>
          </p>
        )}
      </div>
    );
  }

  const next = async () => {
    if (await trigger(STEPS[step])) setStep(step + 1);
  };
  const onSubmit = (v: FormValues) =>
    submit.mutate(
      {
        relation: v.relation,
        locationText: v.locationText,
        city: v.city,
        neighborhood: v.neighborhood,
        state: v.state,
        approxAreaM2: v.approxArea ? Number(v.approxArea.replace(/\./g, '')) : null,
        negotiationModels: v.negotiationModels,
        notes: v.notes,
        name: v.name,
        phone: v.phone.trim() ? normalizeBrazilianPhone(v.phone) : null,
        email: v.email || null,
        privacyAccepted: v.privacy,
        honeypot: v.website,
      },
      { onSuccess: () => setDone(true) },
    );

  const privacy = consents.data?.privacy_policy;
  const last = step === STEPS.length - 1;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <p className="text-xs font-medium text-muted" aria-live="polite">
        {t.ownerLead.step(step + 1, STEPS.length)} · {t.ownerLead.stepTitles[step]}
      </p>

      {/* Honeypot: fora da tela e fora da ordem de tabulação. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" {...register('website')} />
        </label>
      </div>

      {step === 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t.ownerLead.relation}</legend>
          {RELATIONS.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-action"
            >
              <input type="radio" value={r} {...register('relation')} className="accent-action" />
              {t.ownerLead.relations[r]}
            </label>
          ))}
        </fieldset>
      )}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="city">{t.newArea.city}</Label>
            <Input id="city" {...register('city')} />
            <FieldError message={errors.city?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="state">{t.newArea.state}</Label>
            <Select id="state" {...register('state')}>
              {UF.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="neighborhood">{t.newArea.neighborhood}</Label>
            <Input id="neighborhood" {...register('neighborhood')} />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="locationText">{t.ownerLead.location}</Label>
            <Textarea id="locationText" {...register('locationText')} />
            <p className="text-[11px] text-muted">{t.ownerLead.locationHint}</p>
            <FieldError message={errors.locationText?.message} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="approxArea">{t.ownerLead.area}</Label>
            <Input id="approxArea" inputMode="numeric" {...register('approxArea')} />
            <FieldError message={errors.approxArea?.message} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted">{t.ownerLead.models}</legend>
            <div className="flex flex-wrap gap-4">
              {MODELS.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={m}
                    className="accent-action"
                    {...register('negotiationModels')}
                  />
                  {t.enums.negotiationModel[m]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="notes">{t.ownerLead.notes}</Label>
            <Textarea id="notes" {...register('notes')} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t.signup.fullName}</Label>
            <Input id="name" autoComplete="name" {...register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t.signup.phone}</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              {...register('phone')}
            />
            <FieldError message={errors.phone?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t.signup.email}</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            <FieldError message={errors.email?.message} />
          </div>
          <div className="flex gap-3 rounded-md border border-border p-3">
            <input
              id="privacy"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-action"
              {...register('privacy')}
            />
            <label htmlFor="privacy" className="text-sm">
              <span className="font-medium text-ink">{t.signup.privacyLabel}</span>
              {privacy && (
                <>
                  <span className="mt-1 block text-xs text-muted">{privacy.body}</span>
                  <span className="mt-1 block text-[11px] text-muted">
                    versão {privacy.version}
                  </span>
                </>
              )}
            </label>
          </div>
          <FieldError message={errors.privacy?.message} />
          <p className="text-xs text-muted">{t.ownerLead.privacyNote}</p>
        </div>
      )}

      <FormAlert
        message={
          submit.error instanceof TooManySubmissions
            ? t.ownerLead.tooMany
            : submit.isError
              ? t.common.error
              : null
        }
      />
      <div className="flex justify-between gap-2">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
            {t.common.back}
          </Button>
        ) : (
          <span />
        )}
        {last ? (
          <Button type="submit" disabled={submit.isPending || !consents.data}>
            {submit.isPending ? t.ownerLead.sending : t.ownerLead.send}
          </Button>
        ) : (
          <Button type="button" onClick={next}>
            {t.ownerLead.next}
          </Button>
        )}
      </div>
    </form>
  );
}
