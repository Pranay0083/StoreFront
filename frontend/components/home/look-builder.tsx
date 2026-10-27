'use client';

import { Check } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';
import { usePriceQuote } from '@/lib/use-price-quote';
import { cn } from '@/lib/utils';
import type { CartLine, PriceBreakdown, PriceQuote } from '@storefront/contracts';

export interface LookPiece {
  id: string;
  slug: string;
  title: string;
  price: number;
  image: string;
  /** The first size in stock; every piece goes into the look in that size, one of each. */
  size: string;
  stock: number;
}

const NO_CODES: string[] = [];

/**
 * The live thing: tap real pieces and a receipt prints beside them, priced by the same
 * optimizer that prices the bag, with the bundles it chose and the money it saved.
 */
export function LookBuilder({
  pieces,
  initialSelected,
  initialQuote,
}: {
  pieces: LookPiece[];
  initialSelected: string[];
  initialQuote: PriceQuote | null;
}) {
  const { addItem } = useCart();
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const chosen = useMemo(() => pieces.filter(p => selected.includes(p.id)), [pieces, selected]);
  const lines = useMemo<CartLine[]>(() => chosen.map(p => ({ productId: p.id, size: p.size, qty: 1 })), [chosen]);
  const { quote, loading, error } = usePriceQuote(lines, NO_CODES);

  // Until the first live quote lands, the receipt printed on the server stands in.
  const breakdown: PriceBreakdown | null = chosen.length ? ((quote ?? initialQuote)?.breakdown ?? null) : null;

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const addAll = () => {
    for (const p of chosen) {
      addItem({ productId: p.id, title: p.title, image: p.image, price: p.price, size: p.size, qty: 1, slug: p.slug, stock: p.stock });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8">
      <div className="min-w-0 lg:col-span-7">
        <ul
          aria-label="Pieces"
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-x-4 sm:gap-y-8 sm:overflow-visible sm:px-0 sm:pb-0"
        >
          {pieces.map(p => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id} className="w-[40vw] shrink-0 snap-start sm:w-auto">
                <button
                  type="button"
                  aria-pressed={on}
                  data-testid={`look-piece-${p.slug}`}
                  onClick={() => toggle(p.id)}
                  className="group block w-full text-left transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  <span className="relative block aspect-[3/4] overflow-hidden bg-secondary">
                    <Image
                      src={p.image}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 40vw, (max-width: 1024px) 25vw, 15vw"
                      className={cn(
                        'object-cover transition-[opacity,transform] duration-200 ease-out group-hover:scale-[1.03]',
                        on ? 'opacity-100' : 'opacity-50',
                      )}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        'absolute right-2 top-2 flex h-8 w-8 items-center justify-center bg-card text-foreground transition-[opacity,transform] duration-150 ease-out',
                        on ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
                      )}
                    >
                      <Check className="h-4 w-4" strokeWidth={2.5} />
                    </span>
                  </span>
                  <span className="mt-2.5 block text-[15px] font-semibold leading-snug">{p.title}</span>
                  <span className="block text-[15px] tabular-nums text-primary-foreground/75">{fmtINR(p.price)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <noscript>
          <p className="mt-6 text-lg">
            <Link href="/products" className="underline underline-offset-4">
              Browse every piece in the catalogue
            </Link>
          </p>
        </noscript>
      </div>

      <div className="min-w-0 lg:col-span-5">
        <Receipt
          count={chosen.length}
          breakdown={breakdown}
          loading={loading}
          error={error}
          sizes={new Map(chosen.map(p => [p.id, p.size]))}
          onAddAll={addAll}
        />
      </div>
    </div>
  );
}

function Line({ label, note, value, className }: { label: React.ReactNode; note?: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-6', className)}>
      <span>
        {label}
        {note && <span className="block text-sm text-muted-foreground">{note}</span>}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

function Receipt({
  count,
  breakdown,
  loading,
  error,
  sizes,
  onAddAll,
}: {
  count: number;
  breakdown: PriceBreakdown | null;
  loading: boolean;
  error: string | null;
  sizes: Map<string, string>;
  onAddAll: () => void;
}) {
  // A new set of lines prints in again; the same lines re-quoted stay put.
  const printKey = breakdown ? `${breakdown.lines.map(l => l.productId).join()}:${breakdown.total}` : 'empty';
  const shipping = breakdown ? breakdown.shipping - breakdown.shippingDiscount : 0;

  return (
    <div
      data-testid="look-receipt"
      className="edge-perforated bg-card px-6 pb-10 pt-11 text-card-foreground sm:px-8 [&_:focus-visible]:outline-foreground"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xl font-extrabold tracking-[-0.04em]">STOREFRONT</p>
        <p className="text-sm text-muted-foreground">
          {count} piece{count === 1 ? '' : 's'}
        </p>
      </div>

      {!breakdown ? (
        <p className="mt-8 min-h-40 text-base text-muted-foreground">
          {count === 0 ? 'Tap a piece to start the receipt.' : (error ?? 'Pricing your look…')}
        </p>
      ) : (
        <div
          key={printKey}
          aria-live="polite"
          aria-busy={loading}
          className={cn('mt-8 text-base transition-opacity duration-200', loading && 'opacity-60')}
        >
          <ul className="space-y-2.5">
            {breakdown.lines.map((l, i) => (
              <li key={l.productId} className="animate-print" style={{ animationDelay: `${i * 40}ms` }}>
                <Line label={l.title} note={`Size ${sizes.get(l.productId) ?? l.size}`} value={fmtINR(l.lineSubtotal)} />
              </li>
            ))}
          </ul>

          {breakdown.applied.length > 0 && (
            <ul className="mt-7 space-y-2.5" aria-label="Offers the optimizer applied">
              {breakdown.applied.map((a, i) => (
                <li key={a.promotionId} className="animate-print" style={{ animationDelay: `${(breakdown.lines.length + i) * 40}ms` }}>
                  <Line label={<span className="font-semibold">{a.name}</span>} note={a.description} value={`−${fmtINR(a.amount)}`} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-7 space-y-1.5">
            {breakdown.markdownTotal > 0 && <Line label="Sale prices" value={`−${fmtINR(breakdown.markdownTotal)}`} />}
            <Line label="Shipping" value={shipping === 0 ? 'Free' : fmtINR(shipping)} />
          </div>

          <div className="mt-6 flex items-end justify-between gap-6">
            <span className="text-lg font-semibold">Total</span>
            <span data-testid="look-total" className="text-display-md font-extrabold tabular-nums">
              {fmtINR(breakdown.total)}
            </span>
          </div>
          {breakdown.totalSavings > 0 && (
            <p className="mt-3 text-right text-xl font-bold">
              You save <span className="highlight px-1 tabular-nums">{fmtINR(breakdown.totalSavings)}</span>
            </p>
          )}
        </div>
      )}

      <Button size="lg" className="mt-8 w-full" data-testid="look-add-all" disabled={!breakdown || count === 0} onClick={onAddAll}>
        Add all to bag
      </Button>
      <p className="mt-4 text-sm text-muted-foreground">Each piece goes in at its first size in stock. Change sizes in your bag.</p>
    </div>
  );
}
