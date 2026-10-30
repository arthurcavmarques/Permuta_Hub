import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Geometry } from 'geojson';
import { ArrowLeft, Eye, FileText, Trash2, Upload } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { UF, normalizeBrazilianPhone } from '@/lib/identity';
import { formatDate } from '@/lib/format';
import { GeometryEditorMap, geometryFromKmlFile, type LngLat } from '@/lib/map';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/form';
import { Badge, FieldError, FormAlert, Notice, Section, type Tone } from '@/components/ui/section';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { AgreementCard } from '@/features/agreements/AgreementCard';
import { useHasAgreement } from '@/features/agreements/api';
import type { NegotiationModel } from '../types';
import { useAssetTypes } from '../asset-types';
import {
  documentUrl,
  useCanEdit,
  useDeleteDocument,
  useDeleteMedia,
  useDocuments,
  useEditableOpportunity,
  useEditorMedia,
  useGeometry,
  useLoadSensitive,
  useReviewAuthorization,
  useSaveSensitive,
  useSetGeometry,
  useUpdateMedia,
  useUpdateOpportunity,
  useUploadDocument,
  useUploadMedia,
  type DocumentKind,
  type DocumentSensitivity,
  type EditableOpportunity,
  type MediaKind,
  type ReviewStatus,
} from './api';

const e = t.editor;
const MODELS = Object.keys(t.enums.negotiationModel) as NegotiationModel[];
const reviewTone: Record<ReviewStatus, Tone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
};

/** Editor completo do MD: corretor responsável (enquanto captada/qualificando) e curadoria. */
export function EditorPage() {
  const { id = '' } = useParams();
  const opp = useEditableOpportunity(id);
  const canEdit = useCanEdit(id);

  if (opp.isLoading || canEdit.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (opp.isError || !opp.data) return <FullPageMessage title={t.dossier.notFound} />;
  const o = opp.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/oportunidades">
            <ArrowLeft className="h-4 w-4" />
            {t.common.back}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link to={`/oportunidades/${o.id}`}>
            <Eye className="h-4 w-4" />
            {e.previewBlind}
          </Link>
        </Button>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted">
          {t.dossier.kicker} · {o.memorial_number}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-primary">{e.title}</h1>
          <StatusBadge status={o.status} />
        </div>
      </div>
      {!canEdit.data ? (
        <Notice tone="warning">{e.locked}</Notice>
      ) : (
        <>
          <DetailsSection o={o} />
          <LocationSection id={o.id} />
          <MediaSection id={o.id} />
          <SensitiveSection id={o.id} />
          <DocumentsSection id={o.id} />
          <AuthorizationSection o={o} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dados do dossiê
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const optNumber = z
  .string()
  .trim()
  .regex(/^(\d+([.,]\d+)?)?$/, e.errors.number);
const toNumber = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);

const detailsSchema = z.object({
  title_blind: z.string().trim().max(120),
  asset_type: z.string(),
  land_type: z.string().trim(),
  area_m2: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/, e.errors.area),
  city: z.string().trim().min(2, t.newArea.errors.city),
  neighborhood: z.string().trim(),
  state: z.enum(UF),
  region_tags: z.string(),
  zoning: z.string().trim(),
  coefficient: optNumber,
  master_plan_notes: z.string().trim(),
  buildable_potential_notes: z.string().trim(),
  project_types: z.string(),
  negotiation_models: z.array(z.enum(MODELS as [NegotiationModel, ...NegotiationModel[]])),
  negotiation_conditions: z.string().trim(),
  asking_value: optNumber,
  estimated_units: z.string().trim().regex(/^\d*$/, e.errors.number),
  cash_share_pct: optNumber.refine(
    (s) => !s || Number(s.replace(',', '.')) <= 100,
    e.errors.percent,
  ),
});
type DetailsValues = z.infer<typeof detailsSchema>;

function DetailsSection({ o }: { o: EditableOpportunity }) {
  const update = useUpdateOpportunity(o.id);
  const assetTypes = useAssetTypes();
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      title_blind: o.title_blind ?? '',
      asset_type: o.asset_type ?? '',
      land_type: o.land_type ?? '',
      area_m2: o.area_m2?.toString() ?? '',
      city: o.city ?? '',
      neighborhood: o.neighborhood ?? '',
      state: (UF as readonly string[]).includes(o.state ?? '')
        ? (o.state as (typeof UF)[number])
        : 'RS',
      region_tags: o.region_tags.join(', '),
      zoning: o.zoning ?? '',
      coefficient: o.coefficient?.toString() ?? '',
      master_plan_notes: o.master_plan_notes ?? '',
      buildable_potential_notes: o.buildable_potential_notes ?? '',
      project_types: o.project_types.join(', '),
      negotiation_models: o.negotiation_models,
      negotiation_conditions: o.negotiation_conditions ?? '',
      asking_value: o.asking_value?.toString() ?? '',
      estimated_units: o.estimated_units?.toString() ?? '',
      cash_share_pct: o.cash_share_pct?.toString() ?? '',
    },
  });

  const onSubmit = (v: DetailsValues) => {
    setSaved(false);
    update.mutate(
      {
        title_blind: v.title_blind || null,
        asset_type: v.asset_type || null,
        land_type: v.land_type || null,
        area_m2: toNumber(v.area_m2),
        city: v.city,
        neighborhood: v.neighborhood || null,
        state: v.state,
        region_tags: list(v.region_tags),
        zoning: v.zoning || null,
        coefficient: toNumber(v.coefficient),
        master_plan_notes: v.master_plan_notes || null,
        buildable_potential_notes: v.buildable_potential_notes || null,
        project_types: list(v.project_types),
        negotiation_models: v.negotiation_models,
        negotiation_conditions: v.negotiation_conditions || null,
        asking_value: toNumber(v.asking_value),
        estimated_units: toNumber(v.estimated_units),
        cash_share_pct: toNumber(v.cash_share_pct),
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  const field = (
    name: keyof DetailsValues,
    label: string,
    opts: { span?: string; hint?: string } = {},
  ) => (
    <div className={`space-y-1.5 ${opts.span ?? ''}`}>
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Input id={`f-${name}`} {...register(name)} />
      {opts.hint && <p className="text-[11px] text-muted">{opts.hint}</p>}
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Section title={e.details.title} description={e.details.body}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-3">
        {field('city', t.newArea.city, { span: 'sm:col-span-2' })}
        <div className="space-y-1.5">
          <Label htmlFor="f-state">{t.newArea.state}</Label>
          <Select id="f-state" {...register('state')}>
            {UF.map((uf) => (
              <option key={uf}>{uf}</option>
            ))}
          </Select>
        </div>
        {field('neighborhood', t.newArea.neighborhood, { span: 'sm:col-span-2' })}
        {field('area_m2', e.details.area)}
        <div className="space-y-1.5">
          <Label htmlFor="f-asset_type">{e.details.assetType}</Label>
          <Select id="f-asset_type" {...register('asset_type')}>
            <option value="">{e.details.assetTypeNone}</option>
            {(assetTypes.data ?? []).map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        {field('land_type', t.newArea.landType)}
        {field('zoning', t.dossier.zoning)}
        {field('coefficient', t.dossier.coefficient)}
        {field('region_tags', e.details.regionTags, {
          span: 'sm:col-span-3',
          hint: e.details.commaHint,
        })}
        {field('project_types', e.details.projectTypes, {
          span: 'sm:col-span-3',
          hint: e.details.commaHint,
        })}
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="f-master">{e.details.masterPlan}</Label>
          <Textarea id="f-master" {...register('master_plan_notes')} />
        </div>
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="f-potential">{e.details.potential}</Label>
          <Textarea id="f-potential" {...register('buildable_potential_notes')} />
        </div>
        <fieldset className="space-y-2 sm:col-span-3">
          <legend className="text-xs font-medium text-muted">{t.newArea.models}</legend>
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
        </fieldset>
        {field('asking_value', e.details.askingValue)}
        {field('cash_share_pct', e.details.cashShare, { hint: e.details.cashShareHint })}
        {field('estimated_units', e.details.estimatedUnits, { hint: e.details.estimatedUnitsHint })}
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="f-conditions">{t.newArea.conditions}</Label>
          <Textarea id="f-conditions" {...register('negotiation_conditions')} />
        </div>
        {field('title_blind', e.details.titleBlind, {
          span: 'sm:col-span-3',
          hint: e.details.titleBlindHint,
        })}
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? e.saving : e.save}
          </Button>
          {saved && <span className="text-sm text-success">{e.saved}</span>}
          <FormAlert message={update.isError ? t.common.error : null} />
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------- localização exata
function LocationSection({ id }: { id: string }) {
  const geometry = useGeometry(id);
  const setGeometry = useSetGeometry(id);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [kmlError, setKmlError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (g: Geometry | null) =>
    setGeometry.mutate(g, {
      onSuccess: () => {
        setDrawing(false);
        setDraft([]);
      },
    });

  const importKml = async (file: File) => {
    setKmlError(null);
    try {
      save(await geometryFromKmlFile(file));
    } catch {
      setKmlError(e.location.kmlError);
    }
  };

  return (
    <Section title={e.location.title} description={e.location.body}>
      <div className="h-72 overflow-hidden rounded-lg border border-border sm:h-96">
        {!geometry.isLoading && (
          <GeometryEditorMap
            geometry={geometry.data ?? null}
            draft={draft}
            onMapClick={drawing ? (p) => setDraft((d) => [...d, p]) : undefined}
          />
        )}
      </div>
      {drawing && <p className="mt-2 text-xs text-muted">{e.location.drawingHint(draft.length)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!drawing ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setDrawing(true)}>
              {e.location.draw}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {e.location.importKml}
            </Button>
            {geometry.data && (
              <Button
                size="sm"
                variant="ghost"
                disabled={setGeometry.isPending}
                onClick={() => window.confirm(e.location.clearConfirm) && save(null)}
              >
                {e.location.clear}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={draft.length < 3 || setGeometry.isPending}
              onClick={() => save({ type: 'Polygon', coordinates: [[...draft, draft[0]]] })}
            >
              {e.location.savePolygon}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={draft.length !== 1 || setGeometry.isPending}
              onClick={() => save({ type: 'Point', coordinates: draft[0] })}
            >
              {e.location.savePoint}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!draft.length}
              onClick={() => setDraft((d) => d.slice(0, -1))}
            >
              {e.location.undo}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDrawing(false);
                setDraft([]);
              }}
            >
              {t.agreements.cancel}
            </Button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".kml,.kmz"
          className="hidden"
          data-testid="kml-input"
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            if (f) void importKml(f);
            ev.target.value = '';
          }}
        />
      </div>
      <FormAlert message={kmlError ?? (setGeometry.isError ? e.location.saveError : null)} />
      <p className="mt-2 text-xs text-muted">{e.location.privacy}</p>
    </Section>
  );
}

// ---------------------------------------------------------------- fotos
const MEDIA_KINDS = Object.keys(e.media.kinds) as MediaKind[];

function MediaSection({ id }: { id: string }) {
  const media = useEditorMedia(id);
  const upload = useUploadMedia(id);
  const update = useUpdateMedia(id);
  const remove = useDeleteMedia(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = media.data ?? [];

  return (
    <Section
      title={e.media.title}
      description={e.media.body}
      aside={
        <Button
          size="sm"
          variant="secondary"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {upload.isPending ? e.uploading : e.media.add}
        </Button>
      }
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        data-testid="media-input"
        onChange={(ev) => {
          const files = [...(ev.target.files ?? [])];
          if (files.length) upload.mutate({ files, nextOrder: items.length });
          ev.target.value = '';
        }}
      />
      <FormAlert message={upload.isError ? e.uploadError : null} />
      {items.length === 0 ? (
        <p className="text-sm text-muted">{e.media.empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((m) => (
            <li
              key={m.id}
              className="rounded-md border border-border p-2"
              data-testid="editor-media"
            >
              {m.url && (
                <img
                  src={m.url}
                  alt={m.caption ?? ''}
                  className="aspect-[4/3] w-full rounded object-cover"
                />
              )}
              <div className="mt-2 space-y-2">
                <Input
                  aria-label={e.media.caption}
                  placeholder={e.media.caption}
                  defaultValue={m.caption ?? ''}
                  onBlur={(ev) =>
                    ev.target.value !== (m.caption ?? '') &&
                    update.mutate({ mediaId: m.id, patch: { caption: ev.target.value || null } })
                  }
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Select
                    className="h-8 max-w-[10rem] text-xs"
                    aria-label={e.media.kind}
                    defaultValue={m.kind}
                    onChange={(ev) =>
                      update.mutate({
                        mediaId: m.id,
                        patch: { kind: ev.target.value as MediaKind },
                      })
                    }
                  >
                    {MEDIA_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {e.media.kinds[k]}
                      </option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="accent-action"
                      defaultChecked={m.is_blind_safe}
                      onChange={(ev) =>
                        update.mutate({
                          mediaId: m.id,
                          patch: { is_blind_safe: ev.target.checked },
                        })
                      }
                    />
                    {e.media.blindSafe}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={e.remove}
                    onClick={() => window.confirm(e.removeConfirm) && remove.mutate(m)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{e.media.blindSafeHint}</p>
    </Section>
  );
}

// ---------------------------------------------------------------- dado sensível
const sensitiveSchema = z.object({
  registry_number: z.string().trim(),
  exact_address: z.string().trim(),
  owner_name: z.string().trim(),
  owner_phone: z
    .string()
    .refine((v) => v.trim() === '' || normalizeBrazilianPhone(v) !== null, t.signup.errors.phone),
  owner_email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.email().safeParse(v).success, t.auth.emailInvalid),
  notes: z.string().trim(),
});
type SensitiveValues = z.infer<typeof sensitiveSchema>;

function SensitiveSection({ id }: { id: string }) {
  const load = useLoadSensitive(id);
  const save = useSaveSensitive(id);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SensitiveValues>({ resolver: zodResolver(sensitiveSchema) });

  useEffect(() => {
    if (!open) return;
    const d = load.data;
    const c = (d?.owner_contacts ?? {}) as Record<string, string>;
    reset({
      registry_number: d?.registry_number ?? '',
      exact_address: d?.exact_address ?? '',
      owner_name: d?.owner_name ?? '',
      owner_phone: c.phone ?? '',
      owner_email: c.email ?? '',
      notes: d?.notes ?? '',
    });
  }, [open, load.data, reset]);

  return (
    <Section title={e.sensitive.title} description={e.sensitive.body}>
      {!open ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={load.isPending}
          onClick={() => load.mutate(undefined, { onSuccess: () => setOpen(true) })}
        >
          {load.isPending ? t.sensitive.revealing : e.sensitive.open}
        </Button>
      ) : (
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => {
            setSaved(false);
            save.mutate(
              {
                ...v,
                owner_phone: v.owner_phone ? (normalizeBrazilianPhone(v.owner_phone) ?? '') : '',
              },
              { onSuccess: () => setSaved(true) },
            );
          })}
        >
          <div className="space-y-1.5">
            <Label htmlFor="s-registry">{t.sensitive.registry}</Label>
            <Input id="s-registry" {...register('registry_number')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-address">{t.sensitive.address}</Label>
            <Input id="s-address" {...register('exact_address')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-owner">{t.sensitive.owner}</Label>
            <Input id="s-owner" {...register('owner_name')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-phone">{e.sensitive.ownerPhone}</Label>
            <Input id="s-phone" type="tel" {...register('owner_phone')} />
            <FieldError message={errors.owner_phone?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-email">{e.sensitive.ownerEmail}</Label>
            <Input id="s-email" type="email" {...register('owner_email')} />
            <FieldError message={errors.owner_email?.message} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-notes">{t.sensitive.notes}</Label>
            <Textarea id="s-notes" {...register('notes')} />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? e.saving : e.sensitive.save}
            </Button>
            {saved && <span className="text-sm text-success">{e.saved}</span>}
            <FormAlert message={save.isError ? t.common.error : null} />
          </div>
        </form>
      )}
      <FormAlert message={load.isError ? t.sensitive.denied : null} />
    </Section>
  );
}

// ---------------------------------------------------------------- documentos
const DOC_KINDS = (Object.keys(e.documents.kinds) as DocumentKind[]).filter(
  (k) => k !== 'owner_authorization',
);

function DocumentList({ id, kind }: { id: string; kind: 'authorization' | 'other' }) {
  const { isPlatformAdmin } = useAuth();
  const docs = useDocuments(id);
  const remove = useDeleteDocument(id);
  const review = useReviewAuthorization(id);
  const rows = (docs.data ?? []).filter((d) =>
    kind === 'authorization' ? d.kind === 'owner_authorization' : d.kind !== 'owner_authorization',
  );
  if (!rows.length) return <p className="text-sm text-muted">{e.documents.empty}</p>;

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-center gap-2 p-3 text-sm"
          data-testid="editor-document"
        >
          <FileText className="h-4 w-4 text-muted" aria-hidden />
          <button
            type="button"
            className="text-action hover:underline"
            onClick={async () =>
              window.open(await documentUrl(d.storage_path), '_blank', 'noopener')
            }
          >
            {d.file_name}
          </button>
          <span className="text-xs text-muted">
            {e.documents.kinds[d.kind]} · {e.documents.sensitivities[d.sensitivity]} ·{' '}
            {formatDate(new Date(d.created_at))}
          </span>
          {d.kind === 'owner_authorization' && (
            <Badge tone={reviewTone[d.review_status]}>
              {e.authorization.status[d.review_status]}
            </Badge>
          )}
          {d.review_note && <span className="text-xs text-muted">({d.review_note})</span>}
          <span className="ml-auto flex gap-1">
            {isPlatformAdmin &&
              d.kind === 'owner_authorization' &&
              d.review_status !== 'accepted' && (
                <Button
                  size="sm"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ documentId: d.id, accept: true })}
                >
                  {e.authorization.accept}
                </Button>
              )}
            {isPlatformAdmin &&
              d.kind === 'owner_authorization' &&
              d.review_status !== 'rejected' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={review.isPending}
                  onClick={() => {
                    const note = window.prompt(e.authorization.rejectPrompt)?.trim();
                    if (note) review.mutate({ documentId: d.id, accept: false, note });
                  }}
                >
                  {e.authorization.reject}
                </Button>
              )}
            {d.review_status !== 'accepted' && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={e.remove}
                onClick={() => window.confirm(e.removeConfirm) && remove.mutate(d)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function UploadDocumentButton({
  id,
  kind,
  sensitivity,
  label,
  testId,
}: {
  id: string;
  kind: DocumentKind;
  sensitivity: DocumentSensitivity;
  label: string;
  testId: string;
}) {
  const upload = useUploadDocument(id);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={upload.isPending}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-4 w-4" />
        {upload.isPending ? e.uploading : label}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        data-testid={testId}
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (file) upload.mutate({ file, kind, sensitivity });
          ev.target.value = '';
        }}
      />
      {upload.isError && <span className="text-xs text-danger">{e.uploadError}</span>}
    </>
  );
}

function DocumentsSection({ id }: { id: string }) {
  const [kind, setKind] = useState<DocumentKind>('technical');
  const [sensitivity, setSensitivity] = useState<DocumentSensitivity>('restricted');
  return (
    <Section title={e.documents.title} description={e.documents.body}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="doc-kind">{e.documents.kind}</Label>
          <Select
            id="doc-kind"
            value={kind}
            onChange={(ev) => setKind(ev.target.value as DocumentKind)}
          >
            {DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {e.documents.kinds[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-sens">{e.documents.sensitivity}</Label>
          <Select
            id="doc-sens"
            value={sensitivity}
            onChange={(ev) => setSensitivity(ev.target.value as DocumentSensitivity)}
          >
            {(['restricted', 'blind'] as const).map((s) => (
              <option key={s} value={s}>
                {e.documents.sensitivities[s]}
              </option>
            ))}
          </Select>
        </div>
        <UploadDocumentButton
          id={id}
          kind={kind}
          sensitivity={sensitivity}
          label={e.documents.add}
          testId="document-input"
        />
      </div>
      <DocumentList id={id} kind="other" />
    </Section>
  );
}

// ---------------------------------------------------------------- autorização e termo por área
function AuthorizationSection({ o }: { o: EditableOpportunity }) {
  const { session } = useAuth();
  const isResponsible = !!session && o.responsible_party_user_id === session.user.id;
  const areaTerm = useHasAgreement('broker_area_authorization', o.id);

  return (
    <Section title={e.authorization.title} description={e.authorization.body}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{e.authorization.ownerDoc}</h3>
            <UploadDocumentButton
              id={o.id}
              kind="owner_authorization"
              sensitivity="restricted"
              label={e.authorization.upload}
              testId="authorization-input"
            />
          </div>
          <DocumentList id={o.id} kind="authorization" />
        </div>
        {isResponsible && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">{e.authorization.areaTerm}</h3>
            {areaTerm.data ? (
              <Notice tone="success">{e.authorization.areaTermDone}</Notice>
            ) : (
              <AgreementCard type="broker_area_authorization" opportunityId={o.id} />
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
