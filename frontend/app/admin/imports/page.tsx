'use client';

/*
 * Imports.
 * Data: CSV uploads (file name, size, status, rows, created / updated / failed counts, progress, row
 * errors, a failure message), polled every 1.5 s while one is running. Opened by the catalogue manager
 * when a supplier sends a new range, a few times a month. Jobs: upload a CSV (most frequent), read and
 * download the rows that failed.
 *
 * Question: did the last upload go in cleanly?
 * Finding: what the latest upload created, updated and rejected.
 * Face: each upload as a ledger line, created / updated / failed in right-aligned columns that add up
 * to its rows, with the rows that failed one click away.
 */

import { Download, Upload } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BlockError,
  Empty,
  fmtCount,
  fmtWhen,
  LoadingRows,
  PageHeader,
  Panel,
  Pill,
  plural,
  type PillTone,
} from '@/components/admin/ledger';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, apiUpload, apiUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

type ImportStatus = 'queued' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';

interface ImportRowError {
  row: number;
  slug?: string;
  messages: string[];
}

interface ProductImport {
  id: string;
  filename: string;
  size: number;
  status: ImportStatus;
  rows: number;
  created: number;
  updated: number;
  failed: number;
  progress: number;
  errorCount: number;
  errorsTruncated: boolean;
  failure?: string;
  createdAt: string;
  finishedAt?: string;
}

const ACTIVE: ImportStatus[] = ['queued', 'processing'];
const STATUS: Record<ImportStatus, { label: string; tone: PillTone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Importing', tone: 'chart' },
  completed: { label: 'Imported', tone: 'positive' },
  completed_with_errors: { label: 'Some rows failed', tone: 'warning' },
  failed: { label: 'Failed', tone: 'negative' },
};

const COLUMNS = [
  ['title', 'The piece’s name'],
  ['slug', 'Its URL key; an existing slug updates that piece'],
  ['category', 'Men, Women, Footwear or Accessories'],
  ['price, compare_at_price', 'In rupees'],
  ['images', 'URLs separated by |'],
  ['sizes', 'SIZE:QTY separated by |, e.g. S:5|M:12'],
  ['featured', 'true or false'],
] as const;

const TEMPLATE = [
  'title,slug,category,description,price,compare_at_price,images,sizes,featured',
  'Linen Camp Shirt,linen-camp-shirt,Men,"Breathable, relaxed fit",2499,2999,https://images.unsplash.com/photo-1596755094514-f87e34085b2c,S:5|M:12|L:8,true',
].join('\n');

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export default function AdminImportsPage() {
  const [imports, setImports] = useState<ProductImport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, ImportRowError[]>>({});
  const [uploading, setUploading] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<ProductImport[]>('/admin/imports')
      .then(list => {
        setImports(list);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const active = imports?.some(i => ACTIVE.includes(i.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 1_500);
    return () => clearInterval(timer);
  }, [active, load]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return toast.error('Choose a CSV file first');
    const form = new FormData();
    form.append('file', file);
    setUploading(true);
    try {
      const res = await apiUpload<{ duplicate: boolean; import: ProductImport }>('/admin/imports', form);
      toast[res.duplicate ? 'info' : 'success'](
        res.duplicate ? `This exact file was already imported (${res.import.filename})` : 'Import queued',
      );
      if (fileInput.current) fileInput.current.value = '';
      setChosen(null);
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const showErrors = async (id: string) => {
    if (errors[id]) return setErrors(({ [id]: _, ...rest }) => rest);
    try {
      const detail = await api<{ errors: ImportRowError[] }>(`/admin/imports/${id}`);
      setErrors(prev => ({ ...prev, [id]: detail.errors }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const downloadReport = async (imp: ProductImport) => {
    const res = await fetch(apiUrl(`/admin/imports/${imp.id}/errors.csv`), { credentials: 'include' });
    if (!res.ok) return toast.error('Could not download the error report');
    downloadText(`${imp.filename.replace(/\.csv$/i, '')}-errors.csv`, await res.text());
  };

  const latest = imports?.[0];
  const finding = !imports
    ? null
    : !latest
      ? 'Nothing has been imported yet.'
      : ACTIVE.includes(latest.status)
        ? `${latest.filename} is importing: ${Math.round(latest.progress * 100)}% of ${plural(latest.rows, 'row')}.`
        : latest.status === 'failed'
          ? `${latest.filename} failed${latest.failure ? `: ${latest.failure}` : ''}.`
          : `${latest.filename} created ${fmtCount(latest.created)} and updated ${fmtCount(latest.updated)} ${latest.updated === 1 ? 'piece' : 'pieces'}${
              latest.failed ? `; ${plural(latest.failed, 'row')} failed` : ', with no failed rows'
            }.`;

  return (
    <div data-testid="admin-imports-page">
      <PageHeader title="Imports" finding={finding} />

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Upload a CSV" meta="Creates or updates pieces by slug">
            <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 min-w-0 flex-1 cursor-pointer items-center border border-dashed border-input px-3 text-sm hover:border-foreground/40">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  data-testid="import-file"
                  className="sr-only"
                  onChange={e => setChosen(e.target.files?.[0]?.name ?? null)}
                />
                <span className={cn('truncate', !chosen && 'text-muted-foreground')}>{chosen ?? 'Choose a .csv file…'}</span>
              </label>
              <Button type="submit" size="sm" className="h-9" disabled={uploading} data-testid="import-upload">
                <Upload /> {uploading ? 'Uploading…' : 'Upload CSV'}
              </Button>
            </form>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Stock changes are written to the inventory ledger, and uploading the same file twice changes nothing.
            </p>
          </Panel>
          <section className="border border-border bg-card">
            <header className="flex min-h-[52px] items-center justify-between px-5 pt-2">
              <h2 className="text-base font-semibold">Uploads</h2>
              {imports && <span className="text-[13px] text-muted-foreground">{plural(imports.length, 'file')}</span>}
            </header>
            {failed && !imports ? (
              <div className="px-5 pb-4">
                <BlockError what="imports" onRetry={load} />
              </div>
            ) : !imports ? (
              <LoadingRows rows={3} className="px-5" />
            ) : imports.length === 0 ? (
              <div className="px-5 pb-5">
                <Empty>No uploads yet. Download the template, fill it in and upload it above.</Empty>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">File</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Rows</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Created</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Updated</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5">
                      <span className="sr-only">Errors</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map(imp => {
                    const running = ACTIVE.includes(imp.status);
                    return (
                      <Fragment key={imp.id}>
                        <TableRow data-testid={`import-${imp.id}`}>
                          <TableCell className="max-w-0 pl-5 sm:max-w-none">
                            <p className="truncate font-medium">{imp.filename}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {fmtWhen(imp.createdAt)} · {kb(imp.size)}
                            </p>
                            {running && (
                              <span
                                className="mt-1.5 block h-1 max-w-xs bg-secondary"
                                role="progressbar"
                                aria-valuenow={Math.round(imp.progress * 100)}
                              >
                                <span className="block h-full bg-chart" style={{ width: `${Math.round(imp.progress * 100)}%` }} />
                              </span>
                            )}
                            {imp.failure && <p className="mt-1 text-xs text-destructive">{imp.failure}</p>}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtCount(imp.rows)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtCount(imp.created)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">{fmtCount(imp.updated)}</TableCell>
                          <TableCell className={cn('text-right tabular-nums', imp.failed > 0 && 'font-semibold')}>
                            {fmtCount(imp.failed)}
                          </TableCell>
                          <TableCell>
                            <Pill tone={STATUS[imp.status].tone}>{STATUS[imp.status].label}</Pill>
                          </TableCell>
                          <TableCell className="whitespace-nowrap pr-5 text-right">
                            {imp.errorCount > 0 && (
                              <span className="inline-flex gap-1">
                                <Button size="sm" variant="ghost" className="h-8 px-3" onClick={() => showErrors(imp.id)}>
                                  {errors[imp.id] ? 'Hide rows' : 'Failed rows'}
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => downloadReport(imp)}>
                                  <Download /> Report
                                </Button>
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                        {errors[imp.id] && (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-secondary/40 px-5">
                              <ul className="space-y-1 text-[13px]">
                                {errors[imp.id].map(err => (
                                  <li key={err.row}>
                                    <span className="font-medium tabular-nums">Row {err.row}</span>
                                    {err.slug && <span className="text-muted-foreground"> ({err.slug})</span>}: {err.messages.join('; ')}
                                  </li>
                                ))}
                                {imp.errorsTruncated && (
                                  <li className="text-muted-foreground">More rows are in the downloadable report.</li>
                                )}
                              </ul>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
        <Panel
          title="Columns"
          action={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => downloadText('products-template.csv', `${TEMPLATE}\n`)}
            >
              <Download className="h-3.5 w-3.5" /> Template
            </button>
          }
        >
          <dl className="space-y-1.5 text-[13px]">
            {COLUMNS.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                <dt className="font-medium">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
