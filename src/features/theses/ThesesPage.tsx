import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { Notice, Section } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import { useTheses } from './api';
import { ThesesList } from './ThesisEditor';

const th = t.theses;

/** Comprador: teses das empresas de que é membro (admin/buyer editam; leitura só vê). */
export function ThesesPage() {
  const { memberships } = useAuth();
  const orgs = memberships.filter((m) => m.organization.type !== 'brokerage');
  const theses = useTheses();

  if (theses.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (theses.isError) return <FullPageMessage title={t.common.error} />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">{th.title}</h1>
        <p className="mt-1 text-sm text-muted">{th.intro}</p>
      </div>
      {orgs.length === 0 && <Notice tone="warning">{th.noOrganization}</Notice>}
      {orgs.map((m) => (
        <Section key={m.organization_id} title={m.organization.name}>
          <ThesesList
            organizationId={m.organization_id}
            theses={(theses.data ?? []).filter((s) => s.organization_id === m.organization_id)}
            canEdit={m.role === 'admin' || m.role === 'buyer'}
          />
        </Section>
      ))}
    </div>
  );
}
