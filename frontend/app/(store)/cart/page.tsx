'use client';

import Link from 'next/link';
import { BagLine } from '@/components/checkout/bag-line';
import { PriceBreakdown, lineKey } from '@/components/price-breakdown';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { usePriceQuote } from '@/lib/use-price-quote';

const NO_CODES: string[] = [];

export default function CartPage() {
  const { items, count } = useCart();
  const { quote, loading, error, refresh } = usePriceQuote(items, NO_CODES);
  const breakdown = quote?.breakdown ?? null;
  const pricedLines = new Map((breakdown?.lines ?? []).map(l => [lineKey(l), l]));

  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14" data-testid="cart-page">
      <h1 className="text-display-md font-extrabold">Your bag</h1>

      {items.length === 0 ? (
        <div className="mt-6 max-w-xl">
          <p className="text-lg">Nothing in your bag yet. Add a few pieces and the receipt prices them as you go, bundles included.</p>
          <Button asChild size="lg" className="mt-8" data-testid="cart-page-shop-button">
            <Link href="/products">Browse the collection</Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[15px] text-muted-foreground">
            {count} {count === 1 ? 'piece' : 'pieces'}
          </p>
          <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16">
            <ul className="space-y-8" aria-label="Pieces in your bag">
              {items.map(item => (
                <BagLine
                  key={lineKey(item)}
                  item={item}
                  priced={pricedLines.get(lineKey(item))}
                  breakdown={breakdown}
                  testIds={{ remove: `cart-page-remove-${item.slug}`, price: `cart-line-price-${item.slug}` }}
                />
              ))}
            </ul>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <PriceBreakdown breakdown={breakdown} loading={loading} error={error} onRetry={refresh} />
              <Button asChild size="lg" className="mt-4 w-full" data-testid="cart-page-checkout-button">
                <Link href="/checkout">Checkout</Link>
              </Button>
              <Link
                href="/products"
                className="mt-3 block py-1 text-center text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
              >
                Keep shopping
              </Link>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
