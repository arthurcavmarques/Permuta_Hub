import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Undo2, Upload } from 'lucide-react';
import { t } from '@/i18n/pt-BR';
import { cn } from '@/lib/utils';
import { formatArea } from '@/lib/format';
import { toCsv } from '@/lib/csv';
import { findHeader, parseLandbank, type Cell, type LandbankMapping } from '@/lib/import/landbank';
import { parseBuyers, type BuyersMapping } from '@/lib/import/buyers';
import { readTableBytes, sha256Hex } from '@/lib/import/table';
import { normalizeKey } from '@/lib/import/text';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Badge, FormAlert, Notice, Section } from '@/components/ui/section';
import { StatusBadge } from '@/components/ui/status-badge';
import { FullPageMessage } from '@/app/guards';
import { useAssetTypes } from '@/features/opportunities/asset-types';
import type { OpportunityStatus } from '@/features/opportunities/types';
import {
  downloadCsv,
  fetchBatchReport,
  fieldsOf,
  useImportBatches,
  useImportConflicts,
  useImportMapping,
  usePublishableOverview,
  useResolveConflict,
  useRunImport,
  useSaveImportMapping,
  useUndoBatch,
  type ImportBatch,
  type ImportKind,
  type ImportResult,
  type ImportRowResult,
} from './import-api';
import type { BlockerCode } from './curation-api';

const c = t.admin.import;
const STATUSES = Object.keys(t.enums.status) as OpportunityStatus[];
const PREVIEW_ROWS = 50;
const label = (f: string) => c.fields[f] ?? f;
/** Avisos vêm do banco/parser com códigos (status, pendências): troca pelos rótulos da interface. */
const humanize = (w: string) =>
  w
    .replace(/"([a-z_]+)"/g, (m, code: string) =>
      code in t.enums.status ? `"${t.enums.status[code as OpportunityStatus]}"` : m,
    )
    .replace(
      /(?<![a-z_])(missing_[a-z_]+|no_[a-z_]+|mandate_unknown|responsible_creci_not_verified)(?![a-z_])/g,
      (m) => (t.curation.blockers as Record<string, string>)[m]?.toLowerCase() ?? m,
    );
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : t.common.error);

interface LoadedFile {
  name: string;
  bytes: Uint8Array;
  sha: string;
  sheets: string[];
  sheet: string | null;
  rows: Cell[][];
}

type Mapping = LandbankMapping | BuyersMapping;

export function AdminImportPage() {
  return (
    <div className="space-y-6">
      <ImportForm />
      <ConflictsSection />
      <BatchesSection />
    </div>
  );
}

// ---------------------------------------------------------------- importar
function ImportForm() {
  const [kind, setKind] = useState<ImportKind>('landbank');
  const stored = useImportMapping(kind);
  const save = useSaveImportMapping(kind);
  const run = useRunImport();
  const assetTypes = useAssetTypes();
  // Rascunho local do mapeamento; sem rascunho, vale o salvo no banco.
  const [draft, setDraft] = useState<Mapping | null>(null);
  const mapping = draft ?? (stored.data as Mapping | undefined) ?? null;
  const dirty = draft !== null;
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<{ signature: string; result: ImportResult } | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  const load = async (f: File, sheet?: string) => {
    setReading(true);
    setFileError(null);
    setPreview(null);
    setDone(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const table = await readTableBytes(bytes, f.name, sheet);
      setFile({ name: f.name, bytes, sha: await sha256Hex(bytes), ...table });
    } catch (err) {
      setFile(null);
      setFileError(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const parsed = useMemo(() => {
    if (!file || !mapping) return null;
    try {
      return kind === 'landbank'
        ? { kind, ...parseLandbank(file.rows, mapping as LandbankMapping) }
        : { kind, ...parseBuyers(file.rows, mapping as BuyersMapping) };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }, [file, mapping, kind]);

  const signature =
    file && mapping ? `${kind}|${file.sha}|${file.sheet}|${JSON.stringify(mapping)}` : '';
  const previewValid = preview?.signature === signature;

  const editMapping = (fn: (m: Mapping) => void) => {
    if (!mapping) return;
    const next = structuredClone(mapping);
    fn(next);
    setDraft(next);
  };

  const request = (dryRun: boolean) => {
    if (!file || !mapping || !parsed || 'error' in parsed) return;
    run.mutate(
      {
        kind,
        fileName: file.name,
        fileSha256: file.sha,
        mapping,
        rows: parsed.valid,
        parseReport: {
          sheet: file.sheet,
          header_line: parsed.headerLine,
          recognized_columns: parsed.recognizedColumns,
          unrecognized_columns: parsed.unrecognizedColumns,
          ignored: parsed.ignored,
          rejected: parsed.rejected,
        },
        dryRun,
      },
      {
        onSuccess: (result) => {
          if (dryRun) {
            setDone(null);
            setPreview({ signature, result });
          } else {
            setPreview(null);
            setDone(result);
          }
        },
      },
    );
  };

  // Valores da planilha sem equivalência (status e tipo de ativo), para o mapeamento editável.
  const unmapped = useMemo(() => {
    const out = { statuses: [] as string[], assets: [] as string[] };
    if (!parsed || 'error' in parsed || parsed.kind !== 'landbank' || !file || !mapping) return out;
    const lb = mapping as LandbankMapping;
    const statuses = new Set<string>();
    for (const v of parsed.valid) {
      const raw = (v.opportunity.extra.landbank as { status_raw?: string | null }).status_raw;
      if (raw && !v.opportunity.status) statuses.add(raw);
    }
    const header = findHeader(file.rows, lb);
    const col = header?.index.asset_type;
    const assets = new Set<string>();
    if (header && col !== undefined) {
      for (const v of parsed.valid) {
        const raw = file.rows[v.line - 1]?.[col];
        if (raw !== null && raw !== undefined && String(raw).trim() && !v.opportunity.asset_type)
          assets.add(String(raw).trim());
      }
    }
    out.statuses = [...statuses].sort();
    out.assets = [...assets].sort();
    return out;
  }, [parsed, file, mapping]);

  if (stored.isLoading || !mapping) return <FullPageMessage title={t.common.loading} />;

  const fieldKeys = Object.keys(mapping.columns);
  const result = done ?? (previewValid ? preview.result : null);

  return (
    <Section title={c.title} description={c.body}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="imp-kind">{c.kind}</Label>
          <Select
            id="imp-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              setDraft(null);
              setPreview(null);
              setDone(null);
            }}
          >
            {(Object.keys(c.kinds) as ImportKind[]).map((k) => (
              <option key={k} value={k}>
                {c.kinds[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="imp-file">{c.file}</Label>
          <Input
            id="imp-file"
            type="file"
            accept=".csv,.xlsx,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
            }}
          />
        </div>
      </div>
      {kind === 'buyers' && (
        <Notice tone="warning" className="mt-4">
          {c.buyersNotice}
        </Notice>
      )}
      {reading && <p className="mt-4 text-sm text-muted">{c.reading}</p>}
      <FormAlert message={fileError} />

      {file && file.sheets.length > 1 && (
        <div className="mt-4 max-w-xs space-y-1.5">
          <Label htmlFor="imp-sheet">{c.sheet}</Label>
          <Select
            id="imp-sheet"
            value={file.sheet ?? ''}
            onChange={async (e) => {
              const table = await readTableBytes(file.bytes, file.name, e.target.value);
              setFile({ ...file, ...table });
              setPreview(null);
            }}
          >
            {file.sheets.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
      )}

      {parsed && 'error' in parsed && <FormAlert message={parsed.error ?? null} />}

      {parsed && !('error' in parsed) && (
        <div className="mt-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-ink">{c.columnsTitle}</h3>
            <p className="text-xs text-muted">
              {c.headerAt(parsed.headerLine)} {c.columnsBody}
            </p>
            <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2" data-testid="import-columns">
              {Object.entries(parsed.recognizedColumns).map(([field, header]) => (
                <li key={field} className="flex items-center gap-2">
                  <span className="truncate">{header}</span>
                  <span className="text-muted">→</span>
                  <Badge tone="success">{label(field)}</Badge>
                </li>
              ))}
              {parsed.unrecognizedColumns.map((header) => (
                <li key={header} className="flex items-center gap-2">
                  <span className="truncate">{header}</span>
                  <span className="text-muted">→</span>
                  <Select
                    aria-label={header}
                    className="h-8 max-w-48 text-xs"
                    value=""
                    onChange={(e) =>
                      editMapping((m) => {
                        const key = normalizeKey(header);
                        for (const f of Object.keys(m.columns))
                          m.columns[f] = m.columns[f].filter((a) => a !== key);
                        m.columns[e.target.value] = [key, ...(m.columns[e.target.value] ?? [])];
                      })
                    }
                  >
                    <option value="">{c.ignoreColumn}</option>
                    {fieldKeys
                      .filter((f) => !(f in parsed.recognizedColumns))
                      .map((f) => (
                        <option key={f} value={f}>
                          {label(f)}
                        </option>
                      ))}
                  </Select>
                </li>
              ))}
            </ul>
          </div>

          {unmapped.statuses.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink">{c.statusTitle}</h3>
              <p className="text-xs text-muted">{c.statusBody}</p>
              <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2" data-testid="import-statuses">
                {unmapped.statuses.map((raw) => (
                  <li key={raw} className="flex items-center gap-2">
                    <span className="truncate">“{raw}”</span>
                    <span className="text-muted">→</span>
                    <Select
                      aria-label={raw}
                      className="h-8 max-w-48 text-xs"
                      value=""
                      onChange={(e) =>
                        editMapping((m) => {
                          (m as LandbankMapping).status_map[normalizeKey(raw)] = e.target
                            .value as OpportunityStatus;
                        })
                      }
                    >
                      <option value="">{c.notMapped}</option>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t.enums.status[s]}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unmapped.assets.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink">{c.assetTitle}</h3>
              <p className="text-xs text-muted">{c.assetBody}</p>
              <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {unmapped.assets.map((raw) => (
                  <li key={raw} className="flex items-center gap-2">
                    <span className="truncate">“{raw}”</span>
                    <span className="text-muted">→</span>
                    <Select
                      aria-label={raw}
                      className="h-8 max-w-48 text-xs"
                      value=""
                      onChange={(e) =>
                        editMapping((m) => {
                          const lb = m as LandbankMapping;
                          lb.asset_type_map = {
                            ...lb.asset_type_map,
                            [normalizeKey(raw)]: e.target.value,
                          };
                        })
                      }
                    >
                      <option value="">{c.notMapped}</option>
                      {(assetTypes.data ?? []).map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {dirty && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => save.mutate(mapping, { onSuccess: () => setDraft(null) })}
                >
                  {c.saveMapping}
                </Button>
                <span className="text-xs text-muted">{c.mappingDirty}</span>
              </>
            )}
            {save.isSuccess && !dirty && (
              <span className="text-xs text-muted">{c.mappingSaved}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => request(true)} disabled={run.isPending}>
              {run.isPending && !previewValid ? c.previewing : c.preview}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => request(false)}
              disabled={!previewValid || run.isPending}
            >
              <Upload className="size-4" aria-hidden />
              {run.isPending && previewValid ? c.importing : c.confirm}
            </Button>
          </div>
          {run.isError && <FormAlert message={errorMessage(run.error)} />}

          {result && (
            <ResultView
              result={result}
              title={done ? c.resultTitle : c.previewTitle}
              issues={[...parsed.rejected, ...parsed.ignored]}
            />
          )}
        </div>
      )}
    </Section>
  );
}

function ResultView({
  result,
  title,
  issues,
}: {
  result: ImportResult;
  title: string;
  issues: Array<{ line: number; reason: string; memorial_number?: string }>;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? result.rows : result.rows.slice(0, PREVIEW_ROWS);
  const counts = (Object.keys(c.counts) as Array<keyof typeof c.counts>)
    .filter((k) => k in result.counts)
    .map((k) => [k, result.counts[k]] as const);
  const fieldList = (list: ImportRowResult['changes']) =>
    list
      .map((x) =>
        typeof x === 'string'
          ? label(x)
          : x.sensitive
            ? c.sensitiveField(label(x.field))
            : label(x.field),
      )
      .join(', ');
  return (
    <div className="space-y-4" data-testid="import-result">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {result.already_imported_batch_id && <Notice tone="info">{c.alreadyImported}</Notice>}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(([k, v]) => (
          <div key={k} className="rounded-md border border-border p-3" data-testid={`count-${k}`}>
            <dt className="text-xs text-muted">{c.counts[k]}</dt>
            <dd className="tabular text-xl font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{c.cols.line}</th>
              <th className="px-3 py-2 font-medium">{c.cols.md}</th>
              <th className="px-3 py-2 font-medium">{c.cols.action}</th>
              <th className="px-3 py-2 font-medium">{c.cols.changes}</th>
              <th className="px-3 py-2 font-medium">{c.cols.conflicts}</th>
              <th className="px-3 py-2 font-medium">{c.cols.warnings}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={`${r.line}-${i}`} className={cn(r.conflicts.length > 0 && 'bg-warning-bg')}>
                <td className="tabular px-3 py-2">{r.line}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.memorial_number ?? '—'}</td>
                <td className="px-3 py-2">
                  {c.actions[r.action as keyof typeof c.actions] ?? r.action}
                </td>
                <td className="px-3 py-2 text-xs">{fieldList(r.changes) || '—'}</td>
                <td className="px-3 py-2 text-xs">{fieldList(r.conflicts) || '—'}</td>
                <td className="px-3 py-2 text-xs text-muted">
                  {r.warnings.map(humanize).join('; ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!all && result.rows.length > PREVIEW_ROWS && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
          {c.showAll(result.rows.length)}
        </Button>
      )}
      {issues.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-ink">{c.rejectedTitle}</h4>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {issues
              .sort((a, b) => a.line - b.line)
              .map((x) => (
                <li key={x.line}>
                  {c.cols.line} {x.line}
                  {x.memorial_number ? ` (${x.memorial_number})` : ''}: {x.reason}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- conflitos
const show = (v: unknown) =>
  v === null || v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : String(v);

function ConflictsSection() {
  const conflicts = useImportConflicts();
  const resolve = useResolveConflict();
  const rows = conflicts.data ?? [];
  return (
    <Section title={c.conflictsTitle} description={c.conflictsBody}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{c.noConflicts}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="import-conflicts">
          {rows.map((x) => (
            <li
              key={`${x.opportunity_id}-${x.field}`}
              className="flex flex-wrap items-center gap-3 py-3 text-sm"
            >
              <Link
                to={`/admin/areas/${x.opportunity_id}`}
                className="font-medium text-action hover:underline"
              >
                {x.memorial_number}
              </Link>
              <span className="font-medium text-ink">{label(x.field)}</span>
              {x.sensitive ? (
                <span className="text-xs text-muted">{c.restricted}</span>
              ) : (
                <span className="text-xs text-muted">
                  {c.platform}: <strong className="text-ink">{show(x.platform)}</strong> ·{' '}
                  {c.sheetValue}: <strong className="text-ink">{show(x.sheet)}</strong>
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate({
                      opportunityId: x.opportunity_id,
                      field: x.field,
                      useSheet: false,
                    })
                  }
                >
                  {c.keepPlatform}
                </Button>
                {x.field !== 'status' && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={resolve.isPending}
                    onClick={() =>
                      resolve.mutate({
                        opportunityId: x.opportunity_id,
                        field: x.field,
                        useSheet: true,
                      })
                    }
                  >
                    {c.useSheet}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {resolve.isError && <FormAlert message={errorMessage(resolve.error)} />}
    </Section>
  );
}

// ---------------------------------------------------------------- lotes
function BatchesSection() {
  const batches = useImportBatches();
  const rows = batches.data ?? [];
  return (
    <Section title={c.batchesTitle} description={c.batchesBody}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{c.noBatches}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="import-batches">
          {rows.map((b) => (
            <BatchRow key={b.id} b={b} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function BatchRow({ b }: { b: ImportBatch }) {
  const undo = useUndoBatch();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const summary = Object.entries(b.counts)
    .filter(([k, v]) => k in c.counts && v > 0)
    .map(([k, v]) => `${c.counts[k as keyof typeof c.counts]}: ${v}`)
    .join(' · ');
  const exportReport = async () => {
    const report = await fetchBatchReport(b.id);
    const csv = toCsv([
      ...report.rows.map((r) => ({
        linha: r.line,
        md: r.memorial_number ?? '',
        resultado: c.actions[r.action as keyof typeof c.actions] ?? r.action,
        campos: fieldsOf(r.changes ?? [])
          .map(label)
          .join(', '),
        conflitos: fieldsOf(r.conflicts ?? [])
          .map(label)
          .join(', '),
        avisos: [...(r.warnings ?? []).map(humanize), ...(r.kept_fields ?? []).map(label)].join(
          '; ',
        ),
      })),
      ...[...(report.parse?.rejected ?? []), ...(report.parse?.ignored ?? [])].map((x) => ({
        linha: x.line,
        md: 'memorial_number' in x ? (x.memorial_number ?? '') : '',
        resultado: c.cols.reason,
        campos: '',
        conflitos: '',
        avisos: x.reason,
      })),
    ]);
    downloadCsv(csv, `importacao-${b.kind}-${b.created_at.slice(0, 10)}-${b.id.slice(0, 8)}.csv`);
  };
  return (
    <li className="space-y-2 py-3 text-sm" data-testid={`batch-${b.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{b.file_name ?? '—'}</span>
        <Badge>{b.kind === 'kml' ? 'KML' : c.kinds[b.kind]}</Badge>
        {b.undoes_batch_id && <Badge tone="info">{c.undoOf}</Badge>}
        {b.undone_by && <Badge tone="warning">{c.undone}</Badge>}
        <Badge tone={b.chain_ok ? 'success' : 'danger'}>
          {b.chain_ok ? c.chainOk : c.chainBroken}
        </Badge>
        <span className="text-xs text-muted">
          {new Date(b.created_at).toLocaleString('pt-BR')}
          {b.created_by_name ? ` · ${b.created_by_name}` : ''}
        </span>
        <span className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => void exportReport()}>
            <Download className="size-4" aria-hidden />
            {c.report}
          </Button>
          {b.undoable && !confirming && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              <Undo2 className="size-4" aria-hidden />
              {c.undo}
            </Button>
          )}
        </span>
      </div>
      {summary && <p className="text-xs text-muted">{summary}</p>}
      {confirming && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm text-ink">{c.undoConfirm}</p>
          <Input
            aria-label={c.undoNote}
            placeholder={c.undoNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={undo.isPending}
              onClick={() =>
                undo.mutate({ id: b.id, note }, { onSuccess: () => setConfirming(false) })
              }
            >
              {c.undo}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t.common.cancel}
            </Button>
          </div>
          {undo.isError && <FormAlert message={errorMessage(undo.error)} />}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- painel de publicáveis
export function AdminPublishablePage() {
  const p = t.admin.publishable;
  const overview = usePublishableOverview();
  const [onlyImported, setOnlyImported] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [query, setQuery] = useState('');
  if (overview.isLoading) return <FullPageMessage title={t.common.loading} />;
  if (overview.isError) return <FullPageMessage title={t.common.error} />;
  const all = overview.data ?? [];
  const blockerLabel = (b: BlockerCode) => t.curation.blockers[b] ?? b;
  const published = all.filter((a) => a.published_at).length;
  const ready = all.filter((a) => !a.published_at && a.blockers.length === 0).length;
  const blocked = all.filter((a) => !a.published_at && a.blockers.length > 0).length;
  const top = Object.entries(
    all.reduce<Record<string, number>>((acc, a) => {
      for (const b of a.blockers) acc[b] = (acc[b] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const q = query.trim().toLowerCase();
  const rows = all.filter(
    (a) =>
      (!onlyImported || a.imported) &&
      (!onlyBlocked || (!a.published_at && a.blockers.length > 0)) &&
      (!q ||
        a.memorial_number.toLowerCase().includes(q) ||
        `${a.neighborhood ?? ''} ${a.city ?? ''}`.toLowerCase().includes(q)),
  );
  const exportCsv = () =>
    downloadCsv(
      toCsv(
        rows.map((a) => ({
          md: a.memorial_number,
          bairro: a.neighborhood,
          cidade: a.city,
          status: t.enums.status[a.status],
          mandato: t.enums.mandate[a.mandate_status],
          publicada: a.published_at ? 'sim' : 'não',
          planilha: a.imported ? 'sim' : 'não',
          falta: a.blockers.map(blockerLabel).join('; '),
        })),
      ),
      `publicaveis-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  const tiles: Array<[string, number, string]> = [
    [p.total, all.length, 'total'],
    [p.published, published, 'published'],
    [p.ready, ready, 'ready'],
    [p.blocked, blocked, 'blocked'],
    [p.imported, all.filter((a) => a.imported).length, 'imported'],
    [p.conflicts, all.filter((a) => a.open_conflicts > 0).length, 'conflicts'],
  ];

  return (
    <div className="space-y-6">
      <Section title={p.title} description={p.body}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map(([name, value, key]) => (
            <div
              key={key}
              className="rounded-md border border-border p-3"
              data-testid={`tile-${key}`}
            >
              <dt className="text-xs text-muted">{name}</dt>
              <dd className="tabular text-2xl font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {top.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink">{p.topBlockers}</h3>
            <ul className="mt-2 space-y-1 text-sm" data-testid="top-blockers">
              {top.map(([b, n]) => (
                <li key={b} className="flex items-center gap-3">
                  <span className="tabular w-10 text-right font-medium text-ink">{n}</span>
                  <span
                    className="h-2 rounded bg-action/70"
                    style={{ width: `${Math.max(4, (n / all.length) * 240)}px` }}
                    aria-hidden
                  />
                  <span className="text-muted">{blockerLabel(b as BlockerCode)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder={p.search}
          aria-label={p.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyImported}
            onChange={(e) => setOnlyImported(e.target.checked)}
          />
          {p.onlyImported}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyBlocked}
            onChange={(e) => setOnlyBlocked(e.target.checked)}
          />
          {p.onlyBlocked}
        </label>
        <Button type="button" size="sm" variant="secondary" className="ml-auto" onClick={exportCsv}>
          <Download className="size-4" aria-hidden />
          {p.export}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{p.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm" data-testid="publishable-table">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">MD</th>
                <th className="px-3 py-2 font-medium">{t.curation.areas.place}</th>
                <th className="px-3 py-2 font-medium">{t.dossier.area}</th>
                <th className="px-3 py-2 font-medium">{t.dossier.status}</th>
                <th className="px-3 py-2 font-medium">{t.curation.areas.mandate}</th>
                <th className="px-3 py-2 font-medium">{p.missing}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => (
                <tr key={a.id} data-testid={`publishable-${a.memorial_number}`}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link
                      to={`/admin/areas/${a.id}`}
                      className="font-medium text-action hover:underline"
                    >
                      {a.memorial_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {[a.neighborhood, a.city].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="tabular px-3 py-2">{formatArea(a.area_m2) ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-3 py-2 text-xs">{t.enums.mandate[a.mandate_status]}</td>
                  <td className="px-3 py-2">
                    {a.blockers.length === 0 ? (
                      <Badge tone={a.published_at ? 'success' : 'info'}>
                        {a.published_at ? p.publishedBadge : p.none}
                      </Badge>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {a.published_at && (
                          <li>
                            <Badge tone="success">{p.publishedBadge}</Badge>
                          </li>
                        )}
                        {a.blockers.map((b) => (
                          <li key={b}>
                            <Badge tone="warning">{blockerLabel(b)}</Badge>
                          </li>
                        ))}
                      </ul>
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
