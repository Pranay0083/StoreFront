'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { OrderTimeline } from '@/components/order-timeline';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, fmtDate, fmtINR } from '@/lib/api';
import type { Order } from '@/lib/types';

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    api<Order>(`/orders/${id}`).then(setOrder).catch(() => {});
  }, [id]);

  useEffect(() => {
    load();
    if (search.get('paid')) toast.success('Order confirmed — thank you.');
  }, [load, search]);

  if (!order) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-12 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const cancellable = order.status === 'created' || order.status === 'paid';

  const cancel = async () => {
    setCancelling(true);
    try {
      await api(`/orders/${order._id}/cancel`, { method: 'POST' });
      toast.success('Order cancelled');
      load();
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
          <Link href="/orders" className="label-caps text-muted-foreground hover:underline">← All orders</Link>
          <h1 className="mt-2 font-mono text-3xl font-semibold tracking-tight">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Placed {fmtDate(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} testId="order-detail-status" />
          {cancellable && (
            <Button variant="destructive" size="sm" data-testid="order-cancel-button" onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel order'}
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
                  <p className="text-xs text-muted-foreground">Size {item.size} × {item.qty}</p>
                </div>
                <p className="text-sm font-semibold">{fmtINR(item.price * item.qty)}</p>
              </div>
            </div>
          ))}
          <div className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{fmtINR(order.subtotal)}</span></div>
            {order.discount > 0 && (
              <div className="flex justify-between text-emerald-800">
                <span>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</span>
                <span data-testid="order-detail-discount">−{fmtINR(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground"><span>Shipping</span><span>{order.shipping === 0 ? 'Free' : fmtINR(order.shipping)}</span></div>
            <div className="flex justify-between border-t border-black/10 pt-2 text-base font-semibold">
              <span>Total</span><span data-testid="order-detail-total">{fmtINR(order.total)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="border border-black/10 bg-white p-6">
            <p className="label-caps mb-4 text-muted-foreground">Delivery</p>
            <p className="text-sm font-medium">{order.address.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.address.line1}<br />{order.address.city}, {order.address.state} {order.address.pincode}<br />{order.address.phone}
            </p>
          </div>
          <div className="border border-black/10 bg-white p-6">
            <p className="label-caps mb-4 text-muted-foreground">Payment</p>
            <p className="text-sm capitalize">{order.payment.provider} · {order.payment.status}</p>
            {order.payment.razorpayPaymentId && (
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{order.payment.razorpayPaymentId}</p>
            )}
          </div>
        </div>
      </div>
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
