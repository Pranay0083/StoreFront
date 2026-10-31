'use client';

/*
 * Audit log.
 * Data: every back-office write (when, who and their role, the permission used, method and path, a
 * summary, the target ids, the HTTP result, the changed fields), 25 at a time, newest first, filterable
 * by target id. Opened by the admin when a question comes up ("who refunded this?"), a few times a
 * month. Jobs: find the changes to one order, product or user (most frequent), read what changed.
 *
 * Question: who changed what, and did it go through?
 * Finding: the latest change and how many of the loaded changes were refused.
 * Face: target ids as short links that filter the log to that object, so one click answers "what
 * else happened to this order?".
 */

import { ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BlockError, Empty, fmtAge, fmtWhen, Initial, LoadingRows, PageHeader, Pill, plural } from '@/components/admin/ledger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type AuditLogEntry, type AuditLogPage } from '@storefront/contracts';

const short = (id: string) => (id.length > 10 ? `${id.slice(0, 8)}…` : id);

/** The route without its version prefix, as the subline shows it. */
const route = (e: AuditLogEntry) => e.path.replace(/^\/api\/v\d+/, '');

/** A logged request in the words of the shop: "Moved 3 orders to packed", "Edited a promotion". */
function describe(e: AuditLogEntry): string {
  const path = route(e).split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const changes = (e.changes ?? {}) as Record<string, unknown>;
  const n = e.targets.length;
  const count = (one: string) => (n > 1 ? `${n} ${one}s` : `an ${one}`.replace(/^an ([^aeiou])/, 'a $1'));
  if (path.endsWith('/orders/bulk-transition'))
    return `Moved ${n > 1 ? `${n} orders` : 'an order'}${typeof changes.to === 'string' ? ` to ${changes.to.replaceAll('_', ' ')}` : ''}`;
  if (/\/orders\/[^/]+\/refund$/.test(path)) return 'Refunded an order';
  if (path.endsWith('/promotions/simulate')) return 'Priced a cart in the simulator';
  if (/\/users\/[^/]+\/role$/.test(path))
    return `Changed a role${typeof changes.role === 'string' ? ` to ${changes.role.replaceAll('_', ' ')}` : ''}`;
  if (/\/dead-letters\/.+\/retry$/.test(path)) return 'Retried dead-lettered work';
  if (path.includes('/dead-letters/')) return 'Discarded dead-lettered work';
  if (path.endsWith('/imports')) return 'Uploaded a product CSV';
  const noun: Record<string, string> = {
    promotions: 'promotion',
    products: 'product',
    flags: 'feature flag',
    experiments: 'experiment',
    orders: 'order',
    users: 'user',
    reviews: 'review',
  };
  const resource = [...parts].reverse().find(p => noun[p]);
  if (!resource) return `${e.method} ${path}`;
  const verb =
    { POST: 'Created', PUT: 'Edited', PATCH: 'Edited', DELETE: resource === 'promotions' ? 'Archived' : 'Deleted' }[e.method] ?? e.method;
  return `${verb} ${count(noun[resource])}`;
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [applied, setApplied] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (filter: string, before?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (filter) params.set('target', filter);
      if (before) params.set('before', before);
      const page = await api<AuditLogPage>(`/admin/audit-log?${params}`);
      setEntries(prev => (before && prev ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
      setError('');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied);
  }, [applied, load]);

  const filterTo = (id: string) => {
    setTarget(id);
    setEntries(null);
    setApplied(id);
  };

  const refused = entries?.filter(e => e.status >= 400).length ?? 0;
  const latest = entries?.[0];
  const finding = !entries
    ? null
    : !latest
      ? applied
        ? `Nothing has been recorded against ${short(applied)}.`
        : 'No back-office changes have been recorded yet.'
      : `Latest: ${describe(latest).replace(/^\w/, c => c.toLowerCase())} by ${latest.actor.email}, ${fmtAge(latest.at)} ago. ${
          refused
            ? `${plural(refused, 'change')} of the last ${entries.length} refused.`
            : `All of the last ${plural(entries.length, 'change')} went through.`
        }`;

  return (
    <div data-testid="admin-audit-page">
      <PageHeader
        title="Audit log"
        finding={finding}
        actions={
          <form
            className="flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              setEntries(null);
              setApplied(target.trim());
            }}
          >
            <div className="relative">
              <Input
                data-testid="audit-target-filter"
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder="Order, product or user id"
                className="h-9 w-64 pr-8"
                aria-label="Filter by target id"
              />
              {applied && (
                <button
                  type="button"
                  aria-label="Clear the filter"
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => filterTo('')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-9">
              Filter
            </Button>
          </form>
        }
      />

      <section className="mt-6 border border-border bg-card">
        {applied && (
          <p className="border-b border-border px-5 py-3 text-[13px] text-muted-foreground">
            Showing changes to <span className="font-medium text-foreground">{applied}</span>
          </p>
        )}
        {error && !entries ? (
          <div className="px-5 py-4">
            <BlockError what="the audit log" onRetry={() => load(applied)} />
          </div>
        ) : entries === null ? (
          <LoadingRows rows={6} className="px-5" />
        ) : entries.length === 0 ? (
          <div className="p-5">
            <Empty>
              {applied ? 'No change has touched this id.' : 'No audited actions yet. Every back-office change will appear here.'}
            </Empty>
          </div>
        ) : (
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead className="hidden w-40 pl-5 sm:table-cell">When</TableHead>
                <TableHead className="hidden md:table-cell">Who</TableHead>
                <TableHead className="pl-5 sm:pl-3">What</TableHead>
                <TableHead className="hidden xl:table-cell">Permission</TableHead>
                <TableHead className="hidden lg:table-cell">Targets</TableHead>
                <TableHead className="pr-5 text-right">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(e => {
                const open = expanded === e.id;
                return (
                  <TableRow
                    key={e.id}
                    data-testid={`audit-row-${e.id}`}
                    className={cn('align-top', e.changes && 'cursor-pointer hover:bg-foreground/[0.02]')}
                    onClick={() => e.changes && setExpanded(open ? null : e.id)}
                  >
                    <TableCell className="hidden whitespace-nowrap pl-5 text-muted-foreground sm:table-cell">{fmtWhen(e.at)}</TableCell>
                    <TableCell className="hidden max-w-[220px] md:table-cell">
                      <span className="flex items-center gap-2.5">
                        <Initial name={e.actor.email} className="h-7 w-7 text-xs" />
                        <span className="min-w-0">
                          <span className="block truncate">{e.actor.email}</span>
                          <span className="block text-xs text-muted-foreground">{ROLE_LABELS[e.actor.role]}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-md pl-5 sm:pl-3">
                      <p className="flex items-start gap-1.5">
                        <span className="min-w-0">{describe(e)}</span>
                        {e.changes && (
                          <ChevronDown
                            className={cn('mt-0.5 h-4 w-4 flex-none text-muted-foreground', open && 'rotate-180')}
                            aria-label={open ? 'Hide the changes' : 'Show the changes'}
                          />
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        <span className="block md:hidden">
                          {e.actor.email}
                          <span className="sm:hidden"> · {fmtWhen(e.at)}</span>
                        </span>
                        {e.method} {route(e)}
                        {!open && e.changes ? ` · changed ${Object.keys(e.changes).join(', ')}` : ''}
                      </p>
                      {open && e.changes && (
                        <pre className="mt-2 max-h-56 overflow-auto bg-secondary p-3 font-mono text-xs leading-relaxed">
                          {JSON.stringify(e.changes, null, 2)}
                        </pre>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground xl:table-cell">
                      {e.permissions.join(', ') || '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="flex flex-col items-start gap-0.5 text-[13px]">
                        {e.targets.slice(0, 3).map(id => (
                          <button
                            key={id}
                            title={`Show every change to ${id}`}
                            className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                            onClick={ev => {
                              ev.stopPropagation();
                              filterTo(id);
                            }}
                          >
                            {short(id)}
                          </button>
                        ))}
                        {e.targets.length > 3 && <span className="text-muted-foreground">+{e.targets.length - 3} more</span>}
                        {e.targets.length === 0 && <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap pr-5 text-right">
                      {e.status >= 400 ? (
                        <Pill tone="negative">Refused {e.status}</Pill>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">Done {e.status}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {cursor && entries && (
          <div className="flex justify-center border-t border-border px-5 py-3">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => load(applied, cursor)} data-testid="audit-load-more">
              {loading ? 'Loading…' : 'Load older changes'}
            </Button>
          </div>
        )}
      </section>
      {error && entries && <BlockError what="older changes" onRetry={() => cursor && load(applied, cursor)} className="mt-2" />}
    </div>
  );
}
