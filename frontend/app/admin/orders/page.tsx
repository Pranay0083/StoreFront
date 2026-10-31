'use client';

/*
 * Orders.
 * Data: orders 20 to a page (number, customer, pieces, total in paise, status, placed/paid times), the
 * transitions each status allows by hand, live order.placed / order.paid events over SSE. Opened by
 * fulfilment and support many times a day, in long sessions at a desk; tens to hundreds of orders.
 * Jobs: pack the paid orders (most frequent), ship the packed ones, start a refund.
 *
 * Question: which paid orders still need packing?
 * Finding: how many orders wait to be packed and how many to be shipped.
 * Face: status pills in words of the trade ("To pack", "To ship"), the next step as a visible action on
 * every row that has one, and "Pack all" one click from the title.
 */

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BlockError,
  Empty,
  fmtCount,
  fmtMoney,
  fmtWhen,
  LiveDot,
  LoadingRows,
  OrderStatusPill,
  ORDER_STATUS_LABEL,
  PageHeader,
  plural,
  Tabs,
} from '@/components/admin/ledger';
import { useAuth } from '@/components/providers';
import { RefundDialog } from '@/components/refund-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { ADMIN_ORDER_ACTIONS, ORDER_STATUSES, type Order, type OrderStatus } from '@storefront/contracts';

const BULK_TARGETS = [...new Set(Object.values(ADMIN_ORDER_ACTIONS).flat())];

const QUEUE_LABEL: Record<OrderStatus | 'all', string> = { all: 'All', ...ORDER_STATUS_LABEL };

/** What moving an order to each status means, as an action. */
const MOVE_LABEL: Partial<Record<OrderStatus, string>> = {
  packed: 'Mark packed',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
  cancelled: 'Cancel',
  refund_requested: 'Request a refund',
};

/** The one forward step a row may show as its visible action. */
const NEXT_STEP: Partial<Record<OrderStatus, OrderStatus>> = { paid: 'packed', packed: 'shipped', shipped: 'delivered' };

const EMPTY: Record<OrderStatus | 'all', string> = {
  all: 'No orders yet. They appear here the moment a customer checks out.',
  created: 'No order is waiting for payment.',
  paid: 'Every paid order has been packed.',
  packed: 'Nothing is packed and waiting to ship.',
  shipped: 'Nothing is on its way right now.',
  delivered: 'No order has been delivered yet.',
  cancelled: 'No order has been cancelled.',
  refund_requested: 'No refund is waiting on the payment gateway.',
  partially_refunded: 'No order has been partly refunded.',
  refunded: 'No order has been refunded.',
};

const TABS: (OrderStatus | 'all')[] = [
  'all',
  'paid',
  'packed',
  'shipped',
  'refund_requested',
  'created',
  'delivered',
  'partially_refunded',
  'refunded',
  'cancelled',
];

interface AdminOrdersResponse {
  orders: Order[];
  total: number;
  page: number;
  pages: number;
  transitions: Record<string, string[]>;
}

const fetchPage = (params: Record<string, string>) => api<AdminOrdersResponse>(`/admin/orders?${new URLSearchParams(params)}`);

/** The size of one queue, from the first page of that status (shared with the nav's count). */
function useQueueTotal(status: OrderStatus) {
  const params = { page: '1', status };
  return useQuery({ queryKey: queryKeys.adminOrders(params), queryFn: () => fetchPage(params) }).data?.total ?? null;
}

function AdminOrdersScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canManage = !!user && typeof user === 'object' && user.permissions.includes('orders:manage');

  const fromUrl = searchParams.get('status');
  const [status, setStatusState] = useState<string>(fromUrl && (ORDER_STATUSES as readonly string[]).includes(fromUrl) ? fromUrl : 'all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>('');
  const [refunding, setRefunding] = useState<Order | null>(null);
  const [confirmPack, setConfirmPack] = useState(false);

  const setStatus = (s: string) => {
    setStatusState(s);
    router.replace(s === 'all' ? pathname : `${pathname}?status=${s}`, { scroll: false });
  };

  const params = { page: String(page), ...(status !== 'all' && { status }) };
  const query = useQuery({
    queryKey: queryKeys.adminOrders(params),
    queryFn: () => fetchPage(params),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const load = () => queryClient.invalidateQueries({ queryKey: queryKeys.adminOrdersAll });

  const toPack = useQueueTotal('paid');
  const toShip = useQueueTotal('packed');
  const refunds = useQueueTotal('refund_requested');

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
      if (result.updated) toast.success(`${plural(result.updated, 'order')} moved to ${QUEUE_LABEL[to as OrderStatus].toLowerCase()}`);
      for (const r of result.rejected) toast.error(`${r.id}: ${r.reason}`);
      setSelected(new Set());
    },
    onError: e => toast.error(errorMessage(e)),
    onSettled: () => load(),
  });
  const busy = bulk.isPending;
  const transition = (ids: string[], to: string) => bulk.mutate({ ids, to });

  /** The screen's main job: every paid order, across every page, to packed. */
  const packAll = useMutation({
    mutationFn: async () => {
      const first = await fetchPage({ page: '1', status: 'paid' });
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, first.pages - 1) }, (_, i) => fetchPage({ page: String(i + 2), status: 'paid' })),
      );
      return [first, ...rest].flatMap(p => p.orders.map(o => o._id));
    },
    onSuccess: ids => {
      setConfirmPack(false);
      if (ids.length) transition(ids, 'packed');
    },
    onError: e => toast.error(errorMessage(e)),
  });

  const finding =
    toPack === null || toShip === null
      ? null
      : toPack === 0 && toShip === 0
        ? 'Nothing is waiting to be packed or shipped.'
        : `${plural(toPack, 'paid order')} waiting to be packed, ${fmtCount(toShip)} packed and waiting to ship${
            refunds ? `; ${plural(refunds, 'refund')} with the payment gateway` : ''
          }.`;

  const counts: Partial<Record<string, number | null>> = { paid: toPack, packed: toShip, refund_requested: refunds };
  const first = data ? (data.page - 1) * 20 + 1 : 0;
  const last = data ? first + data.orders.length - 1 : 0;

  return (
    <div data-testid="admin-orders-page">
      <PageHeader
        title="Orders"
        finding={finding}
        actions={
          <>
            <LiveDot live={live} testId="admin-orders-live" />
            {canManage && !!toPack && (
              <Button size="sm" data-testid="orders-pack-all" onClick={() => setConfirmPack(true)} disabled={busy || packAll.isPending}>
                Pack all {fmtCount(toPack)}
              </Button>
            )}
          </>
        }
      />

      <Tabs
        className="mt-6"
        ariaLabel="Order status"
        testIdPrefix="orders-filter-"
        value={status}
        onChange={setStatus}
        options={TABS.map(s => ({ value: s, label: QUEUE_LABEL[s], count: counts[s] ?? null }))}
      />

      <section className="mt-4 border border-border bg-card">
        <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 px-4 py-2">
          {selected.size > 0 && canManage ? (
            <div data-testid="bulk-action-bar" className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium">{fmtCount(selected.size)} selected</p>
              <Select value={bulkTo} onValueChange={setBulkTo}>
                <SelectTrigger data-testid="bulk-status-select" className="h-9 w-44">
                  <SelectValue placeholder="Move to…" />
                </SelectTrigger>
                <SelectContent>
                  {BULK_TARGETS.map(s => (
                    <SelectItem key={s} value={s}>
                      {MOVE_LABEL[s] ?? QUEUE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                data-testid="bulk-apply-button"
                size="sm"
                disabled={!bulkTo || busy}
                onClick={() => transition(Array.from(selected), bulkTo)}
              >
                {busy ? 'Applying…' : 'Apply'}
              </Button>
              <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {data
                ? data.total === 0
                  ? 'No orders'
                  : `${fmtCount(first)}–${fmtCount(last)} of ${plural(data.total, 'order')}`
                : 'Loading orders…'}
            </p>
          )}
          {query.isFetching && data && <span className="text-xs text-muted-foreground">Updating…</span>}
        </div>

        {query.isError && !data ? (
          <div className="px-4 pb-4">
            <BlockError what="orders" onRetry={() => void query.refetch()} />
          </div>
        ) : !data ? (
          <LoadingRows rows={8} className="px-4" />
        ) : data.orders.length === 0 ? (
          <div className="px-4 pb-4">
            <Empty data-testid="orders-empty">{EMPTY[status as OrderStatus | 'all']}</Empty>
          </div>
        ) : (
          <Table data-testid="orders-table">
            <TableHeader className="bg-card">
              <TableRow>
                {canManage && (
                  <TableHead className="hidden w-10 pl-4 sm:table-cell">
                    <Checkbox
                      data-testid="orders-select-all"
                      aria-label="Select every order on this page"
                      checked={data.orders.length > 0 && selected.size === data.orders.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                )}
                <TableHead className={cn('pl-4', canManage && 'sm:pl-3')}>Order</TableHead>
                <TableHead className="hidden md:table-cell">Customer</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Pieces</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                {canManage && <TableHead className="hidden lg:table-cell">Next step</TableHead>}
                <TableHead className="w-12 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.orders.map(order => {
                const allowed = data.transitions[order.status] || [];
                const pieces = order.items.reduce((s, i) => s + i.qty, 0);
                const next = NEXT_STEP[order.status];
                return (
                  <TableRow
                    key={order._id}
                    data-testid={`admin-order-row-${order.orderNumber}`}
                    data-state={selected.has(order._id) ? 'selected' : undefined}
                  >
                    {canManage && (
                      <TableCell className="hidden pl-4 sm:table-cell">
                        <Checkbox
                          data-testid={`order-select-${order.orderNumber}`}
                          aria-label={`Select ${order.orderNumber}`}
                          checked={selected.has(order._id)}
                          onCheckedChange={() => toggle(order._id)}
                        />
                      </TableCell>
                    )}
                    <TableCell className={cn('w-full max-w-0 pl-4 sm:max-w-none', canManage && 'sm:pl-3')}>
                      <p className="truncate font-medium">{order.orderNumber}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <span className="md:hidden">{order.address?.name ?? 'No name'} · </span>
                        <span className="sm:hidden">{plural(pieces, 'piece')} · </span>
                        {fmtWhen(order.createdAt)}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-[220px] truncate md:table-cell">
                      {order.address?.name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{fmtCount(pieces)}</TableCell>
                    <TableCell className="text-right">
                      <p className="font-semibold tabular-nums">{fmtMoney(order.total)}</p>
                      <div className="mt-1 flex justify-end sm:hidden">
                        <OrderStatusPill status={order.status} testId={`admin-order-status-m-${order.orderNumber}`} />
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <OrderStatusPill status={order.status} testId={`admin-order-status-${order.orderNumber}`} />
                    </TableCell>
                    {canManage && (
                      <TableCell className="hidden w-36 lg:table-cell">
                        {next && allowed.includes(next) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            data-testid={`order-next-${order.orderNumber}`}
                            disabled={busy}
                            onClick={() => transition([order._id], next)}
                          >
                            {MOVE_LABEL[next]}
                          </Button>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            data-testid={`order-actions-${order.orderNumber}`}
                            aria-label={`Actions for ${order.orderNumber}`}
                            className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                            disabled={allowed.length === 0 || !canManage}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Move {order.orderNumber}</DropdownMenuLabel>
                          {allowed.length === 0 && <DropdownMenuItem disabled>No manual step from here</DropdownMenuItem>}
                          {allowed.map(t => (
                            <DropdownMenuItem
                              key={t}
                              data-testid={`order-transition-${order.orderNumber}-${t}`}
                              onClick={() => transition([order._id], t)}
                            >
                              {MOVE_LABEL[t as OrderStatus] ?? QUEUE_LABEL[t as OrderStatus]}
                            </DropdownMenuItem>
                          ))}
                          {allowed.includes('refund_requested') && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem data-testid={`order-refund-items-${order.orderNumber}`} onClick={() => setRefunding(order)}>
                                Refund some items…
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

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-[13px] text-muted-foreground">
              Page {fmtCount(page)} of {fmtCount(data.pages)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" data-testid="orders-prev-page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> Newer
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="orders-next-page"
                disabled={page >= data.pages}
                onClick={() => setPage(p => p + 1)}
              >
                Older <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </section>

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

      <Dialog open={confirmPack} onOpenChange={setConfirmPack}>
        <DialogContent className="max-w-md">
          <DialogTitle className="text-xl">Mark {plural(toPack ?? 0, 'order')} packed?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Every paid order moves to “To ship”. Each move is checked by the order state machine and written to the audit log.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmPack(false)}>
              Not yet
            </Button>
            <Button size="sm" data-testid="orders-pack-all-confirm" disabled={packAll.isPending || busy} onClick={() => packAll.mutate()}>
              {packAll.isPending ? 'Packing…' : `Mark ${fmtCount(toPack ?? 0)} packed`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <AdminOrdersScreen />
    </Suspense>
  );
}
