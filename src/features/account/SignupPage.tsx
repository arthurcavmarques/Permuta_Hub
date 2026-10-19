import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { t } from '@/i18n/pt-BR';
import { PRODUCT_TAGLINE } from '@/config/product';
import { useAuth } from '@/lib/auth';
import { normalizeBrazilianPhone } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { FieldError, FormAlert, Notice } from '@/components/ui/section';
import { Wordmark } from '@/app/AppShell';
import { acceptInvitation, useInvitationPreview } from '@/features/organizations/api';
import { EmailAlreadyRegistered, signUp, useActiveConsentTexts } from './api';

const schema = z
  .object({
    kind: z.enum(['broker', 'buyer', 'owner']),
    fullName: z.string().trim().min(3, t.signup.errors.name),
    phone: z.string().refine((v) => normalizeBrazilianPhone(v) !== null, t.signup.errors.phone),
    email: z.string().trim().toLowerCase().email(t.auth.emailInvalid),
    password: z.string().min(10, t.signup.errors.password),
    passwordConfirm: z.string(),
    privacy: z.literal(true, { error: t.signup.errors.privacy }),
    whatsapp: z.boolean(),
    emailContact: z.boolean(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: t.signup.errors.passwordMatch,
  });
type FormValues = z.input<typeof schema>;

function ConsentCheckbox({
  id,
  label,
  text,
  version,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  text?: string;
  version?: string;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-border p-3">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 accent-action" {...input} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {text && <span className="mt-1 block text-xs text-muted">{text}</span>}
        {version && <span className="mt-1 block text-[11px] text-muted">versão {version}</span>}
      </label>
    </div>
  );
}

export function SignupPage() {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('convite');
  const invite = useInvitationPreview(inviteToken);
  const consents = useActiveConsentTexts();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: params.get('tipo') === 'owner' ? 'owner' : 'buyer',
      whatsapp: false,
      emailContact: false,
    },
  });

  const preview = invite.data;
  useEffect(() => {
    if (preview?.valid) {
      setValue('email', preview.email);
      setValue('kind', preview.role === 'broker' ? 'broker' : 'buyer');
    }
  }, [preview, setValue]);

  // Já logado (e não acabou de se cadastrar aqui): nada a fazer nesta tela.
  if (session && !done && !isSubmitting) return <Navigate to="/conta" replace />;

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      setDone(true);
      await signUp({
        kind: values.kind,
        fullName: values.fullName.trim(),
        phone: normalizeBrazilianPhone(values.phone)!,
        email: values.email.trim().toLowerCase(),
        password: values.password,
        whatsapp: values.whatsapp,
        emailContact: values.emailContact,
      });
      if (inviteToken && preview?.valid) {
        await acceptInvitation(inviteToken);
        await refresh(); // convite aprova a conta: o guard precisa do perfil novo
        navigate('/oportunidades', { replace: true });
      } else navigate(values.kind === 'owner' ? '/minhas-areas' : '/conta', { replace: true });
    } catch (e) {
      setDone(false);
      setFormError(
        e instanceof EmailAlreadyRegistered ? t.signup.errors.exists : t.signup.errors.generic,
      );
    }
  };

  const texts = consents.data ?? {};
  const lockedEmail = !!preview?.valid;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex flex-col justify-between bg-primary p-8 text-primary-foreground md:w-2/5 md:p-12">
        <Wordmark className="text-xl" />
        <p className="mt-8 max-w-xs text-2xl font-semibold leading-snug md:text-3xl">
          {PRODUCT_TAGLINE}
        </p>
        <span aria-hidden className="mt-8 hidden h-px w-24 bg-accent md:block" />
      </div>
      <div className="flex flex-1 items-start justify-center p-6 md:items-center">
        <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-md space-y-5" noValidate>
          <div>
            <h1 className="text-xl font-semibold text-primary">{t.signup.title}</h1>
            <p className="mt-1 text-sm text-muted">{t.signup.subtitle}</p>
          </div>
          {preview?.valid && <Notice>{t.signup.invitedAs(preview.organization_name)}</Notice>}

          {!lockedEmail && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted">{t.signup.kind}</legend>
              {(['buyer', 'broker', 'owner'] as const).map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-action"
                >
                  <input type="radio" value={k} {...register('kind')} className="accent-action" />
                  {t.signup.kinds[k]}
                </label>
              ))}
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="fullName">{t.signup.fullName}</Label>
            <Input
              id="fullName"
              autoComplete="name"
              {...register('fullName')}
              aria-invalid={!!errors.fullName}
            />
            <FieldError message={errors.fullName?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t.signup.phone}</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              {...register('phone')}
              aria-invalid={!!errors.phone}
            />
            <FieldError message={errors.phone?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t.signup.email}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              readOnly={lockedEmail}
              {...register('email')}
              aria-invalid={!!errors.email}
            />
            <FieldError message={errors.email?.message} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="password">{t.signup.password}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
                aria-invalid={!!errors.password}
              />
              <FieldError message={errors.password?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="passwordConfirm">{t.signup.passwordConfirm}</Label>
              <Input
                id="passwordConfirm"
                type="password"
                autoComplete="new-password"
                {...register('passwordConfirm')}
                aria-invalid={!!errors.passwordConfirm}
              />
              <FieldError message={errors.passwordConfirm?.message} />
            </div>
          </div>

          {consents.isError && <FormAlert message={t.signup.errors.consentTexts} />}
          <div className="space-y-2">
            <ConsentCheckbox
              id="privacy"
              label={t.signup.privacyLabel}
              text={texts.privacy_policy?.body}
              version={texts.privacy_policy?.version}
              {...register('privacy')}
            />
            <FieldError message={errors.privacy?.message} />
            <ConsentCheckbox
              id="whatsapp"
              label={t.signup.whatsappLabel}
              text={texts.whatsapp?.body}
              version={texts.whatsapp?.version}
              {...register('whatsapp')}
            />
            <ConsentCheckbox
              id="emailContact"
              label={t.signup.emailLabel}
              text={texts.email?.body}
              version={texts.email?.version}
              {...register('emailContact')}
            />
          </div>

          <FormAlert message={formError} />
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isSubmitting || !consents.data}
          >
            {isSubmitting ? t.signup.submitting : t.signup.submit}
          </Button>
          <p className="text-center text-sm text-muted">
            {t.signup.haveAccount}{' '}
            <Link to="/entrar" className="text-action hover:underline">
              {t.signup.signIn}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
