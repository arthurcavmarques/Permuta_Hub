import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, ExternalLink, Pencil } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { cn } from '@/lib/utils';
import { formatArea, formatDate } from '@/lib/format';
import { toCsv } from '@/lib/csv';
import { OpportunitiesMap } from '@/lib/map';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/form';
import { Badge, FormAlert, Notice, Section, type Tone } from '@/components/ui/section';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { useBlindOpportunities } from '@/features/opportunities/api';
import type { MandateStatus, OpportunityStatus } from '@/features/opportunities/types';
import type { LeadStatus } from '@/features/owner/api';
import {
  useAccessLog,
  useAddNote,
  useAdminAreas,
  useBlockers,
  useBrokers,
  useConvertLead,
  useCurateArea,
  useCurateLead,
  useLeads,
  useOpportunityEvents,
  usePublish,
  type AccessLogFilters,
  type AdminArea,
  type Lead,
} from './curation-api';
import { DefaultBrokerCard } from './MatchPages';

const c = t.curation;
const day = (iso: string) => formatDate(new Date(iso));
const leadTone: Record<LeadStatus, Tone> = {
  new: 'info',
  qualifying: 'warning',
  forwarded: 'warning',
  discarded: 'neutral',
  converted: 'success',
};

function useBrokerNames() {
  const brokers = useBrokers();
  return useMemo(
    () => new Map((brokers.data ?? []).map((b) => [b.user_id, b.full_name ?? b.email])),
    [brokers.data],
  );
}

// ---------------------------------------------------------------- leads
export function AdminLeadsPage() {
  const leads = useLeads();
  const [status, setStatus] = useState<LeadStatus | 'open'>('open');
  if (leads.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (leads.isError) return <FullPageMessage title={t.common.error} />;
  const rows = (leads.data ?? []).filter((l) =>
    status === 'open' ? !['discarded', 'converted'].includes(l.status) : l.status === status,
  );
  return (
    <div className="space-y-4">
      <DefaultBrokerCard />
      <Select
        className="max-w-xs"
        aria-label={c.leads.filter}
        value={status}
        onChange={(e) => setStatus(e.target.value as LeadStatus | 'open')}
      >
        <option value="open">{c.leads.open}</option>
        {(Object.keys(t.ownerAreas.leadStatus) as LeadStatus[]).map((s) => (
          <option key={s} value={s}>
            {t.ownerAreas.leadStatus[s]}
          </option>
        ))}
      </Select>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{c.leads.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((l) => (
            <LeadCard key={l.id} lead={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadCard({ lead: l }: { lead: Lead }) {
  const navigate = useNavigate();
  const brokers = useBrokers();
  const names = useBrokerNames();
  const curate = useCurateLead();
  const convert = useConvertLead();
  const [note, setNote] = useState('');
  const [broker, setBroker] = useState('');
  const closed = l.status === 'converted' || l.status === 'discarded';

  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid="lead">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            {[l.neighborhood, l.city, l.state].filter(Boolean).join(', ')}
            {l.approx_area_m2 && (
              <span className="text-muted"> · {formatArea(l.approx_area_m2)}</span>
            )}
          </p>
          <p className="text-sm text-ink">{l.location_text}</p>
          <p className="mt-1 text-xs text-muted">
            {t.ownerLead.relations[l.respondent_relation]} · {l.name}
            {l.phone && ` · ${l.phone}`}
            {l.email && ` · ${l.email}`} · {c.leads.sources[l.source]} · {day(l.created_at)}
          </p>
          {l.negotiation_models.length > 0 && (
            <p className="text-xs text-muted">
              {l.negotiation_models.map((m) => t.enums.negotiationModel[m]).join(', ')}
            </p>
          )}
          {l.notes && <p className="mt-1 text-sm text-ink">“{l.notes}”</p>}
          {l.status_note && (
            <p className="mt-1 text-xs text-muted">
              {c.leads.lastNote}: {l.status_note}
            </p>
          )}
          {l.assigned_to && (
            <p className="text-xs text-muted">
              {c.leads.assignedTo}: {names.get(l.assigned_to) ?? '—'}
            </p>
          )}
        </div>
        <Badge tone={leadTone[l.status]}>{t.ownerAreas.leadStatus[l.status]}</Badge>
      </div>
      {l.converted_opportunity_id && (
        <Link
          to={`/admin/areas/${l.converted_opportunity_id}`}
          className="mt-2 inline-block text-sm text-action hover:underline"
        >
          {c.leads.openArea}
        </Link>
      )}
      {!closed && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <Input
            aria-label={c.leads.note}
            placeholder={c.leads.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={curate.isPending}
              onClick={() => curate.mutate({ leadId: l.id, status: 'qualifying', note })}
            >
              {note.trim() ? c.leads.requestInfo : c.leads.qualify}
            </Button>
            <Select
              className="h-9 max-w-[14rem]"
              aria-label={c.leads.broker}
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
            >
              <option value="">{c.leads.broker}</option>
              {(brokers.data ?? []).map((b) => (
                <option key={b.user_id} value={b.user_id}>
                  {b.full_name ?? b.email} · CRECI {b.creci_number}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!broker || curate.isPending}
              onClick={() =>
                curate.mutate({ leadId: l.id, status: 'forwarded', note, assignTo: broker })
              }
            >
              {c.leads.forward}
            </Button>
            <Button
              size="sm"
              disabled={convert.isPending}
              onClick={() =>
                convert.mutate(l.id, { onSuccess: (id) => navigate(`/admin/areas/${id}`) })
              }
            >
              {c.leads.convert}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!note.trim() || curate.isPending}
              title={c.leads.discardHint}
              onClick={() => curate.mutate({ leadId: l.id, status: 'discarded', note })}
            >
              {c.leads.discard}
            </Button>
          </div>
          <FormAlert message={curate.isError || convert.isError ? t.common.error : null} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- pipeline
const PIPELINE: OpportunityStatus[] = [
  'captured',
  'qualifying',
  'qualified',
  'distributing',
  'negotiating',
  'closed',
  'lost',
];

export function AdminAreasPage() {
  const areas = useAdminAreas();
  const names = useBrokerNames();
  const [view, setView] = useState<'kanban' | 'table' | 'map'>('kanban');
  const [query, setQuery] = useState('');
  if (areas.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (areas.isError) return <FullPageMessage title={t.common.error} />;
  const q = query.trim().toLowerCase();
  const rows = (areas.data ?? []).filter(
    (a) =>
      !q ||
      a.memorial_number.toLowerCase().includes(q) ||
      `${a.neighborhood ?? ''} ${a.city ?? ''}`.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder={c.areas.search}
          aria-label={c.areas.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex rounded-md border border-border" role="tablist">
          {(['kanban', 'table', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'px-3 py-1.5 text-sm',
                view === v ? 'bg-action text-action-foreground' : 'text-muted',
              )}
            >
              {c.areas.views[v]}
            </button>
          ))}
        </div>
        <Button asChild size="sm" variant="secondary" className="ml-auto">
          <Link to="/areas/nova">{c.areas.new}</Link>
        </Button>
      </div>
      {view === 'kanban' && <Kanban rows={rows} names={names} />}
      {view === 'table' && <AreasTable rows={rows} names={names} />}
      {view === 'map' && <AreasMap rows={rows} />}
    </div>
  );
}

function AreaCardMini({ a, names }: { a: AdminArea; names: Map<string, string> }) {
  return (
    <Link
      to={`/admin/areas/${a.id}`}
      className="block rounded-md border border-border bg-surface p-3 text-sm hover:border-action"
      data-testid={`area-${a.memorial_number}`}
    >
      <p className="font-medium text-ink">{a.memorial_number}</p>
      <p className="text-xs text-muted">
        {[a.neighborhood, a.city].filter(Boolean).join(', ') || '—'}
        {a.area_m2 && ` · ${formatArea(a.area_m2)}`}
      </p>
      <p className="mt-1 text-xs text-muted">
        {a.responsible_party_user_id
          ? (names.get(a.responsible_party_user_id) ?? c.areas.someone)
          : c.areas.noResponsible}{' '}
        · {t.enums.mandate[a.mandate_status]}
      </p>
    </Link>
  );
}

function Kanban({ rows, names }: { rows: AdminArea[]; names: Map<string, string> }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {PIPELINE.map((s) => {
        const col = rows.filter((a) => a.status === s);
        return (
          <section
            key={s}
            className="w-64 shrink-0 rounded-lg bg-bg p-2"
            aria-label={t.enums.status[s]}
          >
            <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-muted">
              {t.enums.status[s]}
              <span className="tabular">{col.length}</span>
            </h2>
            <div className="space-y-2">
              {col.map((a) => (
                <AreaCardMini key={a.id} a={a} names={names} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AreasTable({ rows, names }: { rows: AdminArea[]; names: Map<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">MD</th>
            <th className="px-3 py-2 font-medium">{c.areas.place}</th>
            <th className="px-3 py-2 font-medium">{t.dossier.area}</th>
            <th className="px-3 py-2 font-medium">{t.dossier.status}</th>
            <th className="px-3 py-2 font-medium">{c.areas.responsible}</th>
            <th className="px-3 py-2 font-medium">{c.areas.mandate}</th>
            <th className="px-3 py-2 font-medium">{c.areas.updated}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="px-3 py-2">
                <Link
                  to={`/admin/areas/${a.id}`}
                  className="font-medium text-action hover:underline"
                >
                  {a.memorial_number}
                </Link>
              </td>
              <td className="px-3 py-2">{[a.neighborhood, a.city].filter(Boolean).join(', ')}</td>
              <td className="tabular px-3 py-2">{formatArea(a.area_m2) ?? '—'}</td>
              <td className="px-3 py-2">
                <StatusBadge status={a.status} />
              </td>
              <td className="px-3 py-2 text-xs">
                {a.responsible_party_user_id
                  ? (names.get(a.responsible_party_user_id) ?? c.areas.someone)
                  : c.areas.noResponsible}
              </td>
              <td className="px-3 py-2 text-xs">{t.enums.mandate[a.mandate_status]}</td>
              <td className="px-3 py-2 text-xs text-muted">{day(a.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AreasMap({ rows }: { rows: AdminArea[] }) {
  const blind = useBlindOpportunities();
  const navigate = useNavigate();
  const ids = new Set(rows.map((r) => r.id));
  const points = (blind.data ?? [])
    .filter((o) => ids.has(o.id) && o.approx_lat !== null && o.approx_lng !== null)
    .map((o) => ({ id: o.id, lat: o.approx_lat!, lng: o.approx_lng!, label: o.memorial_number }));
  return (
    <div className="h-[28rem] overflow-hidden rounded-lg border border-border">
      <OpportunitiesMap points={points} onSelect={(id) => navigate(`/admin/areas/${id}`)} />
    </div>
  );
}

// ---------------------------------------------------------------- área (detalhe da curadoria)
const MANDATES = Object.keys(t.enums.mandate) as MandateStatus[];
// Status que a curadoria muda direto; qualificada só pelo "Publicar" (checa o que falta).
const MANUAL_STATUSES: OpportunityStatus[] = [
  'captured',
  'qualifying',
  'distributing',
  'negotiating',
  'closed',
  'lost',
  'archived',
];

export function AdminAreaPage() {
  const { id = '' } = useParams();
  const areas = useAdminAreas();
  const a = areas.data?.find((x) => x.id === id);
  if (areas.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (!a) return <FullPageMessage title={t.dossier.notFound} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-primary">{a.memorial_number}</h2>
        <StatusBadge status={a.status} />
        {a.published_at && <Badge tone="success">{c.area.publishedOn(day(a.published_at))}</Badge>}
        <div className="ml-auto flex gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link to={`/areas/${a.id}/editar`}>
              <Pencil className="h-4 w-4" />
              {t.editor.edit}
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to={`/oportunidades/${a.id}`}>
              <ExternalLink className="h-4 w-4" />
              {t.editor.previewBlind}
            </Link>
          </Button>
        </div>
      </div>
      <PublishBox a={a} />
      <ControlsBox a={a} />
      <Timeline id={a.id} />
    </div>
  );
}

function PublishBox({ a }: { a: AdminArea }) {
  const blockers = useBlockers(a.id);
  const publish = usePublish(a.id);
  const [note, setNote] = useState('');
  const list = blockers.data ?? [];
  return (
    <Section title={c.area.publishTitle} description={c.area.publishBody}>
      {blockers.isLoading ? (
        <p className="text-sm text-muted">{t.common.loading}</p>
      ) : list.length ? (
        <Notice tone="warning" title={c.area.missing}>
          <ul className="list-disc pl-5" data-testid="blockers">
            {list.map((b) => (
              <li key={b}>{c.blockers[b]}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success">{a.published_at ? c.area.isPublished : c.area.ready}</Notice>
      )}
      {!a.published_at && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            className="max-w-md"
            aria-label={c.area.note}
            placeholder={c.area.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            disabled={list.length > 0 || publish.isPending}
            onClick={() => publish.mutate(note || null)}
          >
            {c.area.publish}
          </Button>
        </div>
      )}
      <FormAlert message={publish.isError ? t.common.error : null} />
    </Section>
  );
}

function ControlsBox({ a }: { a: AdminArea }) {
  const brokers = useBrokers();
  const curate = useCurateArea(a.id);
  const [note, setNote] = useState('');
  const run = (v: Parameters<typeof curate.mutate>[0]) =>
    curate.mutate({ ...v, note }, { onSuccess: () => setNote('') });

  return (
    <Section title={c.area.controlsTitle} description={c.area.controlsBody}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ctl-mandate">{c.areas.mandate}</Label>
          <Select
            id="ctl-mandate"
            value={a.mandate_status}
            disabled={curate.isPending}
            onChange={(e) => run({ mandate: e.target.value as MandateStatus })}
          >
            {MANDATES.map((m) => (
              <option key={m} value={m}>
                {t.enums.mandate[m]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctl-resp">{c.areas.responsible}</Label>
          <Select
            id="ctl-resp"
            value={a.responsible_party_user_id ?? ''}
            disabled={curate.isPending}
            onChange={(e) =>
              e.target.value
                ? run({ responsibleUserId: e.target.value })
                : run({ clearResponsible: true })
            }
          >
            <option value="">{c.areas.noResponsible}</option>
            {(brokers.data ?? []).map((b) => (
              <option key={b.user_id} value={b.user_id}>
                {b.full_name ?? b.email}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctl-status">{t.dossier.status}</Label>
          <Select
            id="ctl-status"
            value={MANUAL_STATUSES.includes(a.status) ? a.status : ''}
            disabled={curate.isPending}
            onChange={(e) => e.target.value && run({ status: e.target.value as OpportunityStatus })}
          >
            {!MANUAL_STATUSES.includes(a.status) && (
              <option value="">{t.enums.status[a.status]}</option>
            )}
            {MANUAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.enums.status[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="ctl-note">{c.area.changeNote}</Label>
          <Input id="ctl-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {a.published_at && (
        <Button
          className="mt-3"
          size="sm"
          variant="ghost"
          disabled={curate.isPending}
          onClick={() => run({ unpublish: true, status: 'qualifying' })}
        >
          {c.area.unpublish}
        </Button>
      )}
      <FormAlert message={curate.isError ? c.area.changeError : null} />
    </Section>
  );
}

function Timeline({ id }: { id: string }) {
  const events = useOpportunityEvents(id);
  const add = useAddNote(id);
  const names = useBrokerNames();
  const [note, setNote] = useState('');
  const label = (ev: NonNullable<typeof events.data>[number]) => {
    switch (ev.kind) {
      case 'status':
        return c.events.status(
          t.enums.status[ev.from_value as OpportunityStatus] ?? ev.from_value ?? '',
          t.enums.status[ev.to_value as OpportunityStatus] ?? ev.to_value ?? '',
        );
      case 'mandate':
        return c.events.mandate(t.enums.mandate[ev.to_value as MandateStatus] ?? ev.to_value ?? '');
      case 'responsible':
        return c.events.responsible(
          ev.to_value ? (names.get(ev.to_value) ?? c.areas.someone) : c.areas.noResponsible,
        );
      default:
        return c.events.kinds[ev.kind];
    }
  };
  return (
    <Section title={c.area.historyTitle}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) add.mutate(note, { onSuccess: () => setNote('') });
        }}
      >
        <Textarea
          className="min-h-10"
          aria-label={c.area.addNote}
          placeholder={c.area.addNote}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!note.trim() || add.isPending}>
          {c.area.saveNote}
        </Button>
      </form>
      <ol className="space-y-3 border-l border-border pl-4" data-testid="timeline">
        {(events.data ?? []).map((ev) => (
          <li key={ev.id} className="text-sm">
            <p className="text-ink">{label(ev)}</p>
            {ev.note && <p className="text-muted">“{ev.note}”</p>}
            <p className="text-xs text-muted">{new Date(ev.at).toLocaleString('pt-BR')}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------- logs de acesso
const ACTIONS = Object.keys(t.curation.logs.actions);

export function AdminLogsPage() {
  const [f, setF] = useState<AccessLogFilters>({ from: '', to: '', action: '', memorial: '' });
  const log = useAccessLog(f);
  const rows = log.data ?? [];
  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        seq: r.seq,
        data_hora: new Date(r.at).toLocaleString('pt-BR'),
        acao: r.action,
        nome: r.actor_name,
        email: r.actor_email,
        recurso: r.resource_type,
        md: r.memorial_number,
        ip: r.ip,
        navegador: r.user_agent,
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-de-acesso-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Notice>{c.logs.body}</Notice>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="log-from">{c.logs.from}</Label>
          <Input
            id="log-from"
            type="date"
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-to">{c.logs.to}</Label>
          <Input
            id="log-to"
            type="date"
            value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-action">{c.logs.action}</Label>
          <Select
            id="log-action"
            value={f.action}
            onChange={(e) => setF({ ...f, action: e.target.value })}
          >
            <option value="">{c.logs.all}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {c.logs.actions[a as keyof typeof c.logs.actions]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-md">MD</Label>
          <Input
            id="log-md"
            value={f.memorial}
            onChange={(e) => setF({ ...f, memorial: e.target.value })}
          />
        </div>
        <Button size="sm" variant="secondary" disabled={!rows.length} onClick={exportCsv}>
          <Download className="h-4 w-4" />
          {c.logs.export}
        </Button>
      </div>
      {log.isLoading ? (
        <p className="text-sm text-muted">{t.common.loading}</p>
      ) : log.isError ? (
        <FormAlert message={t.common.error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{c.logs.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm" data-testid="access-log">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{c.logs.when}</th>
                <th className="px-3 py-2 font-medium">{c.logs.action}</th>
                <th className="px-3 py-2 font-medium">{c.logs.who}</th>
                <th className="px-3 py-2 font-medium">MD</th>
                <th className="px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.seq}>
                  <td className="tabular whitespace-nowrap px-3 py-2 text-xs">
                    {new Date(r.at).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-2">
                    {c.logs.actions[r.action as keyof typeof c.logs.actions] ?? r.action}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.actor_name ?? '—'}
                    {r.actor_email && <span className="block text-muted">{r.actor_email}</span>}
                  </td>
                  <td className="px-3 py-2">{r.memorial_number ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- corretor: leads encaminhados
export function BrokerLeadsPage() {
  const leads = useLeads();
  if (leads.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (leads.isError) return <FullPageMessage title={t.common.error} />;
  const rows = leads.data ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold text-primary">{c.brokerLeads.title}</h1>
      <Notice>{c.brokerLeads.body}</Notice>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{c.brokerLeads.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((l) => (
            <li key={l.id} className="rounded-lg border border-border bg-surface p-4">
              <p className="font-medium text-ink">
                {[l.neighborhood, l.city].filter(Boolean).join(', ')}
                {l.approx_area_m2 && ` · ${formatArea(l.approx_area_m2)}`}
              </p>
              <p className="text-sm">{l.location_text}</p>
              <p className="mt-1 text-sm">
                {l.name}
                {l.phone && ` · ${l.phone}`}
                {l.email && ` · ${l.email}`}
              </p>
              {l.status_note && <p className="text-xs text-muted">“{l.status_note}”</p>}
              {l.converted_opportunity_id && (
                <Link
                  to={`/areas/${l.converted_opportunity_id}/editar`}
                  className="mt-2 inline-block text-sm text-action hover:underline"
                >
                  {c.brokerLeads.edit}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
