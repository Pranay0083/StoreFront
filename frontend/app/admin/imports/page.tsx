'use client';

import { Download, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiUpload, apiUrl, fmtDateTime } from '@/lib/api';

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
const BADGE: Record<ImportStatus, 'outline' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  queued: 'outline',
  processing: 'secondary',
  completed: 'success',
  completed_with_errors: 'warning',
  failed: 'destructive',
};

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

export default function AdminImportsPage() {
  const [imports, setImports] = useState<ProductImport[] | null>(null);
  const [errors, setErrors] = useState<Record<string, ImportRowError[]>>({});
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<ProductImport[]>('/admin/imports')
      .then(setImports)
      .catch(e => toast.error((e as Error).message));
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
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const showErrors = async (id: string) => {
    if (errors[id]) return setErrors(({ [id]: _, ...rest }) => rest);
    const detail = await api<{ errors: ImportRowError[] }>(`/admin/imports/${id}`);
    setErrors(prev => ({ ...prev, [id]: detail.errors }));
  };

  const downloadReport = async (imp: ProductImport) => {
    const res = await fetch(apiUrl(`/admin/imports/${imp.id}/errors.csv`), { credentials: 'include' });
    if (!res.ok) return toast.error('Could not download the error report');
    downloadText(`${imp.filename.replace(/\.csv$/i, '')}-errors.csv`, await res.text());
  };

  return (
    <div data-testid="admin-imports-page">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Bulk product import</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Upload a CSV to create or update products by slug. Prices are in rupees, images are separated by <code>|</code>, and stock is{' '}
        <code>SIZE:QTY|SIZE:QTY</code>. Stock changes are recorded in the inventory ledger, and re-uploading the same file is a no-op.
      </p>

      <form onSubmit={upload} className="mt-6 flex flex-wrap items-center gap-3 border border-black/10 bg-white p-4">
        <input ref={fileInput} type="file" accept=".csv,text/csv" data-testid="import-file" className="text-sm" />
        <Button type="submit" size="sm" disabled={uploading} data-testid="import-upload">
          <Upload className="mr-2 h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload CSV'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => downloadText('products-template.csv', `${TEMPLATE}\n`)}>
          <Download className="mr-2 h-4 w-4" /> Template
        </Button>
      </form>

      <div className="mt-6 space-y-3">
        {imports === null && <Skeleton className="h-24" />}
        {imports?.length === 0 && <p className="text-sm text-muted-foreground">No imports yet.</p>}
        {imports?.map(imp => (
          <div key={imp.id} className="border border-black/10 bg-white p-4" data-testid={`import-${imp.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {imp.filename} <Badge variant={BADGE[imp.status]}>{imp.status.replace(/_/g, ' ')}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(imp.createdAt)} · {(imp.size / 1024).toFixed(1)} KB · {imp.rows} rows · {imp.created} created · {imp.updated}{' '}
                  updated · {imp.failed} failed
                </p>
              </div>
              {imp.errorCount > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => showErrors(imp.id)}>
                    {errors[imp.id] ? 'Hide errors' : 'Show errors'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadReport(imp)}>
                    <Download className="mr-2 h-4 w-4" /> Error report
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-3 h-1.5 w-full bg-black/5" role="progressbar" aria-valuenow={Math.round(imp.progress * 100)}>
              <div
                className={`h-full transition-all ${imp.status === 'failed' ? 'bg-destructive' : 'bg-black'}`}
                style={{ width: `${Math.round(imp.progress * 100)}%` }}
              />
            </div>
            {imp.failure && <p className="mt-2 text-sm text-destructive">{imp.failure}</p>}
            {errors[imp.id] && (
              <ul className="mt-3 space-y-1 text-xs">
                {errors[imp.id].map(err => (
                  <li key={err.row}>
                    <span className="font-mono">Row {err.row}</span>
                    {err.slug && <span className="text-muted-foreground"> ({err.slug})</span>}: {err.messages.join('; ')}
                  </li>
                ))}
                {imp.errorsTruncated && <li className="text-muted-foreground">More errors are in the downloadable report.</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
