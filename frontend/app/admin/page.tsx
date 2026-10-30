'use client';

/*
 * Overview.
 * Data: all-time stats (revenue, paid orders, AOV, customers, orders awaiting fulfilment), revenue per
 * day (30 days, paise), the funnel (carts → placed → paid → delivered), top products by revenue, sizes
 * under 5 in stock, and the paid orders waiting to be packed. Opened by every staff role, a glance a few
 * times a day, mostly at a desk. Jobs from here: pack the paid orders (most frequent), restock a size.
 *
 * Question: are orders coming in, and are they going out?
 * Finding: how many paid orders wait to be packed and for how long, and how many sizes are sold out.
 * Face: the deep-brass data hue on the revenue columns (the main data element), everything else ink.
 * Signature: the packing rail, the paid orders still to pack with photographs of what goes in each box.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RevenueBars, fillDays, type DayRevenue } from '@/components/admin/charts';
import {
  BlockError,
  Empty,
  fmtAge,
  fmtCount,
  fmtRupees,
  KpiStrip,
  LiveDot,
  LoadingBar,
  LoadingRows,
  PageHeader,
  Panel,
  Pill,
  plural,
  Thumb,
} from '@/components/admin/ledger';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { api, fmtINR } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { Order } from '@storefront/contracts';

interface Stats {
  revenue: number;
  paidOrders: number;
  avgOrderValue: number;
  totalOrders: number;
  customers: number;
  pendingOrders: number;
}

interface FunnelStage {
  stage: string;
  count: number;
}

interface TopProduct {
  _id: string;
  title: string;
  image?: string;
  units: number;
  revenue: number;
}

interface LowStockRow {
  _id: string;
  title: string;
  image?: string;
  size: string;
  stock: number;
}

const DAYS = 30;

/** The funnel's stages in words that keep them apart from the KPI strip's figures. */
const STAGE_LABEL: Record<string, string> = {
  'Active carts': 'Carts started',
  'Orders placed': 'Orders placed',
  'Orders paid': 'Ever paid, incl. later refunds',
  Delivered: 'Delivered',
};

/** A dashboard block's rows, with its own loading and error state so one failure never blanks the screen. */
function useAdminList<T>(path: string, enabled = true) {
  return useQuery({ queryKey: [...queryKeys.adminStats, path], queryFn: () => api<T[]>(path), enabled });
}

export default function AdminOverview() {
  const { user } = useAuth();
  const can = (p: string) => !!user && typeof user === 'object' && (user.permissions as string[]).includes(p);
  const canOrders = can('orders:read');

  const statsQuery = useQuery({ queryKey: queryKeys.adminStats, queryFn: () => api<Stats>('/admin/stats') });
  const stats = statsQuery.data ?? null;
  const revenue = useAdminList<DayRevenue>(`/admin/revenue-by-day?days=${DAYS}`);
  const funnel = useAdminList<FunnelStage>('/admin/funnel');
  const top = useAdminList<TopProduct>('/admin/top-products');
  const lowStock = useAdminList<LowStockRow>('/admin/low-stock');
  const packParams = { page: '1', status: 'paid' };
  const packQuery = useQuery({
    queryKey: queryKeys.adminOrders(packParams),
    queryFn: () => api<{ orders: Order[]; total: number }>(`/admin/orders?${new URLSearchParams(packParams)}`),
    enabled: canOrders,
  });

  const live = useLiveEvents(['admin-orders'], () => {
    void statsQuery.refetch();
    void revenue.refetch();
    if (canOrders) void packQuery.refetch();
  });

  const days = revenue.data ? fillDays(revenue.data, DAYS) : null;
  const monthRevenue = days?.reduce((s, d) => s + d.revenue, 0) ?? 0;
  const monthOrders = days?.reduce((s, d) => s + d.orders, 0) ?? 0;
  const best = days?.reduce<DayRevenue | null>((b, d) => (d.revenue > (b?.revenue ?? 0) ? d : b), null);

  const toPack = packQuery.data?.total ?? 0;
  const waiting = [...(packQuery.data?.orders ?? [])].sort(
    (a, b) => new Date(a.paidAt ?? a.createdAt).getTime() - new Date(b.paidAt ?? b.createdAt).getTime(),
  );
  const oldest = waiting[0];
  const soldOut = lowStock.data?.filter(r => r.stock === 0).length ?? 0;

  const finding = (() => {
    const parts: string[] = [];
    if (canOrders && packQuery.data) {
      parts.push(
        toPack === 0
          ? 'Nothing is waiting to be packed'
          : `${plural(toPack, 'paid order')} waiting to be packed${oldest ? `, the oldest for ${fmtAge(oldest.paidAt ?? oldest.createdAt)}` : ''}`,
      );
    }
    if (lowStock.data) parts.push(soldOut ? `${plural(soldOut, 'size')} sold out` : 'no size is sold out');
    if (!parts.length) return null;
    const line = parts.join('; ');
    return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
  })();

  const kpis = [
    { label: 'Revenue, all time', value: stats ? fmtRupees(stats.revenue) : '', sub: 'after refunds', testId: 'kpi-revenue' },
    {
      // Orders still counted in revenue: refunded and refund-requested orders are excluded, so this is
      // smaller than the funnel's "ever paid" stage, and each is labelled so they can't read as one fact.
      label: 'Paid, not refunded',
      value: stats ? fmtCount(stats.paidOrders) : '',
      sub: stats ? `of ${fmtCount(stats.totalOrders)} placed` : '',
      testId: 'kpi-paid-orders',
    },
    { label: 'Average order', value: stats ? fmtRupees(stats.avgOrderValue) : '', testId: 'kpi-aov' },
    { label: 'Customers', value: stats ? fmtCount(stats.customers) : '', sub: 'with an account', testId: 'kpi-customers' },
  ];

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <PageHeader
        title="Overview"
        finding={finding ?? <LoadingBar className="mt-1 h-4 w-80" />}
        actions={
          <>
            <LiveDot live={live} />
            {canOrders && can('orders:manage') && toPack > 0 && (
              <Button asChild size="sm">
                <Link href="/admin/orders?status=paid">Pack {plural(toPack, 'order')}</Link>
              </Button>
            )}
          </>
        }
      />

      <div className={cn('grid gap-4', canOrders && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className="min-w-0 space-y-4">
          {statsQuery.isError ? (
            <Panel>
              <BlockError what="the shop's totals" onRetry={() => void statsQuery.refetch()} />
            </Panel>
          ) : (
            <KpiStrip items={kpis} loading={!stats} />
          )}

          <Panel data-testid="revenue-chart" title="Revenue per day" meta={`Last ${DAYS} days`} bodyClassName="pt-1">
            {revenue.isError ? (
              <BlockError what="revenue" onRetry={() => void revenue.refetch()} />
            ) : !days ? (
              <>
                <LoadingBar className="h-8 w-44" />
                <LoadingBar className="mt-2 h-3.5 w-64" />
                <LoadingBar className="mt-4 h-[200px] w-full" />
              </>
            ) : (
              <>
                <p className="text-[30px] font-bold leading-none tracking-[-0.02em]">{fmtRupees(monthRevenue)}</p>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  {plural(monthOrders, 'paid order')} in these {DAYS} days
                  {best && best.revenue > 0 && (
                    <>
                      {' '}
                      · best day {new Date(`${best.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })},{' '}
                      {fmtRupees(best.revenue)}
                    </>
                  )}
                </p>
                <div className="mt-4">
                  <RevenueBars data={days} height={200} />
                </div>
              </>
            )}
          </Panel>
        </div>

        {canOrders && (
          <Panel
            title="Waiting to be packed"
            meta={packQuery.data ? <span>{fmtCount(toPack)}</span> : null}
            className="flex flex-col"
            bodyClassName="flex flex-1 flex-col pt-1"
            data-testid="pack-queue"
          >
            {packQuery.isError ? (
              <BlockError what="the orders to pack" onRetry={() => void packQuery.refetch()} />
            ) : !packQuery.data ? (
              <LoadingRows rows={6} />
            ) : waiting.length === 0 ? (
              <Empty>Every paid order has been packed.</Empty>
            ) : (
              <ul className="divide-y divide-border/70">
                {waiting.slice(0, 6).map(o => {
                  const pieces = o.items.reduce((s, i) => s + i.qty, 0);
                  return (
                    <li key={o._id} className="flex items-center gap-3 py-2.5">
                      <span className="flex w-[50px] flex-none gap-0.5" aria-hidden>
                        {o.items.slice(0, 2).map((it, i) => (
                          <Thumb key={`${it.productId}-${i}`} src={it.image} className="h-8 w-6" />
                        ))}
                      </span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-sm font-medium">{o.orderNumber}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {o.address?.name ?? 'No name'} · {plural(pieces, 'piece')}
                        </p>
                      </div>
                      <div className="flex-none text-right leading-tight">
                        <p className="text-sm font-semibold tabular-nums">{fmtINR(o.total)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{fmtAge(o.paidAt ?? o.createdAt)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {packQuery.data && toPack > 0 && (
              <Link
                href="/admin/orders?status=paid"
                className="mt-auto flex h-9 items-center justify-center bg-secondary text-[13px] font-medium transition-transform duration-150 ease-out hover:bg-accent active:scale-[0.97]"
              >
                View all {plural(toPack, 'order')} to pack
              </Link>
            )}
          </Panel>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Best sellers" meta="by revenue, all time" data-testid="top-products-widget">
          {top.isError ? (
            <BlockError what="best sellers" onRetry={() => void top.refetch()} />
          ) : !top.data ? (
            <LoadingRows rows={5} />
          ) : top.data.length === 0 ? (
            <Empty>No paid orders yet, so nothing has sold.</Empty>
          ) : (
            <ol className="space-y-3">
              {top.data.slice(0, 5).map((p, i) => {
                const share = p.revenue / Math.max(1, top.data[0].revenue);
                return (
                  <li key={p._id} className="flex items-center gap-3">
                    <span className="w-4 flex-none text-right text-xs text-muted-foreground">{i + 1}</span>
                    <Thumb src={p.image} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-sm font-medium">{p.title}</p>
                        <p className="flex-none text-sm font-semibold tabular-nums">{fmtRupees(p.revenue)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{plural(p.units, 'unit')}</p>
                      <span className="mt-1 block h-0.5 bg-border">
                        <span
                          className={cn('block h-full', i === 0 ? 'bg-foreground' : 'bg-foreground/30')}
                          style={{ width: `${share * 100}%` }}
                        />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel title="From cart to doorstep" meta="all time" data-testid="funnel-widget">
          {funnel.isError ? (
            <BlockError what="the funnel" onRetry={() => void funnel.refetch()} />
          ) : !funnel.data ? (
            <LoadingRows rows={4} />
          ) : (
            <ol className="space-y-3.5">
              <li className="-mb-1 flex justify-end text-xs text-muted-foreground" aria-hidden>
                % of the stage above
              </li>
              {funnel.data.map((f, i) => {
                const first = funnel.data[0]?.count || 0;
                const prev = i > 0 ? funnel.data[i - 1].count : null;
                const last = i === funnel.data.length - 1;
                return (
                  <li key={f.stage}>
                    <div className="flex items-baseline gap-3 text-sm">
                      <span className="flex-1">{STAGE_LABEL[f.stage] ?? f.stage}</span>
                      <span className="font-medium tabular-nums">{fmtCount(f.count)}</span>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                        {prev === null ? '' : prev > 0 ? `${Math.round((f.count / prev) * 100)}%` : '—'}
                      </span>
                    </div>
                    <span className="mt-1.5 block h-1.5 bg-secondary">
                      {f.count > 0 && (
                        <span
                          className={cn('block h-full', last ? 'bg-foreground' : 'bg-foreground/35')}
                          style={{ width: `${first ? (f.count / first) * 100 : 0}%` }}
                        />
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel
          title="Running out"
          meta={lowStock.data ? `${plural(lowStock.data.length, 'size')} under 5` : null}
          action={
            can('catalog:write') ? (
              <Link href="/admin/products" className="font-medium text-foreground underline-offset-4 hover:underline">
                Products
              </Link>
            ) : null
          }
          data-testid="low-stock-widget"
        >
          {lowStock.isError ? (
            <BlockError what="stock levels" onRetry={() => void lowStock.refetch()} />
          ) : !lowStock.data ? (
            <LoadingRows rows={5} />
          ) : lowStock.data.length === 0 ? (
            <Empty>Every size has 5 or more in stock.</Empty>
          ) : (
            <ul className="divide-y divide-border/70">
              {lowStock.data.slice(0, 5).map((r, i) => (
                <li key={`${r._id}-${r.size}-${i}`} className="flex items-center gap-3 py-2 first:pt-0">
                  <Thumb src={r.image} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Size {r.size}</p>
                  </div>
                  {r.stock === 0 ? <Pill tone="negative">Sold out</Pill> : <Pill tone="warning">{r.stock} left</Pill>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
