'use client';

/*
 * Operations.
 * Data: background queues (waiting / active / delayed / failed per queue), the outbox by state, the
 * jobs and events that exhausted their retries (name, queue, error, attempts, when, payload), the
 * inventory ledger's reconciliation (variants checked, mismatches with stock against ledger), and live
 * low-stock alerts over SSE. Opened by the admin when something looks wrong, a few times a week.
 * Jobs: retry or discard dead-lettered work (most frequent), reconcile the stock ledger.
 *
 * Question: is any background work stuck or failed?
 * Finding: how much work is dead-lettered and whether stock matches its ledger.
 * Face: zeros printed as zeros down the queue table, so a quiet system reads as checked, not empty.
 */

import { RefreshCw } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BlockError,
  Dash,
  Empty,
  fmtCount,
  fmtWhen,
  LiveDot,
  LoadingRows,
  PageHeader,
  Panel,
  Pill,
  plural,
  ShortId,
  Tabs,
} from '@/components/admin/ledger';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { cn } from '@/lib/utils';

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

const CAP = 8;
const humanQueue = (q: string) => q.replace(/[-_.]/g, ' ').replace(/^\w/, c => c.toUpperCase());

function useJobs() {
  const [overview, setOverview] = useState<JobsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    api<JobsOverview>('/admin/jobs')
      .then(o => {
        setOverview(o);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);
  return { overview, failed, load };
}

function DeadLetters({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<DeadLetter[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<'all' | 'job' | 'event'>('all');
  const [inspect, setInspect] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    const qs = source === 'all' ? '' : `?source=${source}`;
    api<{ items: DeadLetter[] }>(`/admin/jobs/dead-letters${qs}`)
      .then(d => {
        setItems(d.items);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [source]);
  useEffect(load, [load]);

  const act = async (d: DeadLetter, action: 'retry' | 'discard') => {
    try {
      await api(`/admin/jobs/dead-letters/${d.source}/${d.id}${action === 'retry' ? '/retry' : ''}`, {
        method: action === 'retry' ? 'POST' : 'DELETE',
      });
      toast.success(action === 'retry' ? `Re-queued ${d.name}` : `Discarded ${d.name}`);
      load();
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Panel
      title="Dead letters"
      meta={items ? plural(items.length, 'item') : null}
      bodyClassName="px-0 pb-0 pt-0"
      action={
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={load} aria-label="Refresh dead letters">
          <RefreshCw />
        </Button>
      }
    >
      <Tabs
        className="mx-0 px-5 sm:px-5"
        ariaLabel="Source"
        value={source}
        onChange={setSource}
        options={[
          { value: 'all', label: 'All' },
          { value: 'job', label: 'Jobs' },
          { value: 'event', label: 'Events' },
        ]}
      />
      {failed && !items ? (
        <div className="px-5 py-4">
          <BlockError what="dead letters" onRetry={load} />
        </div>
      ) : items === null ? (
        <LoadingRows rows={3} className="px-5" />
      ) : items.length === 0 ? (
        <div className="px-5 py-4">
          <Empty data-testid="dlq-empty">Nothing dead-lettered. Failed work retries with backoff before it lands here.</Empty>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Job or event</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Failed</TableHead>
              <TableHead className="pr-5">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(showAll ? items : items.slice(0, CAP)).map(d => (
              <Fragment key={`${d.source}:${d.id}`}>
                <TableRow>
                  <TableCell className="max-w-0 pl-5 md:max-w-none">
                    <p className="truncate">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        · {d.source === 'job' ? 'Job' : 'Event'} in {humanQueue(d.queue)}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={d.error}>
                      {d.error}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(d.attempts)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-right sm:table-cell">
                    {d.failedAt ? fmtWhen(d.failedAt) : <Dash />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap pr-5 text-right">
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" className="h-8 px-3" onClick={() => setInspect(inspect === d.id ? null : d.id)}>
                        {inspect === d.id ? 'Close' : 'Inspect'}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => act(d, 'retry')}>
                        Retry
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-3 text-muted-foreground" onClick={() => act(d, 'discard')}>
                        Discard
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
                {inspect === d.id && (
                  <TableRow>
                    <TableCell colSpan={4} className="px-5">
                      <p className="mb-2 text-[13px]">{d.error}</p>
                      <p className="mb-2 text-xs text-muted-foreground">
                        Id <ShortId id={d.id} />
                        {d.requestId && (
                          <>
                            {' '}
                            · request <ShortId id={d.requestId} />
                          </>
                        )}
                      </p>
                      <pre className="max-h-72 overflow-auto bg-secondary p-3 font-mono text-xs">{JSON.stringify(d.data, null, 2)}</pre>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
      {items && items.length > CAP && (
        <div className="border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => setShowAll(v => !v)}>
            {showAll ? `Show the first ${CAP}` : `Show all ${fmtCount(items.length)}`}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Queues({ overview, failed, onRetry }: { overview: JobsOverview | null; failed: boolean; onRetry: () => void }) {
  const outbox = overview ? Object.entries(overview.outbox) : [];
  return (
    <Panel
      title="Queues"
      meta={overview ? (overview.backend === 'bullmq' ? 'BullMQ on Redis' : 'In process') : null}
      data-testid="ops-queues"
      bodyClassName="px-0 pb-0 pt-1"
      action={
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onRetry} aria-label="Refresh queues">
          <RefreshCw />
        </Button>
      }
    >
      {failed && !overview ? (
        <div className="px-5 pb-4">
          <BlockError what="the queues" onRetry={onRetry} />
        </div>
      ) : !overview ? (
        <LoadingRows rows={3} className="px-5" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Queue</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Delayed</TableHead>
                <TableHead className="pr-5 text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.queues.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="px-5 text-muted-foreground">
                    No queues are registered.
                  </TableCell>
                </TableRow>
              )}
              {overview.queues.map(q => (
                <TableRow key={q.queue}>
                  <TableCell className="pl-5">{humanQueue(q.queue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(q.waiting)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(q.active)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCount(q.delayed)}</TableCell>
                  <TableCell className={cn('pr-5 text-right tabular-nums', q.failed > 0 && 'font-semibold text-destructive')}>
                    {fmtCount(q.failed)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border px-5 py-3 text-sm">
            <span>Outbox</span>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {outbox.length ? outbox.map(([k, v]) => `${fmtCount(v)} ${k}`).join(' · ') : 'Empty'}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

function Inventory() {
  const [report, setReport] = useState<Reconciliation | null>(null);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setReport(await api<Reconciliation>('/admin/inventory/reconcile'));
      setCheckedAt(new Date());
      setFailed(false);
    } catch (e) {
      setFailed(true);
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
    <div className="space-y-4" data-testid="ops-inventory">
      <Panel
        title="Inventory ledger"
        meta={checkedAt ? `Checked ${checkedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}` : null}
        action={
          <Button size="sm" variant="outline" className="h-8 px-3" onClick={run} disabled={running}>
            {running ? 'Reconciling…' : 'Reconcile now'}
          </Button>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Replays the append-only stock ledger and compares it with every size&apos;s stock.
        </p>
        {failed && !report ? (
          <BlockError what="the reconciliation" onRetry={run} className="mt-2" />
        ) : !report ? (
          <LoadingRows rows={1} />
        ) : (
          <>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="reconcile-result">
              <Pill tone={report.ok ? 'positive' : 'negative'}>{report.ok ? 'In balance' : 'Out of balance'}</Pill>
              <span>
                {plural(report.variantsChecked, 'size')} checked, {fmtCount(report.mismatches.length)} mismatched.
              </span>
            </p>
            {report.mismatches.length > 0 && (
              <Table className="mt-3">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-0">Piece</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="pr-0 text-right">Ledger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.mismatches.map(m => (
                    <TableRow key={`${m.productId}:${m.size}`}>
                      <TableCell className="pl-0">{m.title}</TableCell>
                      <TableCell>{m.size}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCount(m.stock)}</TableCell>
                      <TableCell className="pr-0 text-right tabular-nums">{fmtCount(m.ledger)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Panel>

      <Panel title="Low-stock alerts" meta={<LiveDot live={live} />}>
        {alerts.length === 0 ? (
          <Empty>No size has dropped below its threshold since you opened this page.</Empty>
        ) : (
          <ul className="divide-y divide-border/70 text-sm">
            {alerts.map(a => (
              <li key={`${a.productId}:${a.size}:${a.at}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  Size {a.size} of <ShortId id={a.productId} />
                  <span className="block text-xs text-muted-foreground">{fmtWhen(a.at)}</span>
                </span>
                <span className="flex-none tabular-nums">
                  {fmtCount(a.stock)} <span className="text-muted-foreground">/ {fmtCount(a.threshold)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function AdminOperationsPage() {
  const { user } = useAuth();
  const canSeeInventory = !!user && typeof user === 'object' && user.permissions.includes('catalog:write');
  const jobs = useJobs();
  const dead = jobs.overview ? jobs.overview.deadLetters.jobs + jobs.overview.deadLetters.events : null;
  const failing = jobs.overview?.queues.reduce((s, q) => s + q.failed, 0) ?? 0;

  const finding =
    dead === null
      ? null
      : dead === 0 && failing === 0
        ? 'Nothing is dead-lettered and no queue has failed jobs.'
        : `${
            [
              jobs.overview!.deadLetters.jobs ? plural(jobs.overview!.deadLetters.jobs, 'job') : '',
              jobs.overview!.deadLetters.events ? plural(jobs.overview!.deadLetters.events, 'event') : '',
            ]
              .filter(Boolean)
              .join(' and ') || 'Nothing'
          } dead-lettered${
            // The queues' failed count usually is the dead letters; say it only when it adds something.
            failing && failing !== jobs.overview!.deadLetters.jobs ? `; ${plural(failing, 'job')} failed in the queues` : ''
          }.`;

  return (
    <div data-testid="admin-operations-page">
      <PageHeader title="Operations" finding={finding} />
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <DeadLetters onChange={jobs.load} />
        <div className="min-w-0 space-y-4">
          <Queues overview={jobs.overview} failed={jobs.failed} onRetry={jobs.load} />
          {canSeeInventory && <Inventory />}
        </div>
      </div>
    </div>
  );
}
