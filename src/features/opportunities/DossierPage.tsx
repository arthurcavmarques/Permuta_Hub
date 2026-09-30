import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { PRODUCT_NAME } from '@/config/product';
import {
  estimatedPotential,
  formatArea,
  formatCoefficient,
  formatDate,
  formatMoneyCompact,
} from '@/lib/format';
import { ApproxLocationMap } from '@/lib/map';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { Wordmark } from '@/app/AppShell';
import { useBlindMedia, useBlindOpportunity } from './api';
import { SensitivePanel } from './SensitivePanel';

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

export function DossierPage() {
  const { id = '' } = useParams();
  const { isPlatformAdmin } = useAuth();
  const { data: o, isLoading, isError } = useBlindOpportunity(id);
  const media = useBlindMedia(id);

  if (isLoading) return <FullPageMessage title={t.common.loading} />;
  if (isError || !o) return <FullPageMessage title={t.dossier.notFound} />;

  const potential = estimatedPotential(o.area_m2_approx, o.coefficient);
  const location = [o.neighborhood, o.city, o.state].filter(Boolean).join(' · ');

  return (
    <article className="mx-auto max-w-3xl pb-16 print:max-w-none print:pb-0">
      <div className="flex items-center justify-between px-4 py-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to="/oportunidades">
            <ArrowLeft className="h-4 w-4" />
            {t.common.back}
          </Link>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          <FileDown className="h-4 w-4" />
          {t.dossier.printPdf}
        </Button>
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
            {t.dossier.blindBadge}
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
          {o.approx_lat !== null && o.approx_lng !== null ? (
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
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs capitalize"
                >
                  {p}
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

        {/* Nunca vai para o PDF: o PDF é sempre a versão cega. */}
        {isPlatformAdmin && (
          <div className="print:hidden">
            <SensitivePanel opportunityId={o.id} />
          </div>
        )}

        <footer className="mt-6 border-t border-border pt-4 text-xs text-muted">
          {PRODUCT_NAME} · {t.dossier.footer(formatDate(new Date()))}
        </footer>
      </div>
    </article>
  );
}
