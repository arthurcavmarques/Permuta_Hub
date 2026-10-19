import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { formatArea, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, Notice, type Tone } from '@/components/ui/section';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { useOwnerAreas, type LeadStatus, type OwnerArea } from './api';

const leadTone: Record<LeadStatus, Tone> = {
  new: 'info',
  qualifying: 'warning',
  forwarded: 'warning',
  discarded: 'neutral',
  converted: 'success',
};

/** "Minhas áreas" do proprietário: números agregados, nunca quem recebeu (regra 3). */
export function OwnerAreasPage() {
  const { data, isLoading, isError } = useOwnerAreas();
  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError) return <FullPageMessage title={t.common.error} />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-primary">{t.ownerAreas.title}</h1>
        <Button asChild size="sm">
          <Link to="/cadastrar-area">
            <Plus className="h-4 w-4" />
            {t.ownerAreas.add}
          </Link>
        </Button>
      </div>
      <Notice>{t.ownerAreas.body}</Notice>
      {(data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t.ownerAreas.empty}</p>
      ) : (
        <ul className="space-y-3">
          {data!.map((a) => (
            <AreaCard key={a.lead_id} area={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AreaCard({ area: a }: { area: OwnerArea }) {
  const place = [a.neighborhood, a.city].filter(Boolean).join(', ');
  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid="owner-area">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            {a.memorial_number && <span className="text-muted">{a.memorial_number} · </span>}
            {place}
          </p>
          <p className="text-xs text-muted">
            {a.location_text}
            {a.approx_area_m2 && ` · ${formatArea(a.approx_area_m2)}`} ·{' '}
            {t.ownerAreas.sentOn(formatDate(new Date(a.created_at)))}
          </p>
        </div>
        {a.opportunity_status ? (
          <StatusBadge status={a.opportunity_status} />
        ) : (
          <Badge tone={leadTone[a.lead_status]}>{t.ownerAreas.leadStatus[a.lead_status]}</Badge>
        )}
      </div>
      {a.opportunity_status && (
        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">{t.ownerAreas.recipients}</dt>
            <dd className="tabular font-semibold text-ink">{a.recipients_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t.ownerAreas.interested}</dt>
            <dd className="tabular font-semibold text-ink">{a.interested_count}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-muted">{t.ownerAreas.responsible}</dt>
            <dd className="text-ink">
              {a.awaiting_responsible ? (
                <span className="text-warning">{t.ownerAreas.awaitingResponsible}</span>
              ) : (
                <>
                  {a.responsible_name}
                  {a.responsible_phone && (
                    <span className="block text-xs text-muted">{a.responsible_phone}</span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}
