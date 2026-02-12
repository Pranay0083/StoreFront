'use client';

import { Lock } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth, useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, fmtINR } from '@/lib/api';
import type { Order } from '@/lib/types';

declare global {
  interface Window { Razorpay: any }
}

export default function CheckoutPage() {
  const { user } = useAuth();
  const { items, subtotal, clear } = useCart();
  const router = useRouter();
  const [mode, setMode] = useState<'demo' | 'razorpay' | null>(null);
  const [paying, setPaying] = useState(false);
  const [address, setAddress] = useState({ name: '', line1: '', city: '', state: '', pincode: '', phone: '' });
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [applying, setApplying] = useState(false);

  const shipping = subtotal >= 2999 || subtotal === 0 ? 0 : 99;
  const discount = coupon?.discount ?? 0;
  const total = subtotal - discount + shipping;

  useEffect(() => {
    if (user === false) router.replace('/login?next=/checkout');
  }, [user, router]);

  useEffect(() => {
    api<{ mode: 'demo' | 'razorpay' }>('/payments/config').then(d => setMode(d.mode)).catch(() => setMode('demo'));
  }, []);

  useEffect(() => {
    if (user && typeof user === 'object' && !address.name) {
      setAddress(a => ({ ...a, name: user.name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress(a => ({ ...a, [k]: e.target.value }));

  const applyCouponCode = async () => {
    if (!couponInput.trim()) return;
    setApplying(true);
    try {
      const d = await api<{ code: string; discount: number }>('/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code: couponInput, subtotal }),
      });
      setCoupon({ code: d.code, discount: d.discount });
      toast.success(`${d.code} applied — you save ${fmtINR(d.discount)}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setApplying(false);
    }
  };

  const finishPayment = (order: Order) => {
    clear();
    toast.success('Payment confirmed — order is now PAID');
    router.replace(`/orders/${order._id}?paid=1`);
  };

  const payWithRazorpay = async (order: Order) => {
    const setup = await api<any>('/payments/create', { method: 'POST', body: JSON.stringify({ orderId: order._id }) });
    if (setup.mode === 'demo') {
      const result = await api<{ order: Order }>('/payments/demo-confirm', { method: 'POST', body: JSON.stringify({ orderId: order._id }) });
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
    for (const [k, label] of Object.entries({ name: 'Full name', line1: 'Address', city: 'City', state: 'State', pincode: 'Pincode', phone: 'Phone' })) {
      if (!(address as any)[k]) return toast.error(`${label} is required`);
    }
    setPaying(true);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: items.map(i => ({ productId: i.productId, size: i.size, qty: i.qty })),
          address,
          ...(coupon ? { couponCode: coupon.code } : {}),
        }),
      });
      await payWithRazorpay(order);
    } catch (e: any) {
      toast.error(e.message);
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
              <Input id="line1" data-testid="checkout-address-input" value={address.line1} onChange={set('line1')} placeholder="221B Residency Road" />
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
              <Input id="pincode" data-testid="checkout-pincode-input" value={address.pincode} onChange={set('pincode')} placeholder="560025" maxLength={6} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" data-testid="checkout-phone-input" value={address.phone} onChange={set('phone')} placeholder="9812345678" maxLength={10} />
            </div>
          </div>

          {mode === 'demo' && (
            <div data-testid="checkout-demo-banner" className="border border-amber-700/30 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Payments are in <strong>demo mode</strong> — clicking Pay simulates a Razorpay capture
              through the same idempotent confirmation path. Add Razorpay keys to go live.
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
                  <p className="text-xs text-muted-foreground">{i.size} × {i.qty}</p>
                </div>
                <p className="text-sm font-medium">{fmtINR(i.price * i.qty)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-black/10 pt-5">
            {coupon ? (
              <div className="flex items-center justify-between text-sm" data-testid="coupon-applied">
                <span className="font-medium text-emerald-800">{coupon.code} applied</span>
                <button
                  data-testid="coupon-remove-button"
                  onClick={() => setCoupon(null)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  data-testid="coupon-input"
                  value={couponInput}
                  onChange={e => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Coupon (try WELCOME10)"
                  className="h-10 flex-1"
                />
                <Button
                  data-testid="coupon-apply-button"
                  variant="outline"
                  className="h-10 px-4"
                  onClick={applyCouponCode}
                  disabled={applying || !couponInput.trim()}
                >
                  {applying ? '…' : 'Apply'}
                </Button>
              </div>
            )}
          </div>
          <div className="mt-5 space-y-3 border-t border-black/10 pt-5 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmtINR(subtotal)}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-800">
                <span>Discount ({coupon?.code})</span>
                <span data-testid="checkout-discount">−{fmtINR(discount)}</span>
              </div>
            )}
            <div className="flex justify-between"><span>Shipping</span><span>{shipping === 0 ? 'Free' : fmtINR(shipping)}</span></div>
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span><span data-testid="checkout-total">{fmtINR(total)}</span>
            </div>
          </div>
          <Button
            data-testid="checkout-pay-button"
            size="lg"
            className="mt-8 w-full"
            onClick={placeOrder}
            disabled={paying || mode === null}
          >
            <Lock className="h-4 w-4" />
            {paying ? 'Processing…' : mode === 'demo' ? `Demo Pay ${fmtINR(total)}` : `Pay ${fmtINR(total)}`}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Signature-verified · Idempotent confirmation · Stock reserved on payment
          </p>
        </aside>
      </div>
    </div>
  );
}
