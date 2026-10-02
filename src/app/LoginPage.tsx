import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { t } from '@/i18n/pt-BR';
import { PRODUCT_TAGLINE } from '@/config/product';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { Wordmark } from './AppShell';

const schema = z.object({
  email: z.string().trim().email(t.auth.emailInvalid),
  password: z.string().min(1, t.auth.passwordRequired),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { session } = useAuth();
  const location = useLocation();
  const [authError, setAuthError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/oportunidades';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (values: FormValues) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) setAuthError(t.auth.invalid);
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex flex-col justify-between bg-primary p-8 text-primary-foreground md:w-2/5 md:p-12">
        <Wordmark className="text-xl" />
        <p className="mt-8 max-w-xs text-2xl font-semibold leading-snug md:text-3xl">
          {PRODUCT_TAGLINE}
        </p>
        <span aria-hidden className="mt-8 hidden h-px w-24 bg-accent md:block" />
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm space-y-5" noValidate>
          <div>
            <h1 className="text-xl font-semibold text-primary">{t.auth.title}</h1>
            <p className="mt-1 text-sm text-muted">{t.auth.subtitle}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t.auth.email}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              aria-invalid={!!errors.email}
            />
            {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t.auth.password}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              aria-invalid={!!errors.password}
            />
            {errors.password && <p className="text-xs text-danger">{errors.password.message}</p>}
          </div>
          {authError && (
            <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              {authError}
            </p>
          )}
          <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
            {isSubmitting ? t.auth.submitting : t.auth.submit}
          </Button>
        </form>
      </div>
    </div>
  );
}
