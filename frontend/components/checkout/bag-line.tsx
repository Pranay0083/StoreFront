'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { CartItem, PriceBreakdown, PricedLine } from '@storefront/contracts';
import { QtyStepper } from '@/components/checkout/qty-stepper';
import { LinePrice } from '@/components/price-breakdown';
import { useCart } from '@/components/providers';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface BagLineTestIds {
  root?: string;
  remove?: string;
  decrease?: string;
  increase?: string;
  qty?: string;
  price?: string;
}

/** Stock trouble on a line, said plainly beside it. */
export function StockNote({ item }: { item: Pick<CartItem, 'qty' | 'stock' | 'available'> }) {
  if (item.stock === undefined || item.available !== false) return null;
  return (
    <p className="mt-1 text-sm font-medium text-destructive">
      {item.stock === 0 ? 'Out of stock. Remove it to check out.' : `Only ${item.stock} left. Lower the quantity to check out.`}
    </p>
  );
}

/**
 * One piece in the bag: its photograph, name and size, a stepper, and what it costs after the offers
 * the optimizer allocated to it. `dense` is the drawer's version.
 */
export function BagLine({
  item,
  priced,
  breakdown,
  dense = false,
  testIds,
  onNavigate,
}: {
  item: CartItem;
  priced?: PricedLine;
  breakdown?: PriceBreakdown | null;
  dense?: boolean;
  testIds?: BagLineTestIds;
  onNavigate?: () => void;
}) {
  const { updateQty, removeItem } = useCart();
  const href = `/products/${item.slug}`;
  // Rendered once: beside the name in the drawer, beside the stepper on the page.
  const price = <LinePrice listTotal={item.price * item.qty} line={priced} breakdown={breakdown} testId={testIds?.price} />;
  return (
    <li data-testid={testIds?.root} className="flex gap-4 sm:gap-5">
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          'relative shrink-0 overflow-hidden bg-secondary',
          dense ? 'h-[100px] w-20' : 'h-[150px] w-[120px] sm:h-[175px] sm:w-[140px]',
        )}
      >
        <Image src={item.image} alt={item.title} fill sizes={dense ? '80px' : '140px'} className="object-cover" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href={href}
              onClick={onNavigate}
              className={cn('font-semibold leading-snug hover:underline hover:underline-offset-4', dense ? 'text-[15px]' : 'text-lg')}
            >
              {item.title}
            </Link>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Size {item.size}
              {item.qty > 1 && <span>, {fmtINR(item.price)} each</span>}
            </p>
            <StockNote item={item} />
          </div>
          {dense && price}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-4">
            <QtyStepper
              value={item.qty}
              dense={dense}
              onDecrease={() => updateQty(item.productId, item.size, item.qty - 1)}
              onIncrease={() => updateQty(item.productId, item.size, item.qty + 1)}
              canIncrease={item.stock === undefined || item.qty < item.stock}
              decreaseLabel={`Decrease quantity of ${item.title}`}
              increaseLabel={`Increase quantity of ${item.title}`}
              testIds={{ decrease: testIds?.decrease, increase: testIds?.increase, value: testIds?.qty }}
            />
            <button
              type="button"
              data-testid={testIds?.remove}
              onClick={() => removeItem(item.productId, item.size)}
              aria-label={`Remove ${item.title} (${item.size})`}
              className="touch-manipulation text-sm text-muted-foreground underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
            >
              Remove
            </button>
          </div>
          {!dense && <div className="ml-auto">{price}</div>}
        </div>
      </div>
    </li>
  );
}
