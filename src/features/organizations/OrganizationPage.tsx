import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { MemberRole } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Badge, FieldError, FormAlert, Notice, Section } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import {
  useCreateInvitation,
  useOrganization,
  useRemoveMember,
  useRevokeInvitation,
  type CreatedInvitation,
} from './api';

const ROLES: MemberRole[] = ['buyer', 'broker', 'viewer', 'admin'];

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(t.auth.emailInvalid),
  role: z.enum(['admin', 'broker', 'buyer', 'viewer']),
});
type InviteValues = z.infer<typeof inviteSchema>;

/** Link de convite: aparece uma única vez (o banco guarda só o hash do token). */
export function InvitationLink({ invitation }: { invitation: CreatedInvitation }) {
  const [copied, setCopied] = useState(false);
  return (
    <Notice tone="success" title={t.organization.linkTitle}>
      <p>{t.organization.linkBody}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input
          readOnly
          value={invitation.accept_url}
          className="flex-1 font-mono text-xs"
          aria-label="Link do convite"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(invitation.accept_url);
            setCopied(true);
          }}
        >
          {copied ? t.organization.copied : t.organization.copy}
        </Button>
      </div>
    </Notice>
  );
}

export function InviteForm({ organizationId }: { organizationId: string }) {
  const create = useCreateInvitation(organizationId);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'buyer' },
  });

  const onSubmit = async (v: InviteValues) => {
    setCreated(await create.mutateAsync(v));
    reset({ email: '', role: v.role });
  };

  return (
    <div className="space-y-3">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">{t.organization.inviteEmail}</Label>
          <Input id="invite-email" type="email" {...register('email')} />
          <FieldError message={errors.email?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">{t.organization.inviteRole}</Label>
          <Select id="invite-role" {...register('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.enums.memberRole[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t.organization.sending : t.organization.send}
        </Button>
      </form>
      <FormAlert message={create.isError ? t.common.error : null} />
      {created && <InvitationLink invitation={created} />}
    </div>
  );
}

export function OrganizationPage() {
  const { id = '' } = useParams();
  const { session, memberships, isPlatformAdmin } = useAuth();
  const { data, isLoading, isError } = useOrganization(id);
  const revoke = useRevokeInvitation(id);
  const remove = useRemoveMember(id);

  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError || !data?.organization) return <FullPageMessage title={t.dossier.notFound} />;

  const org = data.organization;
  const isOrgAdmin =
    isPlatformAdmin || memberships.some((m) => m.organization_id === id && m.role === 'admin');

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">{org.name}</h1>
        <p className="text-sm text-muted">
          {t.enums.organizationType[org.type]}
          {org.city && ` · ${org.city}`}
          {org.state && `/${org.state}`}
        </p>
      </div>

      <Section title={t.organization.members}>
        <ul className="divide-y divide-border">
          {data.members.map((m) => {
            const name = m.profile?.full_name ?? '—';
            const isMe = m.user_id === session?.user.id;
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="text-sm text-ink">
                  {name}
                  {isMe && <span className="ml-1 text-xs text-muted">({t.organization.you})</span>}
                </span>
                <div className="flex items-center gap-2">
                  <Badge tone={m.role === 'admin' ? 'info' : 'neutral'}>
                    {t.enums.memberRole[m.role]}
                  </Badge>
                  {isOrgAdmin && !isMe && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() =>
                        window.confirm(t.organization.removeConfirm(name)) && remove.mutate(m.id)
                      }
                    >
                      {t.organization.remove}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {isOrgAdmin ? (
        <>
          <Section title={t.organization.invite}>
            <InviteForm organizationId={id} />
          </Section>
          <Section title={t.organization.pending}>
            {data.invitations.length === 0 ? (
              <p className="text-sm text-muted">{t.organization.noPending}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div>
                      <p className="text-sm text-ink">{inv.email}</p>
                      <p className="text-xs text-muted">
                        {t.enums.memberRole[inv.role]} ·{' '}
                        {t.organization.expires(formatDate(new Date(inv.expires_at)))}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(inv.id)}
                    >
                      {t.organization.revoke}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : (
        <p className="text-sm text-muted">{t.organization.notAdmin}</p>
      )}
    </div>
  );
}
