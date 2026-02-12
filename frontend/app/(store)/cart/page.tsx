'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';

export default function CartPage() {
  const { items, subtotal, updateQty, removeItem } = useCart();
  const shipping = subtotal >= 2999 || subtotal === 0 ? 0 : 99;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8" data-testid="cart-page">
      <h1 className="font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">Your bag</h1>

      {items.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-3xl">Empty, for now.</p>
          <Button asChild className="mt-6" data-testid="cart-page-shop-button">
            <Link href="/products">Browse the collection</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
          <div>
            {items.map(item => (
              <div key={`${item.productId}-${item.size}`} className="flex gap-6 border-b border-black/10 py-6 first:border-t">
                <Link href={`/products/${item.slug}`} className="relative h-36 w-28 shrink-0 overflow-hidden bg-muted">
                  <Image src={item.image} alt={item.title} fill sizes="112px" className="object-cover" />
                </Link>
                <div className="flex flex-1 flex-col justify-between py-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Link href={`/products/${item.slug}`} className="font-serif text-xl font-medium hover:underline">
                        {item.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">Size {item.size} · {fmtINR(item.price)}</p>
                    </div>
                    <button
                      data-testid={`cart-page-remove-${item.slug}`}
                      onClick={() => removeItem(item.productId, item.size)}
                      className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center border border-black/15">
                      <button onClick={() => updateQty(item.productId, item.size, item.qty - 1)} className="flex h-9 w-9 items-center justify-center hover:bg-black/5">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-10 text-center text-sm">{item.qty}</span>
                      <button onClick={() => updateQty(item.productId, item.size, item.qty + 1)} className="flex h-9 w-9 items-center justify-center hover:bg-black/5">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="font-semibold">{fmtINR(item.price * item.qty)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <aside className="h-fit border border-black/10 bg-white p-8">
            <p className="label-caps text-muted-foreground">Summary</p>
            <div className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span data-testid="summary-subtotal">{fmtINR(subtotal)}</span></div>
              <div className="flex justify-between"><span>Shipping</span><span>{shipping === 0 ? 'Free' : fmtINR(shipping)}</span></div>
              <div className="flex justify-between border-t border-black/10 pt-3 text-base font-semibold">
                <span>Total</span><span data-testid="summary-total">{fmtINR(subtotal + shipping)}</span>
              </div>
            </div>
            <Button asChild size="lg" className="mt-8 w-full" data-testid="cart-page-checkout-button">
              <Link href="/checkout">Proceed to checkout</Link>
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
