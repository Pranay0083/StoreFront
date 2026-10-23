'use client';

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefundDialog } from '@/components/refund-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage, fmtDateTime, fmtINR } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { queryKeys } from '@/lib/query';
import { ADMIN_ORDER_ACTIONS, ORDER_STATUSES, type Order, type OrderStatus } from '@storefront/contracts';
import { cn } from '@/lib/utils';

const STATUSES: (OrderStatus | 'all')[] = ['all', ...ORDER_STATUSES];
const BULK_TARGETS = [...new Set(Object.values(ADMIN_ORDER_ACTIONS).flat())];
const label = (s: string) => s.replaceAll('_', ' ');

interface AdminOrdersResponse {
  orders: Order[];
  total: number;
  pages: number;
  transitions: Record<string, string[]>;
}

export default function AdminOrdersPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>('');
  const [refunding, setRefunding] = useState<Order | null>(null);

  const params = { page: String(page), ...(status !== 'all' && { status }) };
  const { data } = useQuery({
    queryKey: queryKeys.adminOrders(params),
    queryFn: () => api<AdminOrdersResponse>(`/admin/orders?${new URLSearchParams(params)}`),
    placeholderData: keepPreviousData,
  });
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.adminOrdersAll });

  const live = useLiveEvents(['admin-orders'], e => {
    const { orderNumber } = e.data as { orderNumber?: string };
    if (e.event === 'order.placed') toast(`New order ${orderNumber ?? ''}`.trim());
    if (e.event === 'order.paid') toast.success(`Payment received for ${orderNumber ?? 'an order'}`);
    load();
  });
  useEffect(() => {
    setSelected(new Set());
    setPage(1);
  }, [status]);

  const toggleAll = () => {
    if (!data) return;
    setSelected(prev => (prev.size === data.orders.length ? new Set() : new Set(data.orders.map(o => o._id))));
  };

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = useMutation({
    mutationFn: ({ ids, to }: { ids: string[]; to: string }) =>
      api<{ updated: number; rejected: { id: string; reason: string }[] }>('/admin/orders/bulk-transition', {
        method: 'POST',
        body: JSON.stringify({ ids, to }),
      }),
    onSuccess: (result, { to }) => {
      if (result.updated) toast.success(`${result.updated} order${result.updated > 1 ? 's' : ''} → ${to}`);
      for (const r of result.rejected) toast.error(`${r.id}: ${r.reason}`);
      setSelected(new Set());
    },
    onError: e => toast.error(errorMessage(e)),
    onSettled: () => load(),
  });
  const busy = bulk.isPending;
  const transition = (ids: string[], to: string) => bulk.mutate({ ids, to });

  return (
    <div data-testid="admin-orders-page">
      <h1 className="flex items-center gap-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        Order queue
        <span
          data-testid="admin-orders-live"
          title={live ? 'Receiving live updates' : 'Live updates paused; reconnecting'}
          className={cn('h-2 w-2 rounded-full', live ? 'bg-emerald-600' : 'bg-black/20')}
        />
      </h1>
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
              status === s ? 'border-black bg-black text-white' : 'border-black/15 hover:border-black',
            )}
          >
            {label(s)}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div
          data-testid="bulk-action-bar"
          className="mt-5 flex flex-wrap items-center gap-4 border border-black bg-black px-5 py-3 text-white"
        >
          <p className="text-sm">{selected.size} selected</p>
          <div className="flex items-center gap-3">
            <Select value={bulkTo} onValueChange={setBulkTo}>
              <SelectTrigger data-testid="bulk-status-select" className="h-9 w-40 border-white/30 bg-transparent text-white">
                <SelectValue placeholder="Move to…" />
              </SelectTrigger>
              <SelectContent>
                {BULK_TARGETS.map(s => (
                  <SelectItem key={s} value={s}>
                    {label(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              data-testid="bulk-apply-button"
              variant="secondary"
              size="sm"
              disabled={!bulkTo || busy}
              onClick={() => transition(Array.from(selected), bulkTo)}
            >
              {busy ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 border border-black/10 bg-white">
        {!data ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
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
                    <TableCell>
                      <StatusBadge status={order.status} testId={`admin-order-status-${order.orderNumber}`} />
                    </TableCell>
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
                              {label(order.status)} → {label(t)}
                            </DropdownMenuItem>
                          ))}
                          {allowed.includes('refund_requested') && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem data-testid={`order-refund-items-${order.orderNumber}`} onClick={() => setRefunding(order)}>
                                Refund items…
                              </DropdownMenuItem>
                            </>
                          )}
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

      {refunding && (
        <RefundDialog
          order={refunding}
          open
          onOpenChange={o => !o && setRefunding(null)}
          endpoint={`/admin/orders/${refunding._id}/refund`}
          onRefunded={() => load()}
          title={`Refund ${refunding.orderNumber}`}
        />
      )}

      {data && data.pages > 1 && (
        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {data.total} orders · page {page} of {data.pages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" data-testid="orders-prev-page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="orders-next-page"
              disabled={page >= data.pages}
              onClick={() => setPage(p => p + 1)}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
