import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { t } from '@/i18n/pt-BR';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/form';
import { Badge, FieldError, FormAlert, Notice } from '@/components/ui/section';
import { FullPageMessage } from '@/app/guards';
import {
  useAgreementTemplates,
  usePublishAgreementTemplate,
  type AgreementTemplate,
  type AgreementType,
} from '@/features/agreements/api';

const TYPES = Object.keys(t.agreements.types) as AgreementType[];

const schema = z.object({
  version: z.string().trim().min(1),
  title: z.string().trim().min(3),
  body: z.string().trim().min(20),
  validityMonths: z.string().trim().regex(/^\d*$/),
});
type FormValues = z.infer<typeof schema>;

/** Curadoria troca o rascunho pelo texto do advogado sem deploy (nova versão = nova linha). */
export function AdminTermsPage() {
  const { data, isLoading, isError } = useAgreementTemplates();
  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError) return <FullPageMessage title={t.common.error} />;

  return (
    <div className="space-y-6">
      <Notice>{t.admin.terms.body}</Notice>
      {TYPES.map((type) => (
        <TermType
          key={type}
          type={type}
          versions={(data ?? []).filter((v) => v.type === type)}
        />
      ))}
    </div>
  );
}

function TermType({ type, versions }: { type: AgreementType; versions: AgreementTemplate[] }) {
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const active = versions.find((v) => v.active);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid={`terms-${type}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-primary">{t.agreements.types[type]}</h2>
          {active && (
            <p className="text-xs text-muted">
              {t.agreements.scopes[active.scope]} · {t.admin.terms.validity(active.validity_months)}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}>
          {t.admin.terms.newVersion}
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {versions.map((v) => (
          <li key={v.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-ink">{v.version}</span>
              <span className="text-muted">{v.title}</span>
              <Badge tone={v.active ? 'success' : 'neutral'}>
                {v.active ? t.admin.terms.active : t.admin.terms.previous}
              </Badge>
              <span className="text-xs text-muted">{formatDate(new Date(v.created_at))}</span>
              <Button
                size="sm"
                variant="link"
                onClick={() => setOpenId(openId === v.id ? null : v.id)}
              >
                {openId === v.id ? t.admin.terms.hide : t.admin.terms.show}
              </Button>
            </div>
            {openId === v.id && (
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-bg p-3 text-xs text-ink">
                {v.body_markdown}
                {`\n\nSHA-256: ${v.body_hash}`}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {editing && active && (
        <PublishForm current={active} onDone={() => setEditing(false)} />
      )}
    </section>
  );
}

function PublishForm({ current, onDone }: { current: AgreementTemplate; onDone: () => void }) {
  const publish = usePublishAgreementTemplate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      version: '',
      title: current.title,
      body: current.body_markdown,
      validityMonths: current.validity_months?.toString() ?? '',
    },
  });

  return (
    <form
      className="mt-4 space-y-3 border-t border-border pt-4"
      noValidate
      onSubmit={handleSubmit((v) =>
        publish.mutate(
          {
            type: current.type,
            version: v.version,
            title: v.title,
            body: v.body,
            scope: current.scope,
            validityMonths: v.validityMonths ? Number(v.validityMonths) : null,
          },
          { onSuccess: onDone },
        ),
      )}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`v-${current.type}`}>{t.admin.terms.version}</Label>
          <Input id={`v-${current.type}`} {...register('version')} />
          <FieldError message={errors.version && t.admin.terms.version} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`t-${current.type}`}>{t.admin.terms.title}</Label>
          <Input id={`t-${current.type}`} {...register('title')} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`b-${current.type}`}>{t.admin.terms.text}</Label>
        <Textarea id={`b-${current.type}`} rows={10} {...register('body')} />
        <p className="text-[11px] text-muted">{t.admin.terms.variables}</p>
      </div>
      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor={`m-${current.type}`}>{t.admin.terms.validityMonths}</Label>
        <Input id={`m-${current.type}`} inputMode="numeric" {...register('validityMonths')} />
      </div>
      <FormAlert message={publish.isError ? t.common.error : null} />
      <Button type="submit" size="sm" disabled={publish.isPending}>
        {publish.isPending ? t.admin.terms.publishing : t.admin.terms.publish}
      </Button>
    </form>
  );
}
