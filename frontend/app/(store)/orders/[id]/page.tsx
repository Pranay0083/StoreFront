'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { CUSTOMER_CANCELLABLE_STATUSES, PARTIAL_REFUND_STATUSES, REFUND_WINDOW_DAYS, type Order } from '@storefront/contracts';
import { toast } from 'sonner';
import { OrderTimeline } from '@/components/order-timeline';
import { RefundDialog } from '@/components/refund-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, fmtDate, fmtDateTime, fmtINR } from '@/lib/api';
import { useLiveEvents } from '@/lib/live';

const DAY_MS = 86_400_000;
const REFUND_LABELS: Record<Order['refunds'][number]['status'], string> = {
  requested: 'Requested',
  processing: 'Submitted to payment provider',
  pending: 'Processing with your bank',
  processed: 'Refunded',
  failed: 'Failed',
};

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  const load = useCallback(() => {
    api<Order>(`/orders/${id}`)
      .then(setOrder)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    if (search.get('paid')) toast.success('Order confirmed — thank you.');
  }, [load, search]);

  useLiveEvents(['orders'], e => {
    if ((e.data as { orderId?: string }).orderId === id) load();
  });

  useEffect(() => {
    if (order?.status !== 'refund_requested') return;
    const timer = setInterval(load, 3_000);
    return () => clearInterval(timer);
  }, [order?.status, load]);

  if (!order) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-12 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const cancellable = CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);
  const paidAlready = order.status !== 'created';
  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt).getTime() : null;
  const refundable =
    PARTIAL_REFUND_STATUSES.includes(order.status) && deliveredAt !== null && Date.now() - deliveredAt <= REFUND_WINDOW_DAYS * DAY_MS;

  const cancel = async () => {
    setCancelling(true);
    try {
      const updated = await api<Order>(`/orders/${order._id}/cancel`, { method: 'POST' });
      setOrder(updated);
      toast.success(paidAlready ? 'Order cancelled — your refund is on its way' : 'Order cancelled');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8" data-testid="order-detail-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/orders" className="label-caps text-muted-foreground hover:underline">
            ← All orders
          </Link>
          <h1 className="mt-2 font-mono text-3xl font-semibold tracking-tight">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Placed {fmtDate(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} testId="order-detail-status" />
          {cancellable && (
            <Button variant="destructive" size="sm" data-testid="order-cancel-button" onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : paidAlready ? 'Cancel & refund' : 'Cancel order'}
            </Button>
          )}
          {refundable && (
            <Button variant="outline" size="sm" data-testid="order-refund-button" onClick={() => setRefundOpen(true)}>
              Return items
            </Button>
          )}
        </div>
      </div>

      <div className="mt-10 border border-black/10 bg-white p-8">
        <OrderTimeline order={order} />
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_300px]">
        <div className="border border-black/10 bg-white p-8">
          <p className="label-caps mb-6 text-muted-foreground">Items</p>
          {order.items.map((item, i) => (
            <div key={i} className="flex gap-4 border-b border-black/5 py-4 first:pt-0 last:border-0">
              <div className="relative h-20 w-16 shrink-0 overflow-hidden bg-muted">
                <Image src={item.image} alt={item.title} fill sizes="64px" className="object-cover" />
              </div>
              <div className="flex flex-1 items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Size {item.size} × {item.qty}
                    {item.refundedQty > 0 && <span className="ml-2 text-amber-800">· {item.refundedQty} refunded</span>}
                  </p>
                </div>
                <p className="text-right text-sm font-semibold">
                  {item.lineTotal < item.price * item.qty && (
                    <span className="block text-xs font-normal text-muted-foreground line-through">{fmtINR(item.price * item.qty)}</span>
                  )}
                  {fmtINR(item.lineTotal)}
                </p>
              </div>
            </div>
          ))}
          <div className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{fmtINR(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-emerald-800">
                <span>
                  Discount
                  {order.couponCode ? ` (${order.couponCode})` : order.pricing?.codes.length ? ` (${order.pricing.codes.join(', ')})` : ''}
                </span>
                <span data-testid="order-detail-discount">−{fmtINR(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping</span>
              <span>{order.shipping === 0 ? 'Free' : fmtINR(order.shipping)}</span>
            </div>
            <div className="flex justify-between border-t border-black/10 pt-2 text-base font-semibold">
              <span>Total</span>
              <span data-testid="order-detail-total">{fmtINR(order.total)}</span>
            </div>
            {order.refundedAmount > 0 && (
              <div className="flex justify-between text-amber-800">
                <span>Refunded</span>
                <span data-testid="order-detail-refunded">−{fmtINR(order.refundedAmount)}</span>
              </div>
            )}
            {order.pricing?.applied.length ? (
              <ul className="mt-3 space-y-1 border-t border-black/10 pt-3 text-xs text-muted-foreground" data-testid="order-detail-offers">
                {order.pricing.applied.map(a => (
                  <li key={a.promotionId} className="flex justify-between">
                    <span>{a.name}</span>
                    <span>−{fmtINR(a.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="space-y-8">
          <div className="border border-black/10 bg-white p-6">
            <p className="label-caps mb-4 text-muted-foreground">Delivery</p>
            <p className="text-sm font-medium">{order.address.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.address.line1}
              <br />
              {order.address.city}, {order.address.state} {order.address.pincode}
              <br />
              {order.address.phone}
            </p>
          </div>
          <div className="border border-black/10 bg-white p-6">
            <p className="label-caps mb-4 text-muted-foreground">Payment</p>
            <p className="text-sm capitalize">
              {order.payment.provider} · {order.payment.status}
            </p>
            {order.payment.razorpayPaymentId && (
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{order.payment.razorpayPaymentId}</p>
            )}
          </div>
          {order.refunds.length > 0 && (
            <div className="border border-black/10 bg-white p-6" data-testid="order-refund-card">
              <p className="label-caps mb-4 text-muted-foreground">Refunds</p>
              <ul className="space-y-4">
                {order.refunds.map(r => (
                  <li key={r.id} data-testid={`order-refund-${r.id}`}>
                    <p className="text-sm font-medium">
                      {fmtINR(r.amount)} · {REFUND_LABELS[r.status]}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.kind === 'full' ? 'Whole order' : `${r.lines.reduce((s, l) => s + l.qty, 0)} item(s)`} · Requested{' '}
                      {fmtDateTime(r.requestedAt)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>
                    {r.failureReason && <p className="mt-1 text-sm text-destructive">{r.failureReason}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
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
