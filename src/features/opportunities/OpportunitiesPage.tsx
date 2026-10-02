import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { List, Map as MapIcon } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { cn } from '@/lib/utils';
import { formatArea, formatCoefficient } from '@/lib/format';
import { OpportunitiesMap, type MapPoint } from '@/lib/map';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { useAuth } from '@/lib/auth';
import { useBlindOpportunities } from './api';
import {
  emptyFilters,
  filterOpportunities,
  filtersFromParams,
  filtersToParams,
  type OpportunityFilters,
} from './filters';
import type { BlindOpportunity, OpportunityStatus } from './types';

const STATUSES = Object.keys(t.enums.status) as OpportunityStatus[];

export function OpportunitiesPage() {
  const { isPlatformAdmin } = useAuth();
  const { data, isLoading, isError, refetch } = useBlindOpportunities();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  const all = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(() => filterOpportunities(all, filters), [all, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const landTypes = useMemo(
    () =>
      [...new Set(all.map((o) => o.land_type).filter((x): x is string => !!x))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    [all],
  );
  const points: MapPoint[] = useMemo(
    () =>
      filtered
        .filter((o) => o.approx_lat !== null && o.approx_lng !== null)
        .map((o) => ({ id: o.id, lat: o.approx_lat!, lng: o.approx_lng!, label: o.title })),
    [filtered],
  );

  const update = (patch: Partial<OpportunityFilters>) =>
    setParams(filtersToParams({ ...filters, ...patch }), { replace: true });

  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError)
    return (
      <div className="py-24 text-center">
        <FullPageMessage title={t.common.error} />
        <Button variant="secondary" onClick={() => refetch()}>
          {t.common.retry}
        </Button>
      </div>
    );
  if (!all.length && !isPlatformAdmin)
    return <FullPageMessage title={t.auth.noAccessTitle} body={t.auth.noAccessBody} />;

  const numberOrNull = (v: string) => (v === '' ? null : Number(v));

  return (
    <div className="mx-auto flex max-w-7xl flex-col px-4 py-4 md:h-[calc(100vh-3.5rem)]">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-primary">{t.list.title}</h1>
        <span className="tabular text-sm text-muted" aria-live="polite">
          {t.list.count(filtered.length)}
        </span>
      </div>

      <form
        className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
        onSubmit={(e) => e.preventDefault()}
        role="search"
      >
        <div className="col-span-2 space-y-1 md:col-span-1">
          <Label htmlFor="f-region">{t.list.filters.region}</Label>
          <Input
            id="f-region"
            value={filters.region}
            placeholder={t.list.filters.regionPlaceholder}
            onChange={(e) => update({ region: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-min">{t.list.filters.areaMin}</Label>
          <Input
            id="f-min"
            type="number"
            inputMode="numeric"
            min={0}
            value={filters.areaMin ?? ''}
            onChange={(e) => update({ areaMin: numberOrNull(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-max">{t.list.filters.areaMax}</Label>
          <Input
            id="f-max"
            type="number"
            inputMode="numeric"
            min={0}
            value={filters.areaMax ?? ''}
            onChange={(e) => update({ areaMax: numberOrNull(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-type">{t.list.filters.landType}</Label>
          <Select
            id="f-type"
            value={filters.landType}
            onChange={(e) => update({ landType: e.target.value })}
          >
            <option value="">{t.list.filters.any}</option>
            {landTypes.map((lt) => (
              <option key={lt} value={lt}>
                {lt}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-status">{t.list.filters.status}</Label>
          <Select
            id="f-status"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as OpportunityStatus | '' })}
          >
            <option value="">{t.list.filters.any}</option>
            {STATUSES.filter((s) => s !== 'archived').map((s) => (
              <option key={s} value={s}>
                {t.enums.status[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 flex items-end md:col-span-1">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setParams(filtersToParams(emptyFilters), { replace: true })}
          >
            {t.list.clearFilters}
          </Button>
        </div>
      </form>

      {/* Alternância lista/mapa só no celular; no desktop os dois aparecem lado a lado. */}
      <div
        className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-border bg-surface p-1 md:hidden"
        role="tablist"
      >
        {(['list', 'map'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={mobileView === v}
            onClick={() => setMobileView(v)}
            className={cn(
              'flex items-center justify-center gap-2 rounded py-2 text-sm font-medium',
              mobileView === v ? 'bg-primary text-primary-foreground' : 'text-muted',
            )}
          >
            {v === 'list' ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
            {v === 'list' ? t.list.viewList : t.list.viewMap}
          </button>
        ))}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 gap-4">
        <ul
          className={cn(
            'w-full space-y-2 overflow-y-auto pb-4 md:block md:w-[420px] md:shrink-0',
            mobileView === 'map' && 'hidden',
          )}
          aria-label={t.list.title}
        >
          {filtered.length === 0 && (
            <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
              {t.list.empty}
            </li>
          )}
          {filtered.map((o) => (
            <OpportunityCard
              key={o.id}
              o={o}
              selected={o.id === selectedId}
              onHover={() => setSelectedId(o.id)}
            />
          ))}
        </ul>
        <div
          className={cn(
            'h-[70vh] w-full overflow-hidden rounded-lg border border-border md:block md:h-auto',
            mobileView === 'list' && 'hidden',
          )}
        >
          <OpportunitiesMap
            points={points}
            selectedId={selectedId}
            onSelect={(id) =>
              selectedId === id ? navigate(`/oportunidades/${id}`) : setSelectedId(id)
            }
          />
        </div>
      </div>
    </div>
  );
}

function OpportunityCard({
  o,
  selected,
  onHover,
}: {
  o: BlindOpportunity;
  selected: boolean;
  onHover: () => void;
}) {
  return (
    <li>
      <Link
        to={`/oportunidades/${o.id}`}
        onMouseEnter={onHover}
        onFocus={onHover}
        className={cn(
          'block rounded-lg border bg-surface p-4 shadow-card transition-colors hover:border-action',
          selected ? 'border-action' : 'border-border',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-medium tracking-wide text-accent-text-on-light">
            {o.memorial_number}
          </span>
          <StatusBadge status={o.status} />
        </div>
        <p className="mt-1 font-semibold leading-snug text-primary">{o.title}</p>
        <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted">{t.dossier.area}</dt>
            <dd className="font-medium text-ink">{formatArea(o.area_m2_approx) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">{t.dossier.zoning}</dt>
            <dd className="truncate font-medium text-ink">{o.zoning ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">{t.dossier.coefficient}</dt>
            <dd className="font-medium text-ink">{formatCoefficient(o.coefficient) ?? '—'}</dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}
