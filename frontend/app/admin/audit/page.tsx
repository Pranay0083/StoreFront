'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDateTime } from '@/lib/api';
import { ROLE_LABELS, type AuditLogEntry, type AuditLogPage } from '@storefront/contracts';

const statusVariant = (status: number) => (status >= 400 ? ('destructive' as const) : ('success' as const));

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
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied);
  }, [applied, load]);

  return (
    <div data-testid="admin-audit-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every back-office change: who made it, with which permission, and what changed.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            setEntries(null);
            setApplied(target.trim());
          }}
        >
          <Input
            data-testid="audit-target-filter"
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="Filter by target id"
            className="w-64"
          />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
      </div>

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

      <div className="mt-6 border border-black/10 bg-white">
        {entries === null ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No audited actions yet.</p>
        ) : (
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(e => (
                <TableRow
                  key={e.id}
                  data-testid={`audit-row-${e.id}`}
                  className="cursor-pointer align-top"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                >
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(e.at)}</TableCell>
                  <TableCell className="text-sm">
                    <p className="font-medium">{e.actor.email}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABELS[e.actor.role]}</p>
                  </TableCell>
                  <TableCell className="max-w-md text-sm">
                    <p className="font-mono text-xs">
                      {e.method} {e.path}
                    </p>
                    {expanded === e.id && e.changes && (
                      <pre className="mt-2 max-h-48 overflow-auto border border-black/10 bg-secondary/50 p-2 text-[11px] leading-relaxed">
                        {JSON.stringify(e.changes, null, 2)}
                      </pre>
                    )}
                    {expanded !== e.id && e.changes && (
                      <p className="mt-1 text-xs text-muted-foreground">Changed: {Object.keys(e.changes).join(', ')}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{e.permissions.join(', ')}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {e.targets.slice(0, 3).map(id => (
                      <button
                        key={id}
                        className="block hover:text-foreground hover:underline"
                        onClick={ev => {
                          ev.stopPropagation();
                          setTarget(id);
                          setEntries(null);
                          setApplied(id);
                        }}
                      >
                        {id}
                      </button>
                    ))}
                    {e.targets.length > 3 && <span>+{e.targets.length - 3} more</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(e.status)}>{e.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => load(applied, cursor)} data-testid="audit-load-more">
            {loading ? 'Loading…' : 'Load older entries'}
          </Button>
        </div>
      )}
    </div>
  );
}
