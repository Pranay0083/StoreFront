'use client';

/*
 * Simulator.
 * Data: products found by search, a cart of up to 20 of each, the codes, segment, payment method and
 * moment to price at, and the engine's breakdown (lines and their discounts, stage totals, the offers
 * applied, the optimizer's search, near misses, rejected codes). Opened by the catalogue manager
 * before an offer goes live. Jobs: build a cart and price it (most frequent), compare offers.
 *
 * Question: what would this cart pay, and which offers win?
 * Finding: what the cart saves and which offer saved it, once priced.
 * Face and signature: the receipt the optimizer prints, perforated, with the saving struck in brass:
 * the shop's own paper, beside the cart that produced it.
 */

import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Empty, FieldLabel, fmtMoney, PageHeader, Pill, plural, selectClass, Thumb } from '@/components/admin/ledger';
import { Mark } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  CUSTOMER_SEGMENTS,
  PAYMENT_METHODS,
  type CustomerSegment,
  type PaymentMethod,
  type PriceBreakdown,
  type PricingStageName,
  type Product,
} from '@storefront/contracts';

interface CartLine {
  productId: string;
  title: string;
  slug: string;
  image?: string;
  size: string;
  sizes: string[];
  qty: number;
}

const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  guest: 'Guest',
  signedIn: 'Signed in',
  firstOrder: 'First order',
  returning: 'Returning customer',
};
const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  demo: 'Demo',
};
const STAGE_LABEL: Record<PricingStageName, string> = {
  markdown: 'Markdown',
  bundle: 'Bundle',
  cart: 'Cart offer',
  code: 'Code',
  shipping: 'Shipping',
};

function ReceiptRow({
  label,
  value,
  strong,
  muted,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', strong && 'text-base font-bold', muted && 'text-muted-foreground')}>
      <span className="min-w-0">{label}</span>
      <span className="flex-none tabular-nums">{value}</span>
    </div>
  );
}

/** The optimizer's receipt: the shop's paper, perforated top and bottom, the saving struck in brass. */
function Receipt({ breakdown, running, context }: { breakdown: PriceBreakdown | null; running: boolean; context: string }) {
  if (!breakdown) {
    return (
      <div className="edge-perforated bg-card px-6 py-8 text-sm text-muted-foreground" aria-busy={running}>
        <div className="flex items-center gap-2 text-foreground">
          <Mark className="h-5 w-4" />
          <span className="text-sm font-extrabold tracking-[-0.04em]">STOREFRONT</span>
        </div>
        <p className="mt-6">{running ? 'Pricing the cart…' : 'Add pieces and press Simulate; the receipt prints here.'}</p>
        <div className="mt-6 space-y-2" aria-hidden>
          {[70, 55, 62].map(w => (
            <span key={w} className="block h-2.5 bg-foreground/[0.06]" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }
  const shippingCharged = breakdown.shipping - breakdown.shippingDiscount;
  const stages: Array<[string, number]> = (
    [
      ['Markdowns', breakdown.markdownTotal],
      ['Bundle offers', breakdown.bundleDiscount],
      ['Cart offers', breakdown.cartDiscount],
      ['Promo codes', breakdown.codeDiscount],
    ] as Array<[string, number]>
  ).filter(([, v]) => v > 0);

  return (
    <div
      className={cn('edge-perforated bg-card px-6 py-8 text-sm', running && 'opacity-60')}
      data-testid="simulator-receipt"
      aria-busy={running}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Mark className="h-5 w-4" />
          <span className="text-sm font-extrabold tracking-[-0.04em]">STOREFRONT</span>
        </span>
        <span className="text-xs text-muted-foreground">Simulated</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{context}</p>

      <ul className="mt-5 space-y-3 border-t border-dashed border-foreground/25 pt-4">
        {breakdown.lines.map((l, i) => (
          <li key={`${l.productId}:${l.size}:${i}`}>
            <ReceiptRow
              label={
                <>
                  {l.title}{' '}
                  <span className="text-muted-foreground">
                    · {l.size} × {l.qty}
                  </span>
                </>
              }
              value={
                l.lineTotal === l.lineSubtotal ? (
                  fmtMoney(l.lineTotal)
                ) : (
                  <span className="text-muted-foreground line-through">{fmtMoney(l.lineSubtotal)}</span>
                )
              }
            />
            {l.lineTotal !== l.lineSubtotal && (
              <ReceiptRow label={<span className="text-muted-foreground">after offers</span>} value={fmtMoney(l.lineTotal)} />
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-1.5 border-t border-dashed border-foreground/25 pt-4">
        <ReceiptRow label="List subtotal" value={fmtMoney(breakdown.listSubtotal)} />
        {stages.map(([label, v]) => (
          <ReceiptRow key={label} label={label} value={`−${fmtMoney(v)}`} />
        ))}
        <ReceiptRow label="Shipping" value={shippingCharged === 0 ? 'Free' : fmtMoney(shippingCharged)} />
      </div>
      <div className="mt-4 space-y-2 border-t border-dashed border-foreground/25 pt-4">
        <ReceiptRow label="Total" value={fmtMoney(breakdown.total)} strong />
        {breakdown.totalSavings > 0 && (
          <ReceiptRow
            label={<span className="highlight font-semibold">You save</span>}
            value={<span className="highlight font-semibold">{fmtMoney(breakdown.totalSavings)}</span>}
          />
        )}
      </div>
    </div>
  );
}

export default function PromotionSimulatorPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [codes, setCodes] = useState('');
  const [segment, setSegment] = useState<CustomerSegment>('signedIn');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [at, setAt] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [breakdown, setBreakdown] = useState<PriceBreakdown | null>(null);
  const [running, setRunning] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    try {
      const res = await api<{ items: Product[] }>(`/products?limit=8${query ? `&q=${encodeURIComponent(query)}` : ''}`);
      setResults(res.items);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const add = (p: Product) =>
    setLines(prev => {
      const size = p.sizes.find(s => s.stock > 0)?.size ?? p.sizes[0]?.size;
      const existing = prev.find(l => l.productId === p._id && l.size === size);
      if (existing) return prev.map(l => (l === existing ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
      return [
        ...prev,
        { productId: p._id, title: p.title, slug: p.slug, image: p.images[0], size, sizes: p.sizes.map(s => s.size), qty: 1 },
      ];
    });

  const update = (i: number, patch: Partial<CartLine>) => setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const simulate = async () => {
    if (!lines.length) return toast.error('Add at least one product');
    setRunning(true);
    try {
      const body = {
        items: lines.map(l => ({ productId: l.productId, size: l.size, qty: l.qty })),
        codes: codes
          .split(',')
          .map(c => c.trim())
          .filter(Boolean),
        segment,
        includeDrafts,
        ...(paymentMethod && { paymentMethod }),
        ...(at && { at: new Date(at).toISOString() }),
      };
      setBreakdown(await api<PriceBreakdown>('/admin/promotions/simulate', { method: 'POST', body: JSON.stringify(body) }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const pieces = lines.reduce((s, l) => s + l.qty, 0);
  const context = [
    SEGMENT_LABEL[segment],
    paymentMethod ? PAYMENT_LABEL[paymentMethod] : 'any payment',
    at ? new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'now',
    includeDrafts ? 'drafts included' : 'live offers only',
  ].join(' · ');

  const top = breakdown ? [...breakdown.applied].sort((a, b) => b.amount - a.amount)[0] : null;
  const finding = breakdown
    ? breakdown.totalSavings > 0
      ? `This cart saves ${fmtMoney(breakdown.totalSavings)} on ${fmtMoney(breakdown.listSubtotal)}${top ? `, most of it from ${top.name}` : ''}.`
      : 'No offer applies to this cart; it pays list price.'
    : 'Price any cart against the live offers, and drafts if you include them.';

  return (
    <div data-testid="promotion-simulator">
      <PageHeader
        crumb={
          <>
            <Link href="/admin/promotions" className="text-muted-foreground hover:text-foreground">
              Promotions
            </Link>
            <span className="text-muted-foreground" aria-hidden>
              /
            </span>
          </>
        }
        title="Simulator"
        finding={finding}
      />

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <section className="border border-border bg-card p-5">
            <h2 className="text-base font-semibold">Add pieces</h2>
            <form onSubmit={search} className="mt-3 flex gap-2">
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products to add" className="h-9" />
              <Button type="submit" size="sm" variant="outline" className="h-9" disabled={searching}>
                <Search /> Search
              </Button>
            </form>
            {results && results.length === 0 && <Empty className="mt-3">Nothing in the catalogue matches “{query}”.</Empty>}
            {results && results.length > 0 && (
              <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
                {results.map(p => (
                  <li key={p._id} className="flex items-center gap-3 border-b border-border/70 py-2">
                    <Thumb src={p.images[0]} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-medium">{p.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{fmtMoney(p.price)}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 px-3" onClick={() => add(p)} aria-label={`Add ${p.title}`}>
                      <Plus /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border bg-card">
            <header className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-base font-semibold">Cart</h2>
              <span className="text-[13px] text-muted-foreground">{plural(pieces, 'piece')}</span>
            </header>
            {lines.length === 0 ? (
              <div className="p-5 pt-3">
                <Empty>The cart is empty. Search above and add pieces.</Empty>
              </div>
            ) : (
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Piece</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="pr-5">
                      <span className="sr-only">Remove</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={`${l.productId}:${i}`}>
                      <TableCell className="w-full max-w-0 pl-5 sm:max-w-none">
                        <span className="flex items-center gap-3">
                          <Thumb src={l.image} className="h-8 w-6" />
                          <span className="truncate">{l.title}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <select
                          value={l.size}
                          onChange={e => update(i, { size: e.target.value })}
                          className={cn(selectClass, 'h-8 w-auto min-w-[72px]')}
                          aria-label={`Size of ${l.title}`}
                        >
                          {l.sizes.map(s => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => update(i, { qty: Math.max(1, l.qty - 1) })}
                            aria-label="Decrease"
                          >
                            <Minus />
                          </Button>
                          <span className="w-6 text-center tabular-nums">{l.qty}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => update(i, { qty: Math.min(20, l.qty + 1) })}
                            aria-label="Increase"
                          >
                            <Plus />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}
                          aria-label="Remove"
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="border border-border bg-card p-5">
            <h2 className="text-base font-semibold">Who is buying, and when</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Promo codes" hint="Comma-separated, up to three">
                <Input value={codes} onChange={e => setCodes(e.target.value.toUpperCase())} className="h-9 uppercase" />
              </FieldLabel>
              <FieldLabel label="Customer" hint="Which segment the buyer is in">
                <select value={segment} onChange={e => setSegment(e.target.value as CustomerSegment)} className={selectClass}>
                  {CUSTOMER_SEGMENTS.map(s => (
                    <option key={s} value={s}>
                      {SEGMENT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Payment method">
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value as PaymentMethod | '')}
                  className={selectClass}
                >
                  <option value="">Not chosen yet</option>
                  {PAYMENT_METHODS.map(m => (
                    <option key={m} value={m}>
                      {PAYMENT_LABEL[m]}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Price at" hint="Leave empty for now">
                <Input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className="h-9" />
              </FieldLabel>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-foreground"
                  checked={includeDrafts}
                  onChange={e => setIncludeDrafts(e.target.checked)}
                />
                Include draft promotions
              </label>
              <Button size="sm" onClick={simulate} disabled={running} data-testid="simulate-run">
                {running ? 'Pricing…' : 'Simulate'}
              </Button>
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <Receipt breakdown={breakdown} running={running} context={context} />

          {breakdown && (
            <>
              <section className="border border-border bg-card p-5 text-sm" data-testid="simulator-applied">
                <h2 className="text-base font-semibold">Offers applied</h2>
                {breakdown.applied.length === 0 ? (
                  <p className="mt-2 text-muted-foreground">None qualify for this cart.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border/70">
                    {breakdown.applied.map(a => (
                      <li key={a.promotionId} className="flex items-baseline justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="font-medium">{a.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {STAGE_LABEL[a.stage]} · version {a.version}
                            {a.times > 1 ? ` · applied ${a.times} times` : ''}
                          </span>
                        </span>
                        <span className="flex-none tabular-nums">−{fmtMoney(a.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {breakdown.rejectedCodes.map(r => (
                  <p key={r.code} className="mt-2 flex items-baseline gap-2 text-[13px]">
                    <Pill tone="negative">{r.code}</Pill> {r.reason}
                  </p>
                ))}
              </section>

              <section className="border border-border bg-card p-5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">How the optimizer chose</h2>
                  <Pill tone={breakdown.optimizer.strategy === 'branch-and-bound' ? 'neutral' : 'warning'}>
                    {breakdown.optimizer.strategy === 'branch-and-bound' ? 'Exact search' : 'Greedy fallback'}
                  </Pill>
                </div>
                <p className="mt-2 text-muted-foreground">
                  Searched {plural(breakdown.optimizer.nodesExplored, 'combination')}. Bundles save{' '}
                  {fmtMoney(breakdown.optimizer.bundleSavings)} against {fmtMoney(breakdown.optimizer.greedySavings)} for a greedy pick
                  {breakdown.optimizer.bundleSavings > breakdown.optimizer.greedySavings
                    ? `, ${fmtMoney(breakdown.optimizer.bundleSavings - breakdown.optimizer.greedySavings)} better.`
                    : '.'}
                </p>
                {breakdown.explanations.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[13px] text-muted-foreground">
                    {breakdown.explanations.map(e => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </section>

              {breakdown.suggestions.length > 0 && (
                <section className="border border-border bg-card p-5 text-sm">
                  <h2 className="text-base font-semibold">One step from a better price</h2>
                  <ul className="mt-2 divide-y divide-border/70">
                    {breakdown.suggestions.map(s => (
                      <li key={s.message} className="py-2">
                        <p>{s.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Adds {fmtMoney(s.addedCost)}, saves {fmtMoney(s.extraSavings)} more
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
