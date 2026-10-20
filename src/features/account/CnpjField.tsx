import { useState } from 'react';
import { BadgeCheck, Search } from 'lucide-react';
import { formatCnpj, isValidCnpj, onlyDigits, type CnpjData } from '@shared/cnpj';
import { t } from '@/i18n/pt-BR';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { FieldError, Notice } from '@/components/ui/section';

export interface CnpjValue {
  cnpj: string; // só dígitos
  lookupId: string | null; // null = manual (fonte fora do ar ou sem consulta)
  data: CnpjData | null;
}

type Lookup =
  | { result: 'ok'; lookup_id: string; data: CnpjData; source: string; verified_at: string }
  | { result: 'invalid' | 'not_found' | 'error' | 'timeout' | 'rate_limited' };

/** A consulta é feita pela Edge Function (servidor). Falha de rede vira "error": o cadastro segue manual. */
async function lookup(cnpj: string): Promise<Lookup> {
  try {
    const { data, error } = await supabase.functions.invoke('registry-lookup', { body: { cnpj } });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      return { result: status === 429 ? 'rate_limited' : 'error' };
    }
    return data as Lookup;
  } catch {
    return { result: 'error' };
  }
}

const SOURCES: Record<string, string> = { brasilapi: 'BrasilAPI', receitaws: 'ReceitaWS' };

/**
 * CNPJ com consulta automática (seção 9.9): valida os dígitos no navegador, consulta pelo servidor e mostra
 * os dados travados com a fonte. Sem resposta da fonte, aceita o número digitado e avisa que a curadoria confere.
 */
export function CnpjField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: CnpjValue | null;
  onChange: (v: CnpjValue | null) => void;
}) {
  const [text, setText] = useState(value ? formatCnpj(value.cnpj) : '');
  const [state, setState] = useState<'idle' | 'loading' | Lookup['result']>(
    value?.lookupId ? 'ok' : 'idle',
  );
  const [meta, setMeta] = useState<{ source: string; at: string } | null>(null);
  const digits = onlyDigits(text);
  const invalid = digits.length > 0 && (digits.length !== 14 || !isValidCnpj(digits));

  const run = async () => {
    if (!isValidCnpj(digits)) return;
    setState('loading');
    const r = await lookup(digits);
    setState(r.result);
    if (r.result === 'ok') {
      setMeta({ source: SOURCES[r.source] ?? r.source, at: r.verified_at });
      onChange({ cnpj: digits, lookupId: r.lookup_id, data: r.data });
    } else if (r.result === 'error' || r.result === 'timeout' || r.result === 'rate_limited') {
      onChange({ cnpj: digits, lookupId: null, data: null }); // segue manual
    } else onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          readOnly={state === 'ok'}
          onChange={(e) => {
            setText(e.target.value);
            setState('idle');
            onChange(null);
          }}
          onBlur={() => digits.length === 14 && state === 'idle' && void run()}
          aria-invalid={invalid}
        />
        {state === 'ok' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setText('');
              setState('idle');
              onChange(null);
            }}
          >
            {t.cnpj.change}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={invalid || digits.length !== 14 || state === 'loading'}
            onClick={run}
          >
            <Search className="h-4 w-4" />
            {state === 'loading' ? t.cnpj.searching : t.cnpj.search}
          </Button>
        )}
      </div>
      <FieldError message={invalid ? t.cnpj.invalid : undefined} />
      {state === 'ok' && value?.data && (
        <div
          className="rounded-md border border-success/40 bg-success-bg p-3 text-sm"
          data-testid="cnpj-data"
        >
          <p className="flex items-center gap-1 font-medium text-success">
            <BadgeCheck className="h-4 w-4" aria-hidden />
            {meta
              ? t.cnpj.verified(formatDate(new Date(meta.at)), meta.source)
              : t.cnpj.verifiedShort}
          </p>
          <dl className="mt-2 grid gap-1 text-ink sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">{t.cnpj.legalName}</dt>
              <dd>{value.data.legal_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t.cnpj.status}</dt>
              <dd>{value.data.registry_status}</dd>
            </div>
            {value.data.trade_name && (
              <div>
                <dt className="text-xs text-muted">{t.cnpj.tradeName}</dt>
                <dd>{value.data.trade_name}</dd>
              </div>
            )}
            {value.data.cnae_main_description && (
              <div>
                <dt className="text-xs text-muted">{t.cnpj.cnae}</dt>
                <dd>{value.data.cnae_main_description}</dd>
              </div>
            )}
          </dl>
          {!value.data.is_active && <p className="mt-2 text-xs text-warning">{t.cnpj.inactive}</p>}
        </div>
      )}
      {state === 'not_found' && <Notice tone="warning">{t.cnpj.notFound}</Notice>}
      {(state === 'error' || state === 'timeout' || state === 'rate_limited') && (
        <Notice tone="warning">{t.cnpj.unavailable}</Notice>
      )}
    </div>
  );
}
