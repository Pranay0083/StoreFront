'use client';

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDateTime, fmtINR } from '@/lib/api';
import type { Order, OrderStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUSES: (OrderStatus | 'all')[] = ['all', 'created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'];

export default function AdminOrdersPage() {
  const [data, setData] = useState<{ orders: Order[]; total: number; pages: number; transitions: Record<string, string[]> } | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page) });
    if (status !== 'all') qs.set('status', status);
    api<any>(`/admin/orders?${qs}`).then(setData).catch(() => {});
  }, [status, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setPage(1); }, [status]);

  const toggleAll = () => {
    if (!data) return;
    setSelected(prev => (prev.size === data.orders.length ? new Set() : new Set(data.orders.map(o => o._id))));
  };

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const transition = async (ids: string[], to: string) => {
    setBusy(true);
    try {
      const result = await api<{ updated: number; rejected: { id: string; reason: string }[] }>(
        '/admin/orders/bulk-transition',
        { method: 'POST', body: JSON.stringify({ ids, to }) }
      );
      if (result.updated) toast.success(`${result.updated} order${result.updated > 1 ? 's' : ''} → ${to}`);
      for (const r of result.rejected) toast.error(`${r.id}: ${r.reason}`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="admin-orders-page">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Order queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every transition is validated by the state machine and audited. Illegal moves are rejected.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUSES.map(s => (
          <button
            key={s}
            data-testid={`orders-filter-${s}`}
            onClick={() => setStatus(s)}
            className={cn(
              'border px-3.5 py-1.5 text-xs uppercase tracking-[0.12em] transition-colors',
              status === s ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black'
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div data-testid="bulk-action-bar" className="mt-5 flex flex-wrap items-center gap-4 border border-black bg-black px-5 py-3 text-white">
          <p className="text-sm">{selected.size} selected</p>
          <div className="flex items-center gap-3">
            <Select value={bulkTo} onValueChange={setBulkTo}>
              <SelectTrigger data-testid="bulk-status-select" className="h-9 w-40 border-white/30 bg-transparent text-white">
                <SelectValue placeholder="Move to…" />
              </SelectTrigger>
              <SelectContent>
                {['paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              data-testid="bulk-apply-button"
              variant="secondary" size="sm"
              disabled={!bulkTo || busy}
              onClick={() => transition(Array.from(selected), bulkTo)}
            >
              {busy ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 border border-black/10 bg-white">
        {data === null ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <Table data-testid="orders-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    data-testid="orders-select-all"
                    checked={data.orders.length > 0 && selected.size === data.orders.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.orders.map(order => {
                const allowed = data.transitions[order.status] || [];
                return (
                  <TableRow key={order._id} data-testid={`admin-order-row-${order.orderNumber}`}>
                    <TableCell>
                      <Checkbox
                        data-testid={`order-select-${order.orderNumber}`}
                        checked={selected.has(order._id)}
                        onCheckedChange={() => toggle(order._id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{order.orderNumber}</TableCell>
                    <TableCell className="text-sm">{order.address?.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(order.createdAt)}</TableCell>
                    <TableCell className="text-sm">{order.items.reduce((s, i) => s + i.qty, 0)}</TableCell>
                    <TableCell className="text-sm font-semibold">{fmtINR(order.total)}</TableCell>
                    <TableCell><StatusBadge status={order.status} testId={`admin-order-status-${order.orderNumber}`} /></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            data-testid={`order-actions-${order.orderNumber}`}
                            className="flex h-8 w-8 items-center justify-center hover:bg-black/5"
                            disabled={allowed.length === 0}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Transition to</DropdownMenuLabel>
                          {allowed.length === 0 && <DropdownMenuItem disabled>Terminal state</DropdownMenuItem>}
                          {allowed.map(t => (
                            <DropdownMenuItem
                              key={t}
                              data-testid={`order-transition-${order.orderNumber}-${t}`}
                              onClick={() => transition([order._id], t)}
                            >
                              {order.status} → {t}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{data.total} orders · page {page} of {data.pages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" data-testid="orders-prev-page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" data-testid="orders-next-page" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
