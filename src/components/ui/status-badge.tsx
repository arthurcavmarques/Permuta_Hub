import { cn } from '@/lib/utils';
import { t } from '@/i18n/pt-BR';
import type { OpportunityStatus } from '@/features/opportunities/types';

// Mapa único de cores de status: o mesmo em todo o sistema.
const tone: Record<OpportunityStatus, string> = {
  captured: 'bg-neutral-bg text-neutral',
  qualifying: 'bg-warning-bg text-warning',
  qualified: 'bg-info-bg text-info',
  distributing: 'bg-info-bg text-info',
  negotiating: 'bg-success-bg text-success',
  closed: 'bg-success-bg text-success',
  lost: 'bg-danger-bg text-danger',
  archived: 'bg-neutral-bg text-neutral',
};

export function StatusBadge({
  status,
  className,
}: {
  status: OpportunityStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone[status],
        className,
      )}
    >
      {t.enums.status[status]}
    </span>
  );
}
