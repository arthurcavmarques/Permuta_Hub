import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { FormAlert, Notice } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import { Wordmark } from '@/app/AppShell';
import { acceptInvitation, useInvitationPreview } from './api';

export function InvitationPage() {
  const { token = '' } = useParams();
  const { session } = useAuth();
  const preview = useInvitationPreview(token);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (preview.isLoading) return <FullPageMessage title={t.common.loading} />;
  const inv = preview.data;

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await acceptInvitation(token);
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/oportunidades', { replace: true });
    } catch {
      setError(t.common.error);
      setAccepting(false);
    }
  };

  const sessionEmail = session?.user.email?.toLowerCase();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Wordmark className="text-xl text-primary" />
      <h1 className="text-xl font-semibold text-primary">{t.invitation.title}</h1>
      {!inv?.valid ? (
        <Notice tone="danger">{t.invitation.invalid}</Notice>
      ) : (
        <>
          <p className="text-sm text-ink">
            {t.invitation.body(inv.organization_name, t.enums.memberRole[inv.role].toLowerCase())}
          </p>
          <p className="text-sm text-muted">{t.invitation.forEmail(inv.email)}</p>
          {session && sessionEmail !== inv.email && (
            <Notice tone="warning">{t.invitation.wrongEmail(inv.email)}</Notice>
          )}
          <FormAlert message={error} />
          {session ? (
            <Button size="lg" onClick={accept} disabled={accepting || sessionEmail !== inv.email}>
              {accepting ? t.invitation.accepting : t.invitation.accept}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <Button asChild size="lg">
                <Link to={`/cadastro?convite=${encodeURIComponent(token)}`}>
                  {t.invitation.signupToAccept}
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/entrar" state={{ from: `/convite/${token}` }}>
                  {t.invitation.loginToAccept}
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
