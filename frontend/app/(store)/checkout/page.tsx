'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field, INVALID } from '@/components/checkout/field';
import { PayBar } from '@/components/checkout/pay-bar';
import { PriceBreakdown, PromoCodes } from '@/components/price-breakdown';
import { useAuth, useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError, errorMessage, fmtINR } from '@/lib/api';
import { REQUOTE_CODES, usePriceQuote } from '@/lib/use-price-quote';
import type { Order } from '@storefront/contracts';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  handler: (res: RazorpaySuccess) => void;
}

type PaymentSetup =
  { mode: 'demo' } | { mode: 'razorpay'; keyId: string; amount: number; currency: string; razorpayOrderId: string; orderId: string };

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

type Address = { name: string; line1: string; city: string; state: string; pincode: string; phone: string };
type AddressKey = keyof Address;

/** The delivery fields, with the keyboard and autofill each one wants on a phone. */
const FIELDS: Array<{
  key: AddressKey;
  label: string;
  span: string;
  hint?: string;
  testId: string;
  props: React.InputHTMLAttributes<HTMLInputElement>;
}> = [
  { key: 'name', label: 'Full name', span: 'col-span-2', testId: 'checkout-name-input', props: { autoComplete: 'shipping name' } },
  {
    key: 'line1',
    label: 'Address',
    span: 'col-span-2',
    testId: 'checkout-address-input',
    props: { autoComplete: 'shipping street-address' },
  },
  { key: 'city', label: 'City', span: 'col-span-1', testId: 'checkout-city-input', props: { autoComplete: 'shipping address-level2' } },
  {
    key: 'state',
    label: 'State',
    span: 'col-span-1',
    testId: 'checkout-state-input',
    props: { autoComplete: 'shipping address-level1' },
  },
  {
    key: 'pincode',
    label: 'Pincode',
    span: 'col-span-1',
    hint: '6 digits',
    testId: 'checkout-pincode-input',
    props: { autoComplete: 'shipping postal-code', inputMode: 'numeric', maxLength: 6, pattern: '[0-9]*' },
  },
  {
    key: 'phone',
    label: 'Phone',
    span: 'col-span-1',
    hint: '10 digits',
    testId: 'checkout-phone-input',
    props: { type: 'tel', autoComplete: 'shipping tel-national', inputMode: 'tel', maxLength: 10 },
  },
];

/** The same rules the API's address schema applies, said the way a person would. */
function validate(a: Address): Partial<Record<AddressKey, string>> {
  const errors: Partial<Record<AddressKey, string>> = {};
  if (a.name.trim().length < 2) errors.name = 'Enter the name of the person receiving the parcel.';
  if (a.line1.trim().length < 4) errors.line1 = 'Enter the house number and street.';
  if (a.city.trim().length < 2) errors.city = 'Enter the city.';
  if (a.state.trim().length < 2) errors.state = 'Enter the state.';
  if (!/^\d{6}$/.test(a.pincode)) errors.pincode = a.pincode ? 'A pincode has exactly 6 digits.' : 'Enter the pincode.';
  if (!/^\d{10}$/.test(a.phone))
    errors.phone = a.phone ? 'A mobile number has exactly 10 digits.' : 'Enter a mobile number for the courier.';
  return errors;
}

export default function CheckoutPage() {
  const { user } = useAuth();
  const { items, clear } = useCart();
  const router = useRouter();
  const [mode, setMode] = useState<'demo' | 'razorpay' | null>(null);
  const [paying, setPaying] = useState(false);
  const [address, setAddress] = useState<Address>({ name: '', line1: '', city: '', state: '', pincode: '', phone: '' });
  const [errors, setErrors] = useState<Partial<Record<AddressKey, string>> | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const { quote, loading: quoting, error: quoteError, refresh } = usePriceQuote(items, codes);
  const checkoutAttempt = useRef<{ body: string; key: string } | null>(null);

  const breakdown = quote?.breakdown ?? null;
  const total = breakdown?.total ?? 0;

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

  const set = (k: AddressKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = k === 'pincode' || k === 'phone' ? e.target.value.replace(/\D/g, '') : e.target.value;
    const next = { ...address, [k]: value };
    setAddress(next);
    // After a first attempt, errors clear as each field is put right.
    if (errors) setErrors(validate(next));
  };

  const finishPayment = (order: Order) => {
    clear();
    router.replace(`/orders/${order._id}?paid=1`);
  };

  const payWithRazorpay = async (order: Order) => {
    const setup = await api<PaymentSetup>('/payments/create', {
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
      script.onerror = () => reject(new Error('We couldn’t load Razorpay. Check your connection and try again.'));
      document.body.appendChild(script);
    });
    const Razorpay = window.Razorpay;
    if (!Razorpay) throw new Error('We couldn’t load Razorpay. Check your connection and try again.');
    const rzp = new Razorpay({
      key: setup.keyId,
      amount: setup.amount,
      currency: setup.currency,
      order_id: setup.razorpayOrderId,
      name: 'STOREFRONT',
      description: order.orderNumber,
      prefill: { name: address.name, contact: address.phone },
      handler: async res => {
        try {
          const result = await api<{ order: Order }>('/payments/verify', {
            method: 'POST',
            body: JSON.stringify({ orderId: order._id, ...res }),
          });
          finishPayment(result.order);
        } catch (e) {
          toast.error(errorMessage(e));
        }
      },
    });
    rzp.open();
  };

  const placeOrder = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const found = validate(address);
    setErrors(found);
    const firstInvalid = FIELDS.find(f => found[f.key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid.key)?.focus();
      return;
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
    } catch (e) {
      if (e instanceof ApiError && e.code && REQUOTE_CODES.has(e.code)) {
        const fresh = await refresh();
        toast.warning(fresh ? `${e.message} Your new total is ${fmtINR(fresh.breakdown.total)}.` : e.message);
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setPaying(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <h1 className="text-display-md font-extrabold">Checkout</h1>
        <p className="mt-6 max-w-xl text-lg">Your bag is empty, so there is nothing to pay for yet.</p>
        <Button size="lg" className="mt-8" onClick={() => router.push('/products')} data-testid="checkout-empty-shop-button">
          Browse the collection
        </Button>
      </div>
    );
  }

  const payLabel = paying ? 'Placing your order…' : breakdown ? `Pay ${fmtINR(total)}` : 'Pay';

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14 lg:pb-24" data-testid="checkout-page">
      <h1 className="text-display-md font-extrabold">Checkout</h1>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16">
        <form id="checkout-form" noValidate onSubmit={placeOrder} className="space-y-14">
          <section aria-labelledby="address-heading">
            <h2 id="address-heading" className="text-xl font-bold tracking-[-0.02em]">
              Delivery address
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-5">
              {FIELDS.map(f => (
                <Field key={f.key} id={f.key} label={f.label} hint={f.hint} error={errors?.[f.key]} className={f.span}>
                  {control => (
                    <Input
                      {...control}
                      {...f.props}
                      data-testid={f.testId}
                      value={address[f.key]}
                      onChange={set(f.key)}
                      enterKeyHint={f.key === 'phone' ? 'done' : 'next'}
                      className={INVALID}
                    />
                  )}
                </Field>
              ))}
            </div>
          </section>

          <section aria-labelledby="payment-heading">
            <h2 id="payment-heading" className="text-xl font-bold tracking-[-0.02em]">
              Payment
            </h2>
            {mode === 'demo' ? (
              <p data-testid="checkout-demo-banner" className="mt-4 bg-secondary px-5 py-4 text-[15px] leading-relaxed">
                Payments are in demo mode. Paying simulates a Razorpay capture through the same idempotent confirmation the live keys use,
                and no card is charged.
              </p>
            ) : (
              <p className="mt-4 text-[15px] leading-relaxed">
                You pay on Razorpay’s own screen, by card, UPI or netbanking. We confirm the payment’s signature before the order is marked
                paid.
              </p>
            )}
          </section>
        </form>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <PriceBreakdown
            breakdown={breakdown}
            loading={quoting}
            error={quoteError}
            onRetry={refresh}
            items
            promo={<PromoCodes codes={codes} onChange={setCodes} breakdown={breakdown} loading={quoting} />}
          />
          <PayBar className="lg:mt-4">
            <div className="flex items-center gap-4">
              <div className="shrink-0 lg:hidden">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-extrabold tracking-[-0.02em]">{breakdown ? fmtINR(total) : '—'}</p>
              </div>
              <Button
                type="submit"
                form="checkout-form"
                data-testid="checkout-pay-button"
                size="lg"
                className="flex-1 lg:w-full"
                disabled={paying || mode === null || !quote || quoting}
              >
                {payLabel}
              </Button>
            </div>
          </PayBar>
          <p className="mt-3 text-sm text-muted-foreground">Your pieces are held for you while you pay.</p>
        </aside>
      </div>
    </div>
  );
}
