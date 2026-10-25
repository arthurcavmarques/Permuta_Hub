import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { t } from '@/i18n/pt-BR';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { AccountStatus, CreciStatus, VerificationStatus } from '@/lib/identity';
import { nameMatch } from '@/lib/names';
import { formatCnpj } from '@shared/cnpj';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Badge, Notice, type Tone } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import { InviteForm } from '@/features/organizations/OrganizationPage';
import {
  brokerDocumentUrl,
  useAdminOrganizations,
  useAdminUsers,
  useBrokerQueue,
  type BrokerQueueItem,
  useOutbox,
  useReviewAccount,
  useReviewBroker,
  useReviewOrganizationRegistry,
  type AdminOrganization,
  type OrgVerification,
  useSetOrganizationActive,
} from './api';

const accountTone: Record<AccountStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
};
const creciTone: Record<VerificationStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};
const day = (iso: string) => formatDate(new Date(iso));

export function AdminLayout() {
  const tabs = [
    { to: '/admin/leads', label: t.admin.tabs.leads },
    { to: '/admin/areas', label: t.admin.tabs.areas },
    { to: '/admin/publicaveis', label: t.admin.tabs.publishable },
    { to: '/admin/importacao', label: t.admin.tabs.import },
    { to: '/admin/usuarios', label: t.admin.tabs.users },
    { to: '/admin/creci', label: t.admin.tabs.creci },
    { to: '/admin/organizacoes', label: t.admin.tabs.organizations },
    { to: '/admin/termos', label: t.admin.tabs.terms },
    { to: '/admin/logs', label: t.admin.tabs.logs },
    { to: '/admin/caixa-de-saida', label: t.admin.tabs.outbox },
  ];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-primary">{t.admin.title}</h1>
      <nav
        className="mt-4 flex gap-1 overflow-x-auto border-b border-border"
        aria-label={t.admin.title}
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm',
                isActive
                  ? 'border-action font-medium text-ink'
                  : 'border-transparent text-muted hover:text-ink',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Usuários
export function AdminUsersPage() {
  const { data, isLoading, isError } = useAdminUsers();
  const review = useReviewAccount();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AccountStatus | ''>('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (u) =>
        (!status || u.account_status === status) &&
        (!q || u.email.toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q)),
    );
  }, [data, query, status]);

  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError) return <FullPageMessage title={t.common.error} />;

  const act = (userId: string, next: AccountStatus) => {
    const note =
      next === 'approved' ? undefined : (window.prompt(t.admin.users.notePrompt) ?? undefined);
    review.mutate({ userId, status: next, note });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder={t.admin.users.search}
          aria-label={t.admin.users.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="max-w-[12rem]"
          aria-label={t.admin.users.status}
          value={status}
          onChange={(e) => setStatus(e.target.value as AccountStatus | '')}
        >
          <option value="">{t.admin.users.all}</option>
          {(Object.keys(t.account.status) as AccountStatus[]).map((s) => (
            <option key={s} value={s}>
              {t.account.status[s]}
            </option>
          ))}
        </Select>
      </div>
      {review.isError && <Notice tone="danger">{t.common.error}</Notice>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t.admin.users.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{t.signup.fullName}</th>
                <th className="px-3 py-2 font-medium">{t.admin.users.kind}</th>
                <th className="px-3 py-2 font-medium">{t.admin.users.orgs}</th>
                <th className="px-3 py-2 font-medium">{t.admin.users.status}</th>
                <th className="px-3 py-2 font-medium">{t.admin.users.createdAt}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((u) => (
                <tr key={u.user_id} data-testid={`user-${u.email}`}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink">{u.full_name ?? '—'}</p>
                    <p className="text-xs text-muted">
                      {u.email}
                      {u.phone && ` · ${u.phone}`}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {u.is_platform_admin ? (
                      <Badge tone="info">{t.admin.users.platformAdmin}</Badge>
                    ) : (
                      u.signup_kind && t.enums.signupKind[u.signup_kind]
                    )}
                    {u.broker_status && (
                      <p className="mt-1 text-xs text-muted">
                        CRECI {u.creci_number}/{u.creci_state} ·{' '}
                        {t.account.broker.status[u.broker_status]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {u.organizations
                      .map((o) => `${o.name} (${t.enums.memberRole[o.role]})`)
                      .join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={accountTone[u.account_status]}>
                      {t.account.status[u.account_status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{day(u.created_at)}</td>
                  <td className="px-3 py-2">
                    {!u.is_platform_admin && (
                      <div className="flex justify-end gap-1">
                        {u.account_status !== 'approved' && (
                          <Button
                            size="sm"
                            disabled={review.isPending}
                            onClick={() => act(u.user_id, 'approved')}
                          >
                            {u.account_status === 'pending'
                              ? t.admin.users.approve
                              : t.admin.users.reactivate}
                          </Button>
                        )}
                        {u.account_status === 'pending' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={review.isPending}
                            onClick={() => act(u.user_id, 'rejected')}
                          >
                            {t.admin.users.reject}
                          </Button>
                        )}
                        {u.account_status === 'approved' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={review.isPending}
                            onClick={() => act(u.user_id, 'suspended')}
                          >
                            {t.admin.users.suspend}
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Fila de CRECI
export function AdminCreciPage() {
  const [showAll, setShowAll] = useState(false);
  const queue = useBrokerQueue(showAll);
  if (queue.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (queue.isError) return <FullPageMessage title={t.common.error} />;

  return (
    <div className="space-y-4">
      <Notice>{t.admin.creci.body}</Notice>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          className="accent-action"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        {t.admin.creci.showAll}
      </label>
      {(queue.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t.admin.creci.empty}</p>
      ) : (
        <ul className="space-y-3">
          {queue.data!.map((b) => (
            <CreciItem key={b.user_id} b={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

const CRECI_STATUSES: CreciStatus[] = ['active', 'inactive', 'suspended', 'cancelled'];

function CreciItem({ b }: { b: BrokerQueueItem }) {
  const review = useReviewBroker();
  const [name, setName] = useState(b.verified_name ?? '');
  const [status, setStatus] = useState<CreciStatus>('active');
  const match = nameMatch(name, b.full_name);
  const reject = () => {
    const reason = window.prompt(t.admin.creci.reasonPrompt)?.trim();
    if (reason) review.mutate({ userId: b.user_id, approve: false, reason });
  };

  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid={`creci-${b.email}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">{b.full_name ?? '—'}</p>
          <p className="text-xs text-muted">{b.email}</p>
          <p className="mt-1 text-sm">
            CRECI <strong>{b.creci_number}</strong> / {b.creci_state} · {b.creci_type}
            {b.brokerage_name && (
              <span className="text-muted">
                {' '}
                · {b.brokerage_name}
                {b.brokerage_cnpj && ` (${formatCnpj(b.brokerage_cnpj)})`}
              </span>
            )}
          </p>
          {b.account_status !== 'approved' && (
            <p className="mt-1 text-xs text-warning">{t.admin.creci.accountPending}</p>
          )}
          {b.rejection_reason && (
            <p className="mt-1 text-xs text-muted">
              {t.account.broker.rejectionReason}: {b.rejection_reason}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {b.sla_overdue && <Badge tone="danger">{t.admin.creci.slaOverdue}</Badge>}
          {b.review_due && <Badge tone="warning">{t.admin.creci.reviewDue}</Badge>}
          <Badge tone={creciTone[b.verification_status]}>
            {t.account.broker.status[b.verification_status]}
          </Badge>
          {b.creci_status !== 'unknown' && <Badge>{t.admin.creci.statuses[b.creci_status]}</Badge>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {b.lookup_url ? (
          <Button asChild size="sm" variant="secondary">
            <a href={b.lookup_url} target="_blank" rel="noopener noreferrer">
              {t.admin.creci.openLookup(b.creci_state)}
            </a>
          </Button>
        ) : (
          <span className="self-center text-xs text-muted">{t.admin.creci.noLookup}</span>
        )}
        {b.document_path ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () =>
              window.open(await brokerDocumentUrl(b.document_path!), '_blank', 'noopener')
            }
          >
            {t.admin.creci.openDocument}
          </Button>
        ) : (
          <span className="self-center text-xs text-muted">{t.admin.creci.noDocument}</span>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`vn-${b.user_id}`}>{t.admin.creci.verifiedName}</Label>
          <Input id={`vn-${b.user_id}`} value={name} onChange={(e) => setName(e.target.value)} />
          {match !== null && (
            <p className={cn('text-xs', match >= 0.8 ? 'text-success' : 'text-warning')}>
              {match >= 0.8 ? t.admin.creci.nameOk : t.admin.creci.nameDiverges(b.full_name ?? '')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cs-${b.user_id}`}>{t.admin.creci.creciStatus}</Label>
          <Select
            id={`cs-${b.user_id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as CreciStatus)}
          >
            {CRECI_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.admin.creci.statuses[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={review.isPending || !name.trim()}
          onClick={() =>
            review.mutate({
              userId: b.user_id,
              approve: true,
              creciStatus: status,
              verifiedName: name,
            })
          }
        >
          {status === 'active' ? t.admin.creci.approve : t.admin.creci.registerStatus}
        </Button>
        {b.verification_status !== 'rejected' && (
          <Button size="sm" variant="ghost" disabled={review.isPending} onClick={reject}>
            {t.admin.creci.reject}
          </Button>
        )}
      </div>
      {review.isError && <p className="mt-2 text-xs text-danger">{t.common.error}</p>}
    </li>
  );
}

// ---------------------------------------------------------------- Organizações
export function AdminOrganizationsPage() {
  const { data, isLoading, isError } = useAdminOrganizations();
  const setActive = useSetOrganizationActive();
  const [query, setQuery] = useState('');
  const [inviteFor, setInviteFor] = useState<string | null>(null);

  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError) return <FullPageMessage title={t.common.error} />;
  const q = query.trim().toLowerCase();
  const rows = (data ?? []).filter((o) => !q || o.name.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <Input
        className="max-w-xs"
        placeholder={t.admin.organizations.search}
        aria-label={t.admin.organizations.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t.admin.organizations.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((o) => (
            <li key={o.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">
                    {o.name}
                    {!o.active && <Badge className="ml-2">{t.admin.organizations.inactive}</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {t.enums.organizationType[o.type]}
                    {o.city && ` · ${o.city}`} · {t.admin.organizations.members}:{' '}
                    {o.members[0]?.count ?? 0}
                  </p>
                  <RegistryInfo o={o} />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setInviteFor(inviteFor === o.id ? null : o.id)}
                  >
                    {t.admin.organizations.invite}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: o.id, active: !o.active })}
                  >
                    {o.active ? t.admin.organizations.deactivate : t.admin.organizations.activate}
                  </Button>
                </div>
              </div>
              {inviteFor === o.id && (
                <div className="mt-4">
                  <InviteForm organizationId={o.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const orgTone: Record<OrgVerification, Tone> = {
  unverified: 'neutral',
  verified: 'success',
  pending_manual: 'warning',
  pending_review: 'danger',
};

function RegistryInfo({ o }: { o: AdminOrganization }) {
  const review = useReviewOrganizationRegistry();
  const pending =
    o.verification_status === 'pending_manual' || o.verification_status === 'pending_review';
  return (
    <div className="mt-1 space-y-1 text-xs" data-testid={`org-registry-${o.name}`}>
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={orgTone[o.verification_status]}>
          {t.admin.organizations.verification[o.verification_status]}
        </Badge>
        {o.cnpj && <span className="tabular text-ink">{formatCnpj(o.cnpj)}</span>}
        {o.legal_name && <span className="text-muted">{o.legal_name}</span>}
        {o.registry_status && <span className="text-muted">· {o.registry_status}</span>}
        {o.registry_source && o.registry_verified_at && (
          <span className="text-muted">
            · {t.admin.organizations.source(o.registry_source, day(o.registry_verified_at))}
          </span>
        )}
      </p>
      {o.cnae_warning && (
        <p className="text-warning">
          {t.admin.organizations.cnaeWarning}
          {o.cnae_main_description && `: ${o.cnae_main_description}`}
        </p>
      )}
      {o.verification_note && <p className="text-muted">{o.verification_note}</p>}
      {pending && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: o.id, approve: true })}
          >
            {t.admin.organizations.confirm}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={review.isPending}
            onClick={() => {
              const note = window.prompt(t.admin.organizations.refusePrompt)?.trim();
              if (note) review.mutate({ id: o.id, approve: false, note });
            }}
          >
            {t.admin.organizations.refuse}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Caixa de saída
export function AdminOutboxPage() {
  const { data, isLoading, isError } = useOutbox();
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError) return <FullPageMessage title={t.common.error} />;
  const tone = { queued: 'warning', sent: 'success', failed: 'danger' } as const;

  return (
    <div className="space-y-4">
      <Notice>{t.admin.outbox.body}</Notice>
      {(data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t.admin.outbox.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {data!.map((m) => (
            <li key={m.id} className="p-4">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                onClick={() => setOpen(open === m.id ? null : m.id)}
                aria-expanded={open === m.id}
              >
                <span>
                  <span className="block text-sm font-medium text-ink">{m.subject}</span>
                  <span className="block text-xs text-muted">
                    {m.to_email} · {day(m.created_at)}
                  </span>
                </span>
                <Badge tone={tone[m.status]}>{t.admin.outbox.statuses[m.status]}</Badge>
              </button>
              {open === m.id && (
                <pre className="mt-3 whitespace-pre-wrap break-all rounded-md bg-bg p-3 text-xs text-ink">
                  {m.body_text}
                  {m.last_error && `\n\n${m.last_error}`}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
