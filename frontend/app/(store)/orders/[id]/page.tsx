'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { CUSTOMER_CANCELLABLE_STATUSES, REFUND_WINDOW_DAYS, type Order } from '@storefront/contracts';
import { toast } from 'sonner';
import { OrderTimeline } from '@/components/order-timeline';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, fmtDateTime, fmtINR } from '@/lib/api';

const DAY_MS = 86_400_000;
const REFUND_LABELS: Record<NonNullable<Order['refund']>['status'], string> = {
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
  const [refundReason, setRefundReason] = useState('');
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(() => {
    api<Order>(`/orders/${id}`)
      .then(setOrder)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    if (search.get('paid')) toast.success('Order confirmed — thank you.');
  }, [load, search]);

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
  const refundable = order.status === 'delivered' && deliveredAt !== null && Date.now() - deliveredAt <= REFUND_WINDOW_DAYS * DAY_MS;

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

  const requestRefund = async () => {
    setRequesting(true);
    try {
      const updated = await api<Order>(`/orders/${order._id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: refundReason }),
      });
      setOrder(updated);
      setRefundOpen(false);
      toast.success('Refund requested');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRequesting(false);
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
              Request refund
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
                  </p>
                </div>
                <p className="text-sm font-semibold">{fmtINR(item.price * item.qty)}</p>
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
                <span>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</span>
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
          {order.refund && (
            <div className="border border-black/10 bg-white p-6" data-testid="order-refund-card">
              <p className="label-caps mb-4 text-muted-foreground">Refund</p>
              <p className="text-sm font-medium">
                {fmtINR(order.refund.amount)} · {REFUND_LABELS[order.refund.status]}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Requested {fmtDateTime(order.refund.requestedAt)}</p>
              <p className="mt-2 text-sm text-muted-foreground">{order.refund.reason}</p>
              {order.refund.failureReason && <p className="mt-2 text-sm text-destructive">{order.refund.failureReason}</p>}
            </div>
          )}
        </div>
      </div>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent data-testid="order-refund-dialog">
          <DialogTitle>Request a refund</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Refunds are available for {REFUND_WINDOW_DAYS} days after delivery and go back to your original payment method.
          </p>
          <Textarea
            data-testid="order-refund-reason"
            placeholder="Tell us what went wrong"
            value={refundReason}
            onChange={e => setRefundReason(e.target.value)}
            maxLength={500}
          />
          <Button data-testid="order-refund-submit" onClick={requestRefund} disabled={requesting || refundReason.trim().length < 3}>
            {requesting ? 'Submitting…' : 'Submit request'}
          </Button>
        </DialogContent>
      </Dialog>
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
