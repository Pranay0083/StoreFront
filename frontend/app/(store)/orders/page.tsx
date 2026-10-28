'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { api, fmtDate, fmtINR } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { queryKeys } from '@/lib/query';
import type { Order } from '@storefront/contracts';

const ROW =
  'grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-5 sm:grid-cols-[116px_minmax(0,1fr)_auto] sm:gap-x-6 sm:px-6';
const BAR = 'inline-block bg-foreground/[0.08] align-middle';

function Thumbs({ order }: { order: Order }) {
  const shown = order.items.slice(0, 3);
  const more = order.items.length - shown.length;
  return (
    <div className="flex">
      {shown.map((item, i) => (
        <div
          key={`${item.productId}-${item.size}`}
          className={`relative h-[60px] w-12 shrink-0 overflow-hidden bg-secondary ring-2 ring-card ${i > 0 ? '-ml-4 hidden sm:block' : ''}`}
        >
          <Image src={item.image} alt="" fill sizes="48px" className="object-cover" />
        </div>
      ))}
      {more > 0 && (
        <div className="-ml-4 hidden h-[60px] w-12 shrink-0 items-center justify-center bg-secondary text-sm font-medium ring-2 ring-card sm:flex">
          +{more}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const signedIn = Boolean(user && typeof user === 'object');
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: queryKeys.orders,
    queryFn: () => api<Order[]>('/orders'),
    enabled: signedIn,
  });

  useEffect(() => {
    if (user === false) router.replace('/login?next=/orders');
  }, [user, router]);

  useLiveEvents(['orders'], () => void refetch(), signedIn);

  const pieces = (o: Order) => o.items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14" data-testid="orders-page">
      <h1 className="text-display-md font-extrabold">Your orders</h1>
      <p className="mt-3 text-[15px] text-muted-foreground" aria-live="polite">
        {data ? (data.length === 1 ? '1 order' : `${data.length} orders`) : isError ? ' ' : 'Loading your orders…'}
      </p>

      {!data && isError ? (
        <div role="alert" className="mt-10 bg-card px-6 py-8 text-[15px]">
          <p className="font-medium">We couldn’t load your orders.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 font-medium underline underline-offset-4 disabled:opacity-50"
          >
            {isFetching ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      ) : !data ? (
        <ul className="mt-10 divide-y divide-border bg-card" aria-hidden>
          {[0, 1, 2].map(i => (
            <li key={i} className={ROW}>
              <span className="h-[60px] w-12 bg-foreground/[0.06]" />
              <span className="space-y-2">
                <span className={`${BAR} h-4 w-40`} />
                <span className={`${BAR} block h-3.5 w-56`} />
              </span>
              <span className={`${BAR} h-6 w-20`} />
            </li>
          ))}
        </ul>
      ) : data.length === 0 ? (
        <div className="mt-10 bg-card px-6 py-8">
          <p className="text-lg">You haven’t ordered anything yet. When you do, each order and its receipt will be here.</p>
          <Button asChild size="lg" className="mt-6">
            <Link href="/products">Browse the collection</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-border bg-card">
          {data.map(order => (
            <li key={order._id}>
              <Link
                href={`/orders/${order._id}`}
                data-testid={`order-row-${order.orderNumber}`}
                className={`${ROW} transition-colors duration-150 hover:bg-secondary/60 active:bg-secondary`}
              >
                <Thumbs order={order} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{order.orderNumber}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Placed {fmtDate(order.createdAt)}, {pieces(order)} {pieces(order) === 1 ? 'piece' : 'pieces'}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-10">
                  <StatusBadge status={order.status} testId={`order-status-${order.orderNumber}`} className="sm:w-40" />
                  <span className="text-lg font-bold tracking-[-0.02em] sm:w-28 sm:text-right sm:text-xl">{fmtINR(order.total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
