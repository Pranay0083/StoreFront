'use client';

import { RefreshCw } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDateTime } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';

interface QueueCounts {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

interface JobsOverview {
  backend: 'memory' | 'bullmq';
  queues: QueueCounts[];
  outbox: Record<string, number>;
  deadLetters: { jobs: number; events: number };
}

interface DeadLetter {
  source: 'job' | 'event';
  id: string;
  name: string;
  queue: string;
  error: string;
  attempts: number;
  failedAt: string | null;
  requestId?: string;
  data: unknown;
}

interface Reconciliation {
  ok: boolean;
  variantsChecked: number;
  mismatches: Array<{ productId: string; title: string; size: string; stock: number; ledger: number }>;
}

interface StockAlert {
  productId: string;
  size: string;
  stock: number;
  threshold: number;
  at: string;
}

function QueuesAndDeadLetters() {
  const [overview, setOverview] = useState<JobsOverview | null>(null);
  const [items, setItems] = useState<DeadLetter[] | null>(null);
  const [source, setSource] = useState<'all' | 'job' | 'event'>('all');
  const [inspect, setInspect] = useState<string | null>(null);

  const load = useCallback(() => {
    api<JobsOverview>('/admin/jobs')
      .then(setOverview)
      .catch(() => {});
    const qs = source === 'all' ? '' : `?source=${source}`;
    api<{ items: DeadLetter[] }>(`/admin/jobs/dead-letters${qs}`)
      .then(d => setItems(d.items))
      .catch(e => toast.error((e as Error).message));
  }, [source]);
  useEffect(load, [load]);

  const act = async (d: DeadLetter, action: 'retry' | 'discard') => {
    try {
      await api(`/admin/jobs/dead-letters/${d.source}/${d.id}${action === 'retry' ? '/retry' : ''}`, {
        method: action === 'retry' ? 'POST' : 'DELETE',
      });
      toast.success(action === 'retry' ? `Re-queued ${d.name}` : `Discarded ${d.name}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section data-testid="ops-queues">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl font-semibold">Queues</h2>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>
      {overview ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {overview.queues.map(q => (
            <div key={q.queue} className="border border-black/10 bg-white p-4">
              <p className="label-caps text-muted-foreground">{q.queue}</p>
              <p className="mt-2 text-sm tabular-nums">
                {q.waiting} waiting · {q.active} active · {q.delayed} delayed
              </p>
              {q.failed > 0 && <p className="text-xs text-destructive">{q.failed} failed</p>}
            </div>
          ))}
          <div className="border border-black/10 bg-white p-4">
            <p className="label-caps text-muted-foreground">Outbox ({overview.backend})</p>
            <p className="mt-2 text-sm tabular-nums">
              {Object.entries(overview.outbox)
                .map(([k, v]) => `${v} ${k}`)
                .join(' · ') || 'empty'}
            </p>
          </div>
        </div>
      ) : (
        <Skeleton className="mt-4 h-20" />
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-serif text-2xl font-semibold">
          Dead letters{' '}
          {overview && (
            <span className="text-base text-muted-foreground">
              ({overview.deadLetters.jobs} jobs, {overview.deadLetters.events} events)
            </span>
          )}
        </h2>
        <div className="flex gap-1">
          {(['all', 'job', 'event'] as const).map(s => (
            <Button key={s} size="sm" variant={source === s ? 'default' : 'ghost'} onClick={() => setSource(s)}>
              {s}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-4 border border-black/10 bg-white">
        {items === null ? (
          <Skeleton className="m-4 h-20" />
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="dlq-empty">
            Nothing dead-lettered. Failed work retries with backoff before it lands here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job / event</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(d => (
                <Fragment key={`${d.source}:${d.id}`}>
                  <TableRow>
                    <TableCell>
                      <p className="font-mono text-sm">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant="outline">{d.source}</Badge> {d.queue}
                        {d.requestId && ` · req ${d.requestId.slice(0, 8)}`}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs" title={d.error}>
                      {d.error}
                    </TableCell>
                    <TableCell className="tabular-nums">{d.attempts}</TableCell>
                    <TableCell className="text-xs">{d.failedAt ? fmtDateTime(d.failedAt) : '—'}</TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => setInspect(inspect === d.id ? null : d.id)}>
                        Inspect
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => act(d, 'retry')}>
                        Retry
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act(d, 'discard')}>
                        Discard
                      </Button>
                    </TableCell>
                  </TableRow>
                  {inspect === d.id && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <pre className="max-h-72 overflow-auto bg-black/5 p-3 text-xs">{JSON.stringify(d.data, null, 2)}</pre>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

function Inventory() {
  const [report, setReport] = useState<Reconciliation | null>(null);
  const [running, setRunning] = useState(false);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setReport(await api<Reconciliation>('/admin/inventory/reconcile'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, []);
  useEffect(() => {
    run();
  }, [run]);

  const live = useLiveEvents(['stock'], e => {
    const alert = { ...(e.data as unknown as StockAlert), at: new Date().toISOString() };
    setAlerts(prev => [alert, ...prev].slice(0, 20));
    toast.warning(`Low stock: size ${alert.size} has ${alert.stock} left`);
  });

  return (
    <section className="mt-12" data-testid="ops-inventory">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl font-semibold">Inventory ledger</h2>
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          {running ? 'Reconciling…' : 'Reconcile now'}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Replays the append-only stock ledger and compares it with every product variant&apos;s stock.
      </p>
      {report && (
        <div className="mt-4 border border-black/10 bg-white p-4">
          <p className="text-sm" data-testid="reconcile-result">
            <Badge variant={report.ok ? 'success' : 'destructive'}>{report.ok ? 'In balance' : 'Mismatch'}</Badge> {report.variantsChecked}{' '}
            variants checked, {report.mismatches.length} mismatched.
          </p>
          {report.mismatches.length > 0 && (
            <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Ledger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.mismatches.map(m => (
                  <TableRow key={`${m.productId}:${m.size}`}>
                    <TableCell>{m.title}</TableCell>
                    <TableCell>{m.size}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.stock}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.ledger}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
      <h3 className="mt-8 flex items-center gap-2 font-medium">
        Live low-stock alerts <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-600' : 'bg-black/20'}`} />
      </h3>
      {alerts.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Alerts appear here as soon as a sale takes a size below its threshold.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {alerts.map(a => (
            <li key={`${a.productId}:${a.size}:${a.at}`}>
              {fmtDateTime(a.at)} · product <span className="font-mono">{a.productId.slice(-6)}</span> size {a.size}: {a.stock} left
              (threshold {a.threshold})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminOperationsPage() {
  const { user } = useAuth();
  const canSeeInventory = !!user && typeof user === 'object' && user.permissions.includes('catalog:write');
  return (
    <div data-testid="admin-operations-page">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Operations</h1>
      <p className="mt-1 text-sm text-muted-foreground">Background queues, dead-lettered work and inventory integrity.</p>
      <div className="mt-8">
        <QueuesAndDeadLetters />
      </div>
      {canSeeInventory && <Inventory />}
    </div>
  );
}
