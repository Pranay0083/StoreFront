'use client';

import { Lock } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppliedOffers, PriceSummary, PromoCodes } from '@/components/price-breakdown';
import { useAuth, useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, fmtINR } from '@/lib/api';
import { REQUOTE_CODES, usePriceQuote } from '@/lib/use-price-quote';
import type { Order } from '@storefront/contracts';

declare global {
  interface Window {
    Razorpay: any;
  }
}

function LineTotal({ listTotal, paid }: { listTotal: number; paid?: number }) {
  if (paid === undefined || paid === listTotal) return <p className="text-sm font-medium">{fmtINR(listTotal)}</p>;
  return (
    <p className="text-right text-sm font-medium">
      <span className="block text-xs text-muted-foreground line-through">{fmtINR(listTotal)}</span>
      {fmtINR(paid)}
    </p>
  );
}

export default function CheckoutPage() {
  const { user } = useAuth();
  const { items, clear } = useCart();
  const router = useRouter();
  const [mode, setMode] = useState<'demo' | 'razorpay' | null>(null);
  const [paying, setPaying] = useState(false);
  const [address, setAddress] = useState({ name: '', line1: '', city: '', state: '', pincode: '', phone: '' });
  const [codes, setCodes] = useState<string[]>([]);
  const { quote, loading: quoting, error: quoteError, refresh } = usePriceQuote(items, codes);
  const checkoutAttempt = useRef<{ body: string; key: string } | null>(null);

  const breakdown = quote?.breakdown ?? null;
  const total = breakdown?.total ?? 0;
  const paidFor = new Map((breakdown?.lines ?? []).map(l => [`${l.productId}::${l.size}`, l.lineTotal]));

  useEffect(() => {
    if (user === false) router.replace('/login?next=/checkout');
  }, [user, router]);

  useEffect(() => {
    api<{ mode: 'demo' | 'razorpay' }>('/payments/config')
      .then(d => setMode(d.mode))
      .catch(() => setMode('demo'));
  }, []);

  useEffect(() => {
    if (user && typeof user === 'object' && !address.name) {
      setAddress(a => ({ ...a, name: user.name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setAddress(a => ({ ...a, [k]: e.target.value }));

  const finishPayment = (order: Order) => {
    clear();
    toast.success('Payment confirmed — order is now PAID');
    router.replace(`/orders/${order._id}?paid=1`);
  };

  const payWithRazorpay = async (order: Order) => {
    const setup = await api<any>('/payments/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `payment-session:${order._id}` },
      body: JSON.stringify({ orderId: order._id }),
    });
    if (setup.mode === 'demo') {
      const result = await api<{ order: Order }>('/payments/demo-confirm', {
        method: 'POST',
        headers: { 'Idempotency-Key': `demo-confirm:${order._id}` },
        body: JSON.stringify({ orderId: order._id }),
      });
      return finishPayment(result.order);
    }
    await new Promise<void>((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Razorpay'));
      document.body.appendChild(script);
    });
    const rzp = new window.Razorpay({
      key: setup.keyId,
      amount: setup.amount,
      currency: setup.currency,
      order_id: setup.razorpayOrderId,
      name: 'STOREFRONT',
      description: order.orderNumber,
      prefill: { name: address.name, contact: address.phone },
      handler: async (res: any) => {
        try {
          const result = await api<{ order: Order }>('/payments/verify', {
            method: 'POST',
            body: JSON.stringify({ orderId: order._id, ...res }),
          });
          finishPayment(result.order);
        } catch (e: any) {
          toast.error(e.message);
        }
      },
    });
    rzp.open();
  };

  const placeOrder = async () => {
    for (const [k, label] of Object.entries({
      name: 'Full name',
      line1: 'Address',
      city: 'City',
      state: 'State',
      pincode: 'Pincode',
      phone: 'Phone',
    })) {
      if (!(address as any)[k]) return toast.error(`${label} is required`);
    }
    if (!quote || quoting) return;
    if (breakdown?.rejectedCodes.length) return toast.error('Remove the promo codes that cannot be applied first');
    setPaying(true);
    try {
      const body = JSON.stringify({
        items: items.map(i => ({ productId: i.productId, size: i.size, qty: i.qty })),
        address,
        codes,
        quoteId: quote.quoteId,
      });
      // Retrying the same checkout reuses its key, so a timeout or double click never places two orders.
      if (checkoutAttempt.current?.body !== body) checkoutAttempt.current = { body, key: crypto.randomUUID() };
      const order = await api<Order>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': checkoutAttempt.current.key },
        body,
      });
      await payWithRazorpay(order);
    } catch (e: any) {
      if (e instanceof ApiError && e.code && REQUOTE_CODES.has(e.code)) {
        const fresh = await refresh();
        toast.warning(fresh ? `${e.message} Your new total is ${fmtINR(fresh.breakdown.total)}.` : e.message);
      } else {
        toast.error(e.message);
      }
    } finally {
      setPaying(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-32 text-center sm:px-8">
        <p className="font-serif text-3xl">Your bag is empty.</p>
        <Button className="mt-6" onClick={() => router.push('/products')} data-testid="checkout-empty-shop-button">
          Browse the collection
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8" data-testid="checkout-page">
      <h1 className="font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">Checkout</h1>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <p className="label-caps text-muted-foreground">Shipping address</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" data-testid="checkout-name-input" value={address.name} onChange={set('name')} placeholder="Asha Verma" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="line1">Address</Label>
              <Input
                id="line1"
                data-testid="checkout-address-input"
                value={address.line1}
                onChange={set('line1')}
                placeholder="221B Residency Road"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" data-testid="checkout-city-input" value={address.city} onChange={set('city')} placeholder="Bengaluru" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" data-testid="checkout-state-input" value={address.state} onChange={set('state')} placeholder="Karnataka" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pincode">Pincode</Label>
              <Input
                id="pincode"
                data-testid="checkout-pincode-input"
                value={address.pincode}
                onChange={set('pincode')}
                placeholder="560025"
                maxLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                data-testid="checkout-phone-input"
                value={address.phone}
                onChange={set('phone')}
                placeholder="9812345678"
                maxLength={10}
              />
            </div>
          </div>

          {mode === 'demo' && (
            <div data-testid="checkout-demo-banner" className="border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Payments are in <strong>demo mode</strong> — clicking Pay simulates a Razorpay capture through the same idempotent
              confirmation path. Add Razorpay keys to go live.
            </div>
          )}
        </div>

        <aside className="h-fit border border-black/10 bg-white p-8">
          <p className="label-caps text-muted-foreground">Order summary</p>
          <div className="mt-6 max-h-72 space-y-4 overflow-y-auto">
            {items.map(i => (
              <div key={`${i.productId}-${i.size}`} className="flex items-center gap-3">
                <div className="relative h-16 w-13 w-14 shrink-0 overflow-hidden bg-muted">
                  <Image src={i.image} alt={i.title} fill sizes="56px" className="object-cover" />
                </div>
                <div className="flex-1 text-sm">
                  <p className="font-medium leading-tight">{i.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.size} × {i.qty}
                  </p>
                </div>
                <LineTotal listTotal={i.price * i.qty} paid={paidFor.get(`${i.productId}::${i.size}`)} />
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-black/10 pt-5">
            <PromoCodes codes={codes} onChange={setCodes} breakdown={breakdown} />
          </div>
          {breakdown && (
            <div className="mt-5 border-t border-black/10 pt-5">
              <AppliedOffers breakdown={breakdown} />
            </div>
          )}
          <div className="mt-5 border-t border-black/10 pt-5">
            <PriceSummary breakdown={breakdown} loading={quoting} />
            {quoteError && <p className="mt-2 text-xs text-destructive">{quoteError}</p>}
          </div>
          <Button
            data-testid="checkout-pay-button"
            size="lg"
            className="mt-8 w-full"
            onClick={placeOrder}
            disabled={paying || mode === null || !quote || quoting}
          >
            <Lock className="h-4 w-4" />
            {paying ? 'Processing…' : mode === 'demo' ? `Demo Pay ${fmtINR(total)}` : `Pay ${fmtINR(total)}`}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Best price chosen automatically · Signature-verified · Stock reserved at checkout
          </p>
        </aside>
      </div>
    </div>
  );
}
