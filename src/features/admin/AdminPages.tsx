import { useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { t } from '@/i18n/pt-BR';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { AccountStatus, VerificationStatus } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, Notice, type Tone } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import { InviteForm } from '@/features/organizations/OrganizationPage';
import {
  brokerDocumentUrl,
  useAdminOrganizations,
  useAdminUsers,
  useBrokerQueue,
  useOutbox,
  useReviewAccount,
  useReviewBroker,
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
    { to: '/admin/usuarios', label: t.admin.tabs.users },
    { to: '/admin/creci', label: t.admin.tabs.creci },
    { to: '/admin/organizacoes', label: t.admin.tabs.organizations },
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
  const users = useAdminUsers();
  const review = useReviewBroker();
  const byId = useMemo(() => new Map((users.data ?? []).map((u) => [u.user_id, u])), [users.data]);

  if (queue.isLoading || users.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (queue.isError || users.isError) return <FullPageMessage title={t.common.error} />;

  const reject = (userId: string) => {
    const reason = window.prompt(t.admin.creci.reasonPrompt)?.trim();
    if (reason) review.mutate({ userId, approve: false, reason });
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          className="accent-action"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        {t.admin.creci.showAll}
      </label>
      {review.isError && <Notice tone="danger">{t.common.error}</Notice>}
      {(queue.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t.admin.creci.empty}</p>
      ) : (
        <ul className="space-y-3">
          {queue.data!.map((b) => {
            const u = byId.get(b.user_id);
            return (
              <li
                key={b.user_id}
                className="rounded-lg border border-border bg-surface p-4"
                data-testid={`creci-${u?.email}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{u?.full_name ?? '—'}</p>
                    <p className="text-xs text-muted">{u?.email}</p>
                    <p className="mt-1 text-sm">
                      CRECI <strong>{b.creci_number}</strong> / {b.creci_state}
                    </p>
                    {u && u.account_status !== 'approved' && (
                      <p className="mt-1 text-xs text-warning">{t.admin.creci.accountPending}</p>
                    )}
                    {b.rejection_reason && (
                      <p className="mt-1 text-xs text-muted">
                        {t.account.broker.rejectionReason}: {b.rejection_reason}
                      </p>
                    )}
                  </div>
                  <Badge tone={creciTone[b.verification_status]}>
                    {t.account.broker.status[b.verification_status]}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
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
                    <span className="text-xs text-muted">{t.admin.creci.noDocument}</span>
                  )}
                  {b.verification_status !== 'approved' && (
                    <Button
                      size="sm"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ userId: b.user_id, approve: true })}
                    >
                      {t.admin.creci.approve}
                    </Button>
                  )}
                  {b.verification_status !== 'rejected' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={review.isPending}
                      onClick={() => reject(b.user_id)}
                    >
                      {t.admin.creci.reject}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
