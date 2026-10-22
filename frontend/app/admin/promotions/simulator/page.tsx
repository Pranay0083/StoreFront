'use client';

import { ArrowLeft, Minus, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PriceSummary } from '@/components/price-breakdown';
import { Field } from '@/components/promotion-rule-builder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtINR } from '@/lib/api';
import {
  CUSTOMER_SEGMENTS,
  PAYMENT_METHODS,
  type CustomerSegment,
  type PaymentMethod,
  type PriceBreakdown,
  type Product,
} from '@storefront/contracts';

interface CartLine {
  productId: string;
  title: string;
  slug: string;
  size: string;
  sizes: string[];
  qty: number;
}

export default function PromotionSimulatorPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
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
    const res = await api<{ items: Product[] }>(`/products?limit=8${query ? `&q=${encodeURIComponent(query)}` : ''}`);
    setResults(res.items);
  };

  const add = (p: Product) =>
    setLines(prev => {
      const size = p.sizes.find(s => s.stock > 0)?.size ?? p.sizes[0]?.size;
      const existing = prev.find(l => l.productId === p._id && l.size === size);
      if (existing) return prev.map(l => (l === existing ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
      return [...prev, { productId: p._id, title: p.title, slug: p.slug, size, sizes: p.sizes.map(s => s.size), qty: 1 }];
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

  return (
    <div data-testid="promotion-simulator">
      <Link href="/admin/promotions" className="label-caps flex items-center gap-1 text-muted-foreground hover:underline">
        <ArrowLeft className="h-3 w-3" /> Promotions
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Promotion simulator</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Build a cart, pick who is buying and when, and see exactly what the engine would charge, which offers win, and what the customer is
        one item away from unlocking. Drafts can be included to test rules before they go live.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="border border-black/10 bg-white p-4">
            <form onSubmit={search} className="flex gap-2">
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products to add" className="h-9" />
              <Button type="submit" size="sm" variant="outline">
                <Search className="mr-1 h-4 w-4" /> Search
              </Button>
            </form>
            {results.length > 0 && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {results.map(p => (
                  <li key={p._id} className="flex items-center justify-between gap-2 border border-black/10 px-3 py-2 text-sm">
                    <span>
                      {p.title} <span className="text-xs text-muted-foreground">{fmtINR(p.price)}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => add(p)} aria-label={`Add ${p.title}`}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-black/10 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cart</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      Search and add products to build a cart.
                    </TableCell>
                  </TableRow>
                )}
                {lines.map((l, i) => (
                  <TableRow key={`${l.productId}:${i}`}>
                    <TableCell className="text-sm">{l.title}</TableCell>
                    <TableCell>
                      <select
                        value={l.size}
                        onChange={e => update(i, { size: e.target.value })}
                        className="h-8 border border-black/15 bg-white px-1 text-sm"
                      >
                        {l.sizes.map(s => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => update(i, { qty: Math.max(1, l.qty - 1) })} aria-label="Decrease">
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center tabular-nums">{l.qty}</span>
                        <Button size="sm" variant="ghost" onClick={() => update(i, { qty: Math.min(20, l.qty + 1) })} aria-label="Increase">
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section className="grid gap-3 border border-black/10 bg-white p-4 sm:grid-cols-2">
            <Field label="Promo codes (comma-separated)">
              <Input value={codes} onChange={e => setCodes(e.target.value.toUpperCase())} className="mt-1 h-9 font-mono" />
            </Field>
            <Field label="Customer segment">
              <select
                value={segment}
                onChange={e => setSegment(e.target.value as CustomerSegment)}
                className="mt-1 h-9 w-full border border-black/15 bg-white px-2 text-sm"
              >
                {CUSTOMER_SEGMENTS.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Payment method">
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value as PaymentMethod | '')}
                className="mt-1 h-9 w-full border border-black/15 bg-white px-2 text-sm"
              >
                <option value="">Not chosen yet</option>
                {PAYMENT_METHODS.map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Simulate at (defaults to now)">
              <Input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} className="mt-1 h-9" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)} />
              Include draft promotions
            </label>
            <div className="flex justify-end">
              <Button onClick={simulate} disabled={running} data-testid="simulate-run">
                {running ? 'Pricing…' : 'Simulate'}
              </Button>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <div className="border border-black/10 bg-white p-4">
            <h2 className="label-caps mb-3 text-muted-foreground">Price</h2>
            <PriceSummary breakdown={breakdown} loading={running} />
          </div>
          {breakdown && (
            <>
              <div className="border border-black/10 bg-white p-4 text-sm" data-testid="simulator-applied">
                <h2 className="label-caps mb-2 text-muted-foreground">Applied promotions</h2>
                {breakdown.applied.length === 0 && <p className="text-muted-foreground">None qualify.</p>}
                <ul className="space-y-2">
                  {breakdown.applied.map(a => (
                    <li key={a.promotionId} className="flex justify-between gap-2">
                      <span>
                        {a.name}{' '}
                        <span className="text-xs text-muted-foreground">
                          v{a.version} · {a.stage}
                          {a.times > 1 ? ` · ×${a.times}` : ''}
                        </span>
                      </span>
                      <span className="text-emerald-800">−{fmtINR(a.amount)}</span>
                    </li>
                  ))}
                </ul>
                {breakdown.rejectedCodes.map(r => (
                  <p key={r.code} className="mt-2 text-xs text-red-800">
                    {r.code}: {r.reason}
                  </p>
                ))}
              </div>
              <div className="border border-black/10 bg-white p-4 text-sm">
                <h2 className="label-caps mb-2 text-muted-foreground">Optimizer</h2>
                <p>
                  <Badge variant={breakdown.optimizer.strategy === 'branch-and-bound' ? 'success' : 'warning'}>
                    {breakdown.optimizer.strategy}
                  </Badge>{' '}
                  {breakdown.optimizer.nodesExplored.toLocaleString()} nodes explored
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bundle savings {fmtINR(breakdown.optimizer.bundleSavings)} vs greedy {fmtINR(breakdown.optimizer.greedySavings)}
                  {breakdown.optimizer.bundleSavings > breakdown.optimizer.greedySavings &&
                    `: ${fmtINR(breakdown.optimizer.bundleSavings - breakdown.optimizer.greedySavings)} better than greedy`}
                </p>
                {breakdown.explanations.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {breakdown.explanations.map(e => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
              {breakdown.suggestions.length > 0 && (
                <div className="border border-black/10 bg-white p-4 text-sm">
                  <h2 className="label-caps mb-2 text-muted-foreground">Near-miss suggestions</h2>
                  <ul className="space-y-2 text-xs">
                    {breakdown.suggestions.map(s => (
                      <li key={s.message} className="bg-amber-50 px-3 py-2 text-amber-900">
                        {s.message}{' '}
                        <span className="text-amber-800/70">
                          (adds {fmtINR(s.addedCost)}, saves {fmtINR(s.extraSavings)} more)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="border border-black/10 bg-white p-4">
                <h2 className="label-caps mb-2 text-muted-foreground">Per-line allocation</h2>
                <ul className="space-y-1 text-xs">
                  {breakdown.lines.map((l, i) => (
                    <li key={`${l.productId}:${l.size}:${i}`} className="flex justify-between gap-2">
                      <span>
                        {l.title} ({l.size}) × {l.qty}
                      </span>
                      <span className="tabular-nums">
                        {fmtINR(l.lineSubtotal)} → <span className="font-medium">{fmtINR(l.lineTotal)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
