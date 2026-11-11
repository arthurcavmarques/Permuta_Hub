import { useState } from 'react';
import { Lock } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { Button } from '@/components/ui/button';
import { useSensitiveAccess } from '@/features/agreements/api';
import { useRevealSensitive } from './api';

/**
 * Dados restritos sob demanda. Nada é carregado até o clique; cada clique gera registro no access_log
 * (feito pela RPC no banco). Curadoria e corretor responsável leem tudo; o comprador que recebeu a área só
 * matrícula e endereço, e só se a configuração liberar (D030). O proprietário nunca sai do banco para ele.
 */
export function SensitivePanel({ opportunityId }: { opportunityId: string }) {
  const access = useSensitiveAccess(opportunityId);
  const reveal = useRevealSensitive(opportunityId);
  const [open, setOpen] = useState(false);

  if (!access.data || access.data === 'denied') return null;
  const full = access.data === 'allowed';

  const data = open ? reveal.data : undefined;
  const contacts = data?.owner_contacts ? Object.entries(data.owner_contacts) : [];

  return (
    <section
      className="mt-2 rounded-lg border border-warning/40 bg-warning-bg p-4"
      data-testid="sensitive-panel"
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-warning">{t.sensitive.title}</h2>
          <p className="mt-0.5 text-xs text-ink">
            {full ? t.sensitive.description : t.sensitive.limitedDescription}
          </p>
          {!open ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate(undefined, { onSuccess: () => setOpen(true) })}
            >
              {reveal.isPending ? t.sensitive.revealing : t.sensitive.reveal}
            </Button>
          ) : (
            <>
              {data ? (
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <Field label={t.sensitive.registry} value={data.registry_number} />
                  <Field label={t.sensitive.address} value={data.exact_address} />
                  {full && (
                    <>
                      <Field label={t.sensitive.owner} value={data.owner_name} />
                      <Field
                        label={t.sensitive.contacts}
                        value={contacts.map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || null}
                      />
                      {data.notes && <Field label={t.sensitive.notes} value={data.notes} />}
                    </>
                  )}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted">{t.sensitive.empty}</p>
              )}
              <Button size="sm" variant="link" className="mt-2" onClick={() => setOpen(false)}>
                {t.sensitive.hide}
              </Button>
            </>
          )}
          {reveal.isError && <p className="mt-2 text-xs text-danger">{t.sensitive.denied}</p>}
        </div>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink">{value ?? '—'}</dd>
    </div>
  );
}
