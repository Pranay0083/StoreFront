'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { CUSTOMER_CANCELLABLE_STATUSES, PARTIAL_REFUND_STATUSES, REFUND_WINDOW_DAYS, type Order } from '@storefront/contracts';
import { toast } from 'sonner';
import { orderBreakdown } from '@/components/checkout/order-breakdown';
import { OrderTimeline } from '@/components/order-timeline';
import { PriceBreakdown } from '@/components/price-breakdown';
import { RefundDialog } from '@/components/refund-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { ApiError, api, errorMessage, fmtDate, fmtDateTime, fmtINR } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';
import { queryKeys } from '@/lib/query';

const DAY_MS = 86_400_000;
const REFUND_LABELS: Record<Order['refunds'][number]['status'], string> = {
  requested: 'Requested',
  processing: 'Sent to the payment provider',
  pending: 'With your bank',
  processed: 'Refunded',
  failed: 'Failed',
};

const H2 = 'text-xl font-bold tracking-[-0.02em]';
const BAR = 'block bg-foreground/[0.08]';

/** The order page's frame with grey bars where the figures land, so nothing jumps when they do. */
function OrderSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14" aria-busy="true" aria-label="Loading your order">
      <span className={`${BAR} h-4 w-24`} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <span className={`${BAR} h-11 w-72 max-w-full`} />
        <span className={`${BAR} h-11 w-36`} />
      </div>
      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <span key={i} className={`${BAR} h-6 w-full`} />
          ))}
        </div>
        <div className="edge-perforated h-[420px] bg-card" />
      </div>
    </div>
  );
}

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);

  const orderQuery = useQuery({
    queryKey: queryKeys.order(id),
    queryFn: () => api<Order>(`/orders/${id}`),
    // Refunds settle asynchronously at the provider; poll only while one is in flight.
    refetchInterval: q => (q.state.data?.status === 'refund_requested' ? 3_000 : false),
  });
  const order = orderQuery.data;
  const breakdown = useMemo(() => (order ? orderBreakdown(order) : null), [order]);
  const setOrder = (next: Order) => {
    queryClient.setQueryData(queryKeys.order(id), next);
    queryClient.invalidateQueries({ queryKey: queryKeys.orders, exact: true });
  };

  useEffect(() => {
    if (search.get('paid')) toast.success('Payment received. Your order is confirmed.', { id: `paid-${id}` });
  }, [search, id]);

  const live = useLiveEvents(['orders'], e => {
    if ((e.data as { orderId?: string }).orderId !== id) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.order(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.orders, exact: true });
  });

  const cancel = useMutation({
    mutationFn: ({ orderId }: { orderId: string; wasPaid: boolean }) => api<Order>(`/orders/${orderId}/cancel`, { method: 'POST' }),
    onSuccess: (updated, { wasPaid }) => {
      setOrder(updated);
      toast.success(wasPaid ? 'Order cancelled. Your refund is on its way.' : 'Order cancelled.');
    },
    onError: e => toast.error(errorMessage(e)),
  });

  if (orderQuery.isError && !order) {
    const missing = orderQuery.error instanceof ApiError && (orderQuery.error.status === 404 || orderQuery.error.status === 403);
    return (
      <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14" role="alert">
        <h1 className="text-display-md font-extrabold">{missing ? 'We couldn’t find that order' : 'We couldn’t load this order'}</h1>
        <p className="mt-4 max-w-xl text-lg">
          {missing ? 'It may belong to another account. Your own orders are all in one list.' : 'Check your connection and try again.'}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {!missing && (
            <Button size="lg" onClick={() => void orderQuery.refetch()}>
              Try again
            </Button>
          )}
          <Button asChild size="lg" variant={missing ? 'default' : 'outline'}>
            <Link href="/orders">Back to your orders</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!order || !breakdown) return <OrderSkeleton />;

  const cancellable = CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);
  const paidAlready = order.status !== 'created';
  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt).getTime() : null;
  const refundable =
    PARTIAL_REFUND_STATUSES.includes(order.status) && deliveredAt !== null && Date.now() - deliveredAt <= REFUND_WINDOW_DAYS * DAY_MS;
  const pieces = order.items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14" data-testid="order-detail-page">
      <Link href="/orders" className="text-[15px] font-medium underline underline-offset-4 hover:text-muted-foreground">
        All orders
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div className="min-w-0">
          <h1 className="text-display-md font-extrabold">{order.orderNumber}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px]">
            <StatusBadge status={order.status} testId="order-detail-status" className="text-[15px] font-semibold" />
            <span className="text-muted-foreground">Placed {fmtDate(order.createdAt)}</span>
            {live && (
              <span className="inline-flex items-center gap-2 text-muted-foreground" data-testid="order-live-indicator">
                <span aria-hidden className="h-1.5 w-1.5 bg-positive" />
                Updates live
              </span>
            )}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-[15px] text-muted-foreground">
            {order.refundedAmount > 0 ? `Paid, ${fmtINR(order.refundedAmount)} refunded` : paidAlready ? 'Total paid' : 'Total due'}
          </p>
          <p className="mt-1 text-display-md font-extrabold">{fmtINR(order.total)}</p>
        </div>
      </header>

      {(cancellable || refundable) && (
        <div className="mt-8 flex flex-wrap gap-3">
          {refundable && (
            <Button data-testid="order-refund-button" onClick={() => setRefundOpen(true)}>
              Return pieces
            </Button>
          )}
          {cancellable && (
            <Button
              variant="outline"
              data-testid="order-cancel-button"
              className="text-destructive"
              onClick={() => cancel.mutate({ orderId: order._id, wasPaid: paidAlready })}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Cancelling…' : paidAlready ? 'Cancel and refund' : 'Cancel order'}
            </Button>
          )}
        </div>
      )}

      <div className="mt-12 grid gap-14 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16">
        <div className="min-w-0 space-y-14">
          <section aria-labelledby="progress-heading">
            <h2 id="progress-heading" className={H2}>
              Progress
            </h2>
            <div className="mt-5">
              <OrderTimeline order={order} />
            </div>
          </section>

          <section aria-labelledby="pieces-heading">
            <h2 id="pieces-heading" className={H2}>
              In this parcel
            </h2>
            <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
              {order.items.map(item => (
                <li key={`${item.productId}-${item.size}`}>
                  <Link href={`/products/${item.slug}`} className="group block">
                    <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
                      <Image src={item.image} alt={item.title} fill sizes="(min-width: 1024px) 200px, 45vw" className="object-cover" />
                    </div>
                    <p className="mt-2 font-medium leading-snug group-hover:underline group-hover:underline-offset-4">{item.title}</p>
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    Size {item.size}, qty {item.qty}
                    {item.refundedQty > 0 && `, ${item.refundedQty} returned`}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-10 sm:grid-cols-2">
            <section aria-labelledby="delivery-heading">
              <h2 id="delivery-heading" className={H2}>
                Delivery
              </h2>
              <address className="mt-4 text-[15px] not-italic leading-relaxed">
                <span className="font-medium">{order.address.name}</span>
                <br />
                {order.address.line1}
                <br />
                {order.address.city}, {order.address.state} {order.address.pincode}
                <br />
                {order.address.phone}
              </address>
            </section>
            <section aria-labelledby="payment-heading">
              <h2 id="payment-heading" className={H2}>
                Payment
              </h2>
              <p className="mt-4 text-[15px] capitalize leading-relaxed">
                {order.payment.provider}, {order.payment.status}
              </p>
              {order.payment.razorpayPaymentId && (
                <p className="mt-1 truncate text-sm text-muted-foreground" title={order.payment.razorpayPaymentId}>
                  Reference {order.payment.razorpayPaymentId}
                </p>
              )}
            </section>
          </div>

          {order.refunds.length > 0 && (
            <section aria-labelledby="refunds-heading" data-testid="order-refund-card">
              <h2 id="refunds-heading" className={H2}>
                Refunds
              </h2>
              <ul className="mt-4 divide-y divide-border bg-card">
                {order.refunds.map(r => (
                  <li
                    key={r.id}
                    data-testid={`order-refund-${r.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 px-5 py-4"
                  >
                    <p className="font-semibold">{fmtINR(r.amount)}</p>
                    <p className="text-right text-[15px]">{REFUND_LABELS[r.status]}</p>
                    <p className="col-span-2 text-sm text-muted-foreground">
                      {r.kind === 'full' ? 'Whole order' : `${r.lines.reduce((s, l) => s + l.qty, 0)} of ${pieces} pieces`}, requested{' '}
                      {fmtDateTime(r.requestedAt)}
                    </p>
                    <p className="col-span-2 text-[15px]">{r.reason}</p>
                    {r.failureReason && <p className="col-span-2 text-[15px] text-destructive">{r.failureReason}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <PriceBreakdown
            breakdown={breakdown}
            items
            meta={order.paidAt ? `Paid ${fmtDate(order.paidAt)}` : `Placed ${fmtDate(order.createdAt)}`}
            testIds={{
              root: 'order-detail-summary',
              subtotal: 'order-detail-subtotal',
              total: 'order-detail-total',
              savings: 'order-detail-savings',
              codeDiscount: undefined,
              discounts: 'order-detail-discount',
              offers: 'order-detail-offers',
            }}
          >
            {order.refundedAmount > 0 && (
              <div className="mt-5 flex items-baseline justify-between gap-6 text-[15px]">
                <span>Refunded</span>
                <span data-testid="order-detail-refunded" className="font-semibold tabular-nums">
                  −{fmtINR(order.refundedAmount)}
                </span>
              </div>
            )}
          </PriceBreakdown>
        </aside>
      </div>

      <RefundDialog
        order={order}
        open={refundOpen}
        onOpenChange={setRefundOpen}
        endpoint={`/orders/${order._id}/refund`}
        onRefunded={setOrder}
      />
    </div>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={null}>
      <OrderDetailContent />
    </Suspense>
  );
}
