import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pause, Pencil, Play } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { formatArea, formatMoneyCompact } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/form';
import { Badge, FieldError, FormAlert } from '@/components/ui/section';
import { useAssetTypes } from '@/features/opportunities/asset-types';
import type { NegotiationModel } from '@/features/opportunities/types';
import { useSaveThesis, type Thesis, type ThesisInput } from './api';
import {
  emptyThesisForm,
  formToThesis,
  thesisToForm,
  type ThesisFormErrors,
  type ThesisFormValues,
} from './thesis-form';

const th = t.theses;
const MODELS = Object.keys(t.enums.negotiationModel) as NegotiationModel[];

/** Resumo de uma linha da tese (para a lista). */
export function ThesisSummary({ thesis: s }: { thesis: Thesis }) {
  const assetTypes = useAssetTypes();
  const label = (v: string) => assetTypes.data?.find((a) => a.value === v)?.label ?? v;
  const region = [...s.cities, ...s.region_tags, ...s.states];
  const ticket = th.summary.ticket(
    formatMoneyCompact(s.min_ticket),
    formatMoneyCompact(s.max_ticket),
  );
  return (
    <p className="text-sm text-muted">
      {[
        s.asset_types.length ? s.asset_types.map(label).join(', ') : th.summary.anyType,
        region.length ? region.join(', ') : th.summary.anyRegion,
        th.summary.area(formatArea(s.min_area_m2), formatArea(s.max_area_m2)),
        s.negotiation_models.length
          ? s.negotiation_models.map((m) => t.enums.negotiationModel[m]).join('/')
          : null,
        ticket,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}

export function ThesisCard({ thesis, canEdit }: { thesis: Thesis; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const save = useSaveThesis();
  if (editing)
    return (
      <ThesisForm
        organizationId={thesis.organization_id}
        thesis={thesis}
        onDone={() => setEditing(false)}
      />
    );
  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid="thesis">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {thesis.name}{' '}
            <Badge tone={thesis.active ? 'success' : 'neutral'} className="ml-1 align-middle">
              {thesis.active ? th.active : th.paused}
            </Badge>
          </p>
          <ThesisSummary thesis={thesis} />
          {thesis.notes && <p className="mt-1 text-sm text-ink">{thesis.notes}</p>}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              aria-label={thesis.active ? th.paused : th.active}
              onClick={() => {
                const values: Partial<Thesis> = { ...thesis, active: !thesis.active };
                delete values.id;
                delete values.updated_at;
                save.mutate({ id: thesis.id, values: values as ThesisInput });
              }}
            >
              {thesis.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              {th.edit}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function ThesisForm({
  organizationId,
  thesis,
  onDone,
}: {
  organizationId: string;
  thesis?: Thesis;
  onDone: () => void;
}) {
  const assetTypes = useAssetTypes();
  const save = useSaveThesis();
  const [errors, setErrors] = useState<ThesisFormErrors>({});
  const { register, handleSubmit } = useForm<ThesisFormValues>({
    defaultValues: thesis ? thesisToForm(thesis) : emptyThesisForm(),
  });

  const onSubmit = (v: ThesisFormValues) => {
    const r = formToThesis(v, organizationId);
    if ('errors' in r) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    save.mutate({ id: thesis?.id, values: r.input }, { onSuccess: onDone });
  };

  const err = (k: keyof ThesisFormValues) =>
    errors[k] ? <FieldError message={th.errors[errors[k]!]} /> : null;
  const text = (
    k: keyof ThesisFormValues,
    label: string,
    opts: { span?: string; hint?: string; placeholder?: string } = {},
  ) => (
    <div className={`space-y-1.5 ${opts.span ?? ''}`}>
      <Label htmlFor={`th-${k}`}>{label}</Label>
      <Input id={`th-${k}`} placeholder={opts.placeholder} {...register(k)} />
      {opts.hint && <p className="text-[11px] text-muted">{opts.hint}</p>}
      {err(k)}
    </div>
  );

  return (
    <li className="list-none rounded-lg border border-action/40 bg-surface p-4">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5" aria-label={th.save}>
        <div className="grid gap-4 sm:grid-cols-3">
          {text('name', th.fields.name, {
            span: 'sm:col-span-2',
            placeholder: th.fields.namePlaceholder,
          })}
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="accent-action" {...register('active')} />
            {th.activeLabel}
          </label>
        </div>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-primary">{th.groups.required}</legend>
          <p className="-mt-3 text-xs text-muted">{th.groups.requiredHint}</p>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">{th.fields.assetTypes}</p>
            <div className="flex flex-wrap gap-4">
              {(assetTypes.data ?? []).map((a) => (
                <label key={a.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={a.value}
                    className="accent-action"
                    {...register('asset_types')}
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {text('cities', th.fields.cities, { hint: th.commaHint })}
            {text('region_tags', th.fields.regionTags, { hint: th.commaHint })}
            {text('states', th.fields.states, { hint: th.commaHint })}
            {text('min_area_m2', th.fields.minArea)}
            {text('max_area_m2', th.fields.maxArea)}
            <div />
            {text('min_ticket', th.fields.minTicket)}
            {text('max_ticket', th.fields.maxTicket)}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">{th.fields.models}</p>
            <div className="flex flex-wrap gap-4">
              {MODELS.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    value={m}
                    className="accent-action"
                    {...register('negotiation_models')}
                  />
                  {t.enums.negotiationModel[m]}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-primary">{th.groups.preferences}</legend>
          <p className="-mt-3 text-xs text-muted">{th.groups.preferencesHint}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {text('zonings', th.fields.zonings, { hint: th.commaHint })}
            {text('min_coefficient', th.fields.minCoefficient)}
            {text('project_types', th.fields.projectTypes, { hint: th.commaHint })}
            {text('neighborhoods', th.fields.neighborhoods, {
              span: 'sm:col-span-3',
              hint: th.commaHint,
            })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="th-notes">{th.fields.notes}</Label>
            <Textarea id="th-notes" {...register('notes')} />
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? th.saving : th.save}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {th.cancel}
          </Button>
          <FormAlert message={save.isError ? t.common.error : null} />
        </div>
      </form>
    </li>
  );
}

/** Lista + "Nova tese" de uma organização (usada pelo comprador e pela curadoria). */
export function ThesesList({
  organizationId,
  theses,
  canEdit,
}: {
  organizationId: string;
  theses: Thesis[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {theses.length === 0 && !adding && <p className="text-sm text-muted">{th.empty}</p>}
      <ul className="space-y-3">
        {theses.map((s) => (
          <ThesisCard key={s.id} thesis={s} canEdit={canEdit} />
        ))}
        {adding && <ThesisForm organizationId={organizationId} onDone={() => setAdding(false)} />}
      </ul>
      {canEdit && !adding && (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          {th.add}
        </Button>
      )}
      {!canEdit && <p className="text-xs text-muted">{th.readOnly}</p>}
    </div>
  );
}
