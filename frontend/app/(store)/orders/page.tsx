'use client';

import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, fmtDate, fmtINR } from '@/lib/api';
import type { Order } from '@/lib/types';

export default function OrdersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (user === false) router.replace('/login?next=/orders');
    if (user && typeof user === 'object') {
      api<Order[]>('/orders').then(setOrders).catch(() => setOrders([]));
    }
  }, [user, router]);

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8" data-testid="orders-page">
      <h1 className="font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">Your orders</h1>

      {orders === null ? (
        <div className="mt-10 space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-3xl">No orders yet.</p>
          <Button asChild className="mt-6"><Link href="/products">Start with something good</Link></Button>
        </div>
      ) : (
        <div className="mt-10 space-y-5">
          {orders.map(order => (
            <Link
              key={order._id}
              href={`/orders/${order._id}`}
              data-testid={`order-row-${order.orderNumber}`}
              className="group block border border-black/10 bg-white p-6 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <p className="font-mono text-sm font-semibold">{order.orderNumber}</p>
                  <StatusBadge status={order.status} testId={`order-status-${order.orderNumber}`} />
                </div>
                <p className="text-xs text-muted-foreground">{fmtDate(order.createdAt)}</p>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="flex -space-x-3">
                  {order.items.slice(0, 4).map((item, i) => (
                    <div key={i} className="relative h-14 w-11 overflow-hidden border-2 border-white bg-muted">
                      <Image src={item.image} alt="" fill sizes="44px" className="object-cover" />
                    </div>
                  ))}
                  {order.items.length > 4 && (
                    <div className="flex h-14 w-11 items-center justify-center border-2 border-white bg-black text-xs text-white">
                      +{order.items.length - 4}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-semibold">{fmtINR(order.total)}</p>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
