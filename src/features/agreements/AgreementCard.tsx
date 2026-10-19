import { useState } from 'react';
import { FileSignature } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/section';
import { useAcceptAgreement, useAgreementPreview, type AgreementType } from './api';

/**
 * Mostra o texto exato do termo (renderizado no servidor) e registra o aceite.
 * O banco grava texto, hash, IP, user agent e data; esta tela só exibe e envia o hash lido.
 */
export function AgreementCard({
  type,
  opportunityId,
  onAccepted,
  onCancel,
}: {
  type: AgreementType;
  opportunityId?: string;
  onAccepted?: () => void;
  onCancel?: () => void;
}) {
  const preview = useAgreementPreview(type, opportunityId);
  const accept = useAcceptAgreement();
  const [read, setRead] = useState(false);
  const p = preview.data;

  if (preview.isLoading) return <p className="text-sm text-muted">{t.common.loading}</p>;
  if (preview.isError || !p) return <FormAlert message={t.agreements.unavailable} />;

  const changed = (accept.error as { code?: string } | null)?.code === '40001';

  return (
    <div className="rounded-lg border border-border bg-surface p-4" data-testid={`agreement-${type}`}>
      <div className="flex items-start gap-2">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-action" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-primary">{p.title}</h3>
          <p className="text-[11px] text-muted">{t.agreements.version(p.version)}</p>
        </div>
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-bg p-3 text-sm text-ink">
        {p.body}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-action"
          checked={read}
          onChange={(e) => setRead(e.target.checked)}
        />
        {t.agreements.readAndAccept}
      </label>
      <p className="mt-1 text-[11px] text-muted">{t.agreements.recordNotice}</p>
      <FormAlert message={changed ? t.agreements.changed : accept.isError ? t.common.error : null} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!read || accept.isPending}
          onClick={async () => {
            // mutateAsync: o aceite invalida consultas que podem desmontar este card antes de um
            // onSuccess por chamada rodar; a promise resolve mesmo assim.
            await accept.mutateAsync({ type, opportunityId, bodyHash: p.body_hash }).then(
              () => onAccepted?.(),
              () => undefined, // erro já aparece via accept.isError
            );
          }}
        >
          {accept.isPending ? t.agreements.accepting : t.agreements.accept}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t.agreements.cancel}
          </Button>
        )}
      </div>
    </div>
  );
}
