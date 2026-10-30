import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CircleMinus, ExternalLink, RefreshCw, X } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { cn } from '@/lib/utils';
import { formatArea, formatDate, formatMoneyCompact } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Badge, FormAlert, Notice, Section, type Tone } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import { useBrokers } from './curation-api';
import {
  useBuyerOrganizations,
  useDecideMatch,
  useDefaultOwnerBroker,
  useMatchConfig,
  useMatches,
  useRecomputeMatches,
  useSaveMatchConfig,
  useSetDefaultOwnerBroker,
  useTheses,
  type MatchConfig,
  type MatchReason,
  type MatchRow,
  type MatchStatus,
} from '@/features/theses/api';
import { ThesesList } from '@/features/theses/ThesisEditor';

const m = t.matches;
const day = (iso: string) => formatDate(new Date(iso));
const statusTone: Record<MatchStatus, Tone> = {
  suggested: 'info',
  approved: 'success',
  rejected: 'neutral',
};

// ---------------------------------------------------------------- teses (curadoria em nome da empresa)
export function AdminThesesPage() {
  const orgs = useBuyerOrganizations();
  const [picked, setOrgId] = useState('');
  const orgId = picked || orgs.data?.[0]?.id || '';
  const theses = useTheses(orgId || undefined);

  if (orgs.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (orgs.isError) return <FullPageMessage title={t.common.error} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t.theses.adminIntro}</p>
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="thesis-org">{t.theses.organization}</Label>
        <Select id="thesis-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          {(orgs.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({t.enums.organizationType[o.type]}) · {o.theses}
            </option>
          ))}
        </Select>
      </div>
      {orgId &&
        (theses.isLoading ? (
          <p className="text-sm text-muted">{t.common.loading}</p>
        ) : (
          <ThesesList key={orgId} organizationId={orgId} theses={theses.data ?? []} canEdit />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------- matches
export function AdminMatchesPage() {
  const matches = useMatches();
  const recompute = useRecomputeMatches();
  const [status, setStatus] = useState<MatchStatus | 'all'>('suggested');

  if (matches.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (matches.isError) return <FullPageMessage title={t.common.error} />;
  const rows = (matches.data ?? []).filter((r) => status === 'all' || r.status === status);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{m.intro}</p>
      <MatchConfigCard />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="match-status">{m.filter}</Label>
          <Select
            id="match-status"
            className="w-48"
            value={status}
            onChange={(e) => setStatus(e.target.value as MatchStatus | 'all')}
          >
            {(Object.keys(m.status) as MatchStatus[]).map((s) => (
              <option key={s} value={s}>
                {m.status[s]} ({(matches.data ?? []).filter((r) => r.status === s).length})
              </option>
            ))}
            <option value="all">{m.all}</option>
          </Select>
        </div>
        <Button
          variant="secondary"
          disabled={recompute.isPending}
          onClick={() => recompute.mutate()}
        >
          <RefreshCw className={cn('h-4 w-4', recompute.isPending && 'animate-spin')} />
          {recompute.isPending ? m.recomputing : m.recompute}
        </Button>
        {recompute.data !== undefined && (
          <span className="pb-2 text-sm text-muted">{m.recomputed(recompute.data)}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{m.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <MatchCard key={r.id} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReasonLine({ r }: { r: MatchReason }) {
  const Icon = r.result === 'pass' ? Check : r.result === 'fail' ? X : CircleMinus;
  return (
    <li className="flex gap-2 text-sm">
      <Icon
        aria-label={r.result}
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          r.result === 'pass'
            ? 'text-success'
            : r.result === 'fail'
              ? 'text-danger'
              : 'text-warning',
        )}
      />
      <span>
        <span className="text-muted">{m.criteria[r.criterion] ?? r.criterion}:</span> {r.detail}
      </span>
    </li>
  );
}

function MatchCard({ row: r }: { row: MatchRow }) {
  const decide = useDecideMatch();
  const [note, setNote] = useState(r.decision_note ?? '');
  const [manual, setManual] = useState(r.manual_score?.toString() ?? '');
  const score = r.manual_score ?? r.score;
  const hard = r.reasons.filter((x) => x.kind === 'hard');
  const soft = r.reasons.filter((x) => x.kind === 'soft');
  const act = (status: MatchStatus) =>
    decide.mutate({
      matchId: r.id,
      status,
      note,
      manualScore: manual.trim() ? Math.max(0, Math.min(100, Math.round(Number(manual)))) : null,
    });

  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid="match">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {r.memorial_number}
            <span className="text-muted">
              {' · '}
              {[r.neighborhood, r.city].filter(Boolean).join(', ')}
              {r.area_m2 !== null && ` · ${formatArea(r.area_m2)}`}
              {r.asking_value !== null && ` · ${formatMoneyCompact(r.asking_value)}`}
            </span>
          </p>
          <p className="text-sm text-ink">
            → <span className="font-medium">{r.organization_name}</span>{' '}
            <span className="text-muted">({r.thesis_name})</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[r.status]}>{m.status[r.status]}</Badge>
            {!r.still_matches && <Badge tone="warning">{m.noLongerMatches}</Badge>}
            {r.decided_at && (
              <span className="text-xs text-muted">
                {m.decidedBy(r.decided_by_name ?? m.auto, day(r.decided_at))}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="tabular text-3xl font-semibold text-primary" data-testid="match-score">
            {score}
          </p>
          <p className="text-xs text-muted">
            {r.manual_score !== null ? m.adjusted(r.score) : m.score}
          </p>
        </div>
      </div>

      {r.publish_blockers.length > 0 && (
        <Notice tone="warning" className="mt-3">
          {m.blockers}
        </Notice>
      )}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{m.hard}</p>
          <ul className="space-y-1">
            {hard.map((x) => (
              <ReasonLine key={x.criterion} r={x} />
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{m.soft}</p>
          <ul className="space-y-1">
            {soft.map((x) => (
              <ReasonLine key={x.criterion} r={x} />
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor={`note-${r.id}`}>{m.note}</Label>
          <Input id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor={`score-${r.id}`}>{m.manualScore}</Label>
          <Input
            id={`score-${r.id}`}
            inputMode="numeric"
            value={manual}
            placeholder={String(r.score)}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </div>
        {r.status !== 'approved' && (
          <Button disabled={decide.isPending} onClick={() => act('approved')}>
            {m.approve}
          </Button>
        )}
        {r.status !== 'rejected' && (
          <Button variant="secondary" disabled={decide.isPending} onClick={() => act('rejected')}>
            {m.reject}
          </Button>
        )}
        {r.status !== 'suggested' && (
          <Button variant="ghost" disabled={decide.isPending} onClick={() => act('suggested')}>
            {m.reopen}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/oportunidades/${r.opportunity_id}`}>
              <ExternalLink className="h-4 w-4" />
              {m.openDossier}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/admin/areas/${r.opportunity_id}`}>{m.openArea}</Link>
          </Button>
        </div>
      </div>
      <FormAlert message={decide.isError ? t.common.error : null} />
    </li>
  );
}

function MatchConfigCard() {
  const cfg = useMatchConfig();
  return cfg.data ? <MatchConfigForm initial={cfg.data} /> : null;
}

function MatchConfigForm({ initial }: { initial: MatchConfig }) {
  const save = useSaveMatchConfig();
  const [draft, setDraft] = useState<MatchConfig>(initial);
  const [saved, setSaved] = useState(false);

  const num = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.min(100, Number(s) || 0)));
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-primary">
        {m.config.title}
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <p className="text-sm text-muted">{m.config.body}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-min">{m.config.minScore}</Label>
            <Input
              id="cfg-min"
              inputMode="numeric"
              value={draft.min_score}
              onChange={(e) => setDraft({ ...draft, min_score: num(e.target.value) ?? 0 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-auto">{m.config.autoApprove}</Label>
            <Input
              id="cfg-auto"
              inputMode="numeric"
              value={draft.auto_approve_score ?? ''}
              onChange={(e) => setDraft({ ...draft, auto_approve_score: num(e.target.value) })}
            />
            <p className="text-[11px] text-muted">{m.config.autoApproveHint}</p>
          </div>
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">{m.config.weights}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {Object.entries(draft.weights).map(([k, w]) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`w-${k}`}>{m.criteria[k] ?? k}</Label>
                <Input
                  id={`w-${k}`}
                  inputMode="numeric"
                  value={w}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      weights: { ...draft.weights, [k]: num(e.target.value) ?? 0 },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button
            disabled={save.isPending}
            onClick={() => {
              setSaved(false);
              save.mutate(draft, { onSuccess: () => setSaved(true) });
            }}
          >
            {m.config.save}
          </Button>
          {saved && <span className="text-sm text-success">{m.config.saved}</span>}
          <FormAlert message={save.isError ? t.common.error : null} />
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- corretor padrão (aba Leads)
export function DefaultBrokerCard() {
  const brokers = useBrokers();
  const current = useDefaultOwnerBroker();
  const set = useSetDefaultOwnerBroker();
  const [value, setValue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selected = value ?? current.data ?? '';

  return (
    <Section title={t.defaultBroker.title} description={t.defaultBroker.body}>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label={t.defaultBroker.title}
          className="max-w-sm"
          value={selected}
          onChange={(e) => {
            setSaved(false);
            setValue(e.target.value);
          }}
        >
          <option value="">{t.defaultBroker.none}</option>
          {(brokers.data ?? []).map((b) => (
            <option key={b.user_id} value={b.user_id}>
              {b.full_name ?? b.email} · CRECI {b.creci_number}
              {b.creci_state ? `-${b.creci_state}` : ''}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          disabled={set.isPending || selected === (current.data ?? '')}
          onClick={() => set.mutate(selected || null, { onSuccess: () => setSaved(true) })}
        >
          {t.defaultBroker.save}
        </Button>
        {saved && <span className="text-sm text-success">{t.defaultBroker.saved}</span>}
        <FormAlert message={set.isError ? t.common.error : null} />
      </div>
    </Section>
  );
}
