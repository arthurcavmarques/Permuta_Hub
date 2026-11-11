import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, Pencil } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { PRODUCT_NAME } from '@/config/product';
import {
  estimatedPotential,
  formatArea,
  formatCoefficient,
  formatDate,
  formatMoney,
  formatMoneyCompact,
  paymentSplit,
  valuePerUnit,
} from '@/lib/format';
import { ApproxLocationMap, GeometryEditorMap } from '@/lib/map';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { Wordmark } from '@/app/AppShell';
import { useBlindMedia, useBlindOpportunity, useBrokerContact, useDossierGeometry } from './api';
import { optionLabel, useAssetTypes, useProjectTypes } from './asset-types';
import { SensitivePanel } from './SensitivePanel';
import { useCanEdit } from './editor/api';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-avoid-break border-t border-border py-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <div className="text-sm leading-relaxed text-ink">{children}</div>
    </section>
  );
}

function Empty() {
  return <span className="text-muted">{t.common.notInformed}</span>;
}

function KeyFigure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-primary-foreground/70">{label}</dt>
      <dd className="tabular mt-0.5 text-lg font-semibold text-primary-foreground">
        {value ?? '—'}
      </dd>
    </div>
  );
}

function StudyFigure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dd className="tabular text-xl font-semibold text-primary">{value ?? '—'}</dd>
      <dt className="mt-0.5 text-xs text-muted">{label}</dt>
    </div>
  );
}

/** Contato do corretor responsável: o comprador fala direto com ele (D030). */
function BrokerContactSection({ opportunityId }: { opportunityId: string }) {
  const contact = useBrokerContact(opportunityId);
  const c = contact.data;
  if (!c?.full_name) return null;
  return (
    <Section title={t.dossier.contact.title}>
      <p className="text-xs text-muted print:hidden">{t.dossier.contact.body}</p>
      <dl className="mt-2 space-y-0.5" data-testid="broker-contact">
        <dt className="sr-only">{t.dossier.contact.title}</dt>
        <dd className="font-semibold text-primary">{c.full_name}</dd>
        {c.organization_name && <dd>{c.organization_name}</dd>}
        {c.creci && <dd className="text-muted">{t.dossier.contact.creci(c.creci)}</dd>}
        {c.phone && <dd className="tabular">{c.phone}</dd>}
        {c.email && <dd>{c.email}</dd>}
      </dl>
    </Section>
  );
}

export function DossierPage() {
  const { id = '' } = useParams();
  const { data: o, isLoading, isError } = useBlindOpportunity(id);
  const media = useBlindMedia(id);
  const canEdit = useCanEdit(id);
  const geometry = useDossierGeometry(id);
  const assetTypes = useAssetTypes();
  const projectTypes = useProjectTypes();
  const { session } = useAuth();

  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError || !o) return <FullPageMessage title={t.dossier.notFound} />;

  const potential = estimatedPotential(o.area_m2_approx, o.coefficient);
  const location = [o.neighborhood, o.city, o.state].filter(Boolean).join(' · ');
  const split = paymentSplit(o.asking_value, o.cash_share_pct);

  return (
    <article className="mx-auto max-w-3xl pb-16 print:max-w-none print:pb-0">
      <div className="flex items-center justify-between px-4 py-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to="/oportunidades">
            <ArrowLeft className="h-4 w-4" />
            {t.common.back}
          </Link>
        </Button>
        <div className="flex gap-2">
          {canEdit.data && (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/areas/${id}/editar`}>
                <Pencil className="h-4 w-4" />
                {t.editor.edit}
              </Link>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              // Registra quem gerou o PDF antes de abrir a impressão (falha no log não impede o PDF).
              await supabase.rpc('log_dossier_print', { p_opportunity_id: id }).then(
                () => undefined,
                () => undefined,
              );
              window.print();
            }}
          >
            <FileDown className="h-4 w-4" />
            {t.dossier.printPdf}
          </Button>
        </div>
      </div>

      {/* Cabeçalho: dados-chave primeiro (o WhatsApp traz o comprador direto para cá). */}
      <header className="bg-primary px-5 py-6 text-primary-foreground sm:rounded-lg print:rounded-none print:[print-color-adjust:exact] print:[-webkit-print-color-adjust:exact]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-accent">
            {t.dossier.kicker} · {o.memorial_number}
          </span>
          <span className="hidden text-sm print:inline">
            <Wordmark />
          </span>
          <span className="rounded-full border border-accent/60 px-2 py-0.5 text-[11px] text-accent print:hidden">
            {t.dossier.confidentialBadge}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold leading-tight">{o.title}</h1>
        {location && <p className="mt-1 text-sm text-primary-foreground/80">{location}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-primary-foreground/15 pt-4 sm:grid-cols-4">
          <KeyFigure label={t.dossier.area} value={formatArea(o.area_m2_approx)} />
          <KeyFigure label={t.dossier.zoning} value={o.zoning} />
          <KeyFigure label={t.dossier.coefficient} value={formatCoefficient(o.coefficient)} />
          <KeyFigure
            label={t.dossier.potential}
            value={potential ? `~${formatArea(potential)}` : null}
          />
        </dl>
      </header>

      <div className="px-5 print:px-0">
        <Section title={t.dossier.sections.location}>
          {geometry.data ? (
            <>
              <div className="h-64 overflow-hidden rounded-lg border border-border sm:h-80 print:h-72">
                <GeometryEditorMap geometry={geometry.data} draft={[]} />
              </div>
              <p className="mt-2 text-xs text-muted">{t.dossier.exactLocation}</p>
            </>
          ) : o.approx_lat !== null && o.approx_lng !== null ? (
            <>
              <div className="h-64 overflow-hidden rounded-lg border border-border sm:h-80 print:h-72">
                <ApproxLocationMap
                  lat={o.approx_lat}
                  lng={o.approx_lng}
                  radiusM={o.approx_radius_m}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                {t.dossier.approxLocation(o.approx_radius_m)}
              </p>
            </>
          ) : (
            <p className="text-muted">{t.dossier.noGeometry}</p>
          )}
        </Section>

        <Section title={t.dossier.sections.characteristics}>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted">{t.dossier.assetType}</dt>
              <dd>{o.asset_type ? optionLabel(assetTypes.data, o.asset_type) : <Empty />}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.dossier.building}</dt>
              <dd>{o.has_building ? t.dossier.hasBuilding : t.dossier.noBuilding}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.dossier.landType}</dt>
              <dd className="capitalize">{o.land_type ?? <Empty />}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.dossier.status}</dt>
              <dd>
                <StatusBadge status={o.status} />
              </dd>
            </div>
          </dl>
        </Section>

        <Section title={t.dossier.sections.urbanContext}>
          {o.region_tags.length ? o.region_tags.join(' · ') : <Empty />}
        </Section>

        <Section title={t.dossier.sections.masterPlan}>
          <p>{o.zoning ?? <Empty />}</p>
          {o.master_plan_notes && <p className="mt-1 text-muted">{o.master_plan_notes}</p>}
          {o.buildable_potential_notes && <p className="mt-1">{o.buildable_potential_notes}</p>}
        </Section>

        <Section title={t.dossier.sections.projectTypes}>
          {o.project_types.length ? (
            <ul className="flex flex-wrap gap-2">
              {o.project_types.map((p) => (
                <li
                  key={p}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs"
                >
                  {optionLabel(projectTypes.data, p)}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </Section>

        <Section title={t.dossier.sections.photos}>
          {media.data?.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {media.data.map((m) =>
                m.url ? (
                  <figure key={m.id}>
                    <img
                      src={m.url}
                      alt={m.caption ?? ''}
                      className="aspect-[4/3] w-full rounded-md object-cover"
                      loading="lazy"
                    />
                    {m.caption && (
                      <figcaption className="mt-1 text-xs text-muted">{m.caption}</figcaption>
                    )}
                  </figure>
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-muted">{t.dossier.noPhotos}</p>
          )}
        </Section>

        {(o.estimated_units !== null || split) && (
          <Section title={t.dossier.sections.study}>
            {o.estimated_units !== null && (
              <dl className="grid grid-cols-3 gap-3 rounded-lg bg-surface p-4">
                <StudyFigure
                  label={t.dossier.study.units}
                  value={o.estimated_units.toLocaleString('pt-BR')}
                />
                <StudyFigure
                  label={t.dossier.study.referenceValue}
                  value={formatMoneyCompact(o.asking_value)}
                />
                <StudyFigure
                  label={t.dossier.study.perUnit}
                  value={formatMoney(valuePerUnit(o.asking_value, o.estimated_units))}
                />
              </dl>
            )}
            {split && (
              <div className="mt-4" data-testid="payment-split">
                <div className="flex h-3 overflow-hidden rounded-full bg-border">
                  <div className="bg-primary" style={{ width: `${split.cashPct}%` }} />
                  <div className="bg-accent" style={{ width: `${split.swapPct}%` }} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted">{t.dossier.study.cash(split.cashPct)}</dt>
                    <dd className="tabular font-semibold">
                      {formatMoneyCompact(split.cash) ?? '—'}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-xs text-muted">{t.dossier.study.swap(split.swapPct)}</dt>
                    <dd className="tabular font-semibold">
                      {formatMoneyCompact(split.swap) ?? '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">{t.dossier.study.disclaimer}</p>
          </Section>
        )}

        <Section title={t.dossier.sections.conditions}>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted">{t.dossier.negotiationModels}</dt>
              <dd>
                {o.negotiation_models.length ? (
                  o.negotiation_models.map((m) => t.enums.negotiationModel[m]).join(', ')
                ) : (
                  <Empty />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.dossier.askingValue}</dt>
              <dd className="tabular">{formatMoneyCompact(o.asking_value) ?? <Empty />}</dd>
            </div>
          </dl>
          {o.negotiation_conditions && <p className="mt-3">{o.negotiation_conditions}</p>}
        </Section>

        <BrokerContactSection opportunityId={o.id} />

        {/* Nunca vai para o PDF. O painel se esconde sozinho para quem não pode ler (sensitive_access_state). */}
        <div className="print:hidden">
          <SensitivePanel opportunityId={o.id} />
        </div>

        <footer className="mt-6 border-t border-border pt-4 text-xs text-muted">
          {PRODUCT_NAME} · {t.dossier.footer(formatDate(new Date()))}
        </footer>
      </div>

      {/* Rodapé que se repete em cada página do PDF: marca, MD e quem gerou (rastreabilidade). */}
      <div
        aria-hidden
        data-testid="print-footer"
        className="hidden print:fixed print:inset-x-0 print:bottom-0 print:flex print:items-center print:justify-between print:border-t print:border-accent print:bg-surface print:pt-1 print:text-[9px] print:text-muted"
      >
        <span className="font-semibold text-primary">{PRODUCT_NAME}</span>
        <span>
          {o.memorial_number} · {t.dossier.confidentialBadge}
        </span>
        <span>{t.dossier.printedFor(session?.user.email ?? '', formatDate(new Date()))}</span>
      </div>
    </article>
  );
}
