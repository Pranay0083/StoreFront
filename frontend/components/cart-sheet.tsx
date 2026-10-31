'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FREE_SHIPPING_THRESHOLD, type CartItem } from '@storefront/contracts';
import { BagLine } from '@/components/checkout/bag-line';
import { PriceBreakdown, lineKey } from '@/components/price-breakdown';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { fmtINR } from '@/lib/api';
import { usePriceQuote } from '@/lib/use-price-quote';

export { StockNote } from '@/components/checkout/bag-line';

const NO_ITEMS: CartItem[] = [];
const NO_CODES: string[] = [];

/** The bag drawer: the pieces on the ground, the receipt on paper beneath them, and one way on. */
export function CartSheet() {
  const { items, subtotal, open, setOpen } = useCart();
  const router = useRouter();
  // Price the bag only while the drawer is open, so the receipt shows the offers the optimizer found.
  const { quote, loading, error, refresh } = usePriceQuote(open ? items : NO_ITEMS, NO_CODES);
  const breakdown = quote?.breakdown ?? null;
  const priced = new Map((breakdown?.lines ?? []).map(l => [lineKey(l), l]));
  const toFreeShipping = FREE_SHIPPING_THRESHOLD - subtotal;
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent data-testid="cart-sheet" className="max-w-[440px] bg-background">
        <div className="px-5 pb-4 pr-16 pt-6 sm:px-6">
          <SheetTitle className="text-2xl font-extrabold tracking-[-0.03em]">Your bag</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted-foreground">
            {items.length === 0
              ? `Shipping is free over ${fmtINR(FREE_SHIPPING_THRESHOLD)}.`
              : toFreeShipping > 0
                ? `${fmtINR(toFreeShipping)} more and shipping is free.`
                : 'Shipping is free on this order.'}
          </SheetDescription>
        </div>

        {items.length === 0 ? (
          <div className="px-5 pt-6 sm:px-6">
            <p className="text-lg font-semibold">Nothing in your bag yet.</p>
            <p className="mt-1 text-[15px] text-muted-foreground">Add a few pieces and the receipt prices them as you go.</p>
            <Button
              className="mt-6"
              data-testid="cart-empty-shop-button"
              onClick={() => {
                close();
                router.push('/products');
              }}
            >
              Browse the collection
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
              {items.map(item => (
                <BagLine
                  key={lineKey(item)}
                  item={item}
                  priced={priced.get(lineKey(item))}
                  breakdown={breakdown}
                  dense
                  onNavigate={close}
                  testIds={{
                    root: `cart-item-${item.slug}`,
                    remove: `cart-item-remove-${item.slug}`,
                    decrease: `cart-item-decrease-${item.slug}`,
                    increase: `cart-item-increase-${item.slug}`,
                    qty: `cart-item-qty-${item.slug}`,
                  }}
                />
              ))}
            </ul>
            <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-6">
              <PriceBreakdown
                breakdown={breakdown}
                loading={loading}
                error={error}
                onRetry={refresh}
                notes={false}
                compact
                testIds={{
                  root: 'cart-sheet-summary',
                  subtotal: 'cart-subtotal',
                  total: 'cart-sheet-total',
                  savings: 'cart-sheet-savings',
                  codeDiscount: undefined,
                }}
              />
              <Button data-testid="cart-checkout-button" className="mt-4 w-full" size="lg" asChild>
                <Link href="/checkout" onClick={close}>
                  Checkout
                </Link>
              </Button>
              <Link
                href="/cart"
                onClick={close}
                className="mt-3 block py-1 text-center text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
              >
                View the full bag
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
