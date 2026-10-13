'use client';

import { Sparkles, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PriceBreakdown as Breakdown, PricingSuggestion, Product } from '@storefront/contracts';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, fmtINR } from '@/lib/api';

function Row({ label, value, tone, testId }: { label: string; value: string; tone?: 'savings' | 'strong'; testId?: string }) {
  return (
    <div
      className={`flex justify-between ${tone === 'savings' ? 'text-emerald-800' : ''} ${tone === 'strong' ? 'text-base font-semibold' : ''}`}
    >
      <span>{label}</span>
      <span data-testid={testId}>{value}</span>
    </div>
  );
}

/** Stage-by-stage totals for a server price quote. */
export function PriceSummary({ breakdown, loading }: { breakdown: Breakdown | null; loading?: boolean }) {
  if (!breakdown) {
    return <p className="text-sm text-muted-foreground">{loading ? 'Calculating the best price…' : 'Add items to see your total.'}</p>;
  }
  const shippingCharged = breakdown.shipping - breakdown.shippingDiscount;
  return (
    <div className={`space-y-3 text-sm transition-opacity ${loading ? 'opacity-60' : ''}`} data-testid="price-summary">
      <Row label="Subtotal" value={fmtINR(breakdown.listSubtotal)} testId="summary-subtotal" />
      {breakdown.markdownTotal > 0 && <Row label="Sale prices" value={`−${fmtINR(breakdown.markdownTotal)}`} tone="savings" />}
      {breakdown.bundleDiscount > 0 && <Row label="Bundle offers" value={`−${fmtINR(breakdown.bundleDiscount)}`} tone="savings" />}
      {breakdown.cartDiscount > 0 && <Row label="Order offers" value={`−${fmtINR(breakdown.cartDiscount)}`} tone="savings" />}
      {breakdown.codeDiscount > 0 && (
        <Row label="Promo codes" value={`−${fmtINR(breakdown.codeDiscount)}`} tone="savings" testId="checkout-discount" />
      )}
      <Row label="Shipping" value={shippingCharged === 0 ? 'Free' : fmtINR(shippingCharged)} />
      <div className="border-t border-black/10 pt-3">
        <Row label="Total" value={fmtINR(breakdown.total)} tone="strong" testId="summary-total" />
        {breakdown.totalSavings > 0 && (
          <p className="mt-1 text-right text-xs text-emerald-800" data-testid="summary-savings">
            You save {fmtINR(breakdown.totalSavings)}
          </p>
        )}
      </div>
    </div>
  );
}

/** Applied promotions, why they were chosen, and offers the customer is close to unlocking. */
export function AppliedOffers({ breakdown }: { breakdown: Breakdown }) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState<string | null>(null);

  const addSuggested = async (s: PricingSuggestion) => {
    if (!s.slug || !s.size) return;
    setAdding(s.message);
    try {
      const product = await api<Product>(`/products/${s.slug}`);
      addItem({
        productId: product._id,
        size: s.size,
        qty: s.qty ?? 1,
        title: product.title,
        image: product.images[0],
        price: product.price,
        slug: product.slug,
        stock: product.sizes.find(v => v.size === s.size)?.stock,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add that item');
    } finally {
      setAdding(null);
    }
  };

  if (!breakdown.applied.length && !breakdown.suggestions.length) return null;
  return (
    <div className="space-y-4" data-testid="applied-offers">
      {breakdown.applied.length > 0 && (
        <ul className="space-y-2">
          {breakdown.applied.map(a => (
            <li key={a.promotionId} className="flex items-start justify-between gap-3 text-sm">
              <span className="flex items-start gap-2">
                <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-800" />
                <span>
                  <span className="font-medium">{a.name}</span>
                  {a.code && <span className="ml-1 text-xs text-muted-foreground">({a.code})</span>}
                  <span className="block text-xs text-muted-foreground">{a.description}</span>
                </span>
              </span>
              <span className="shrink-0 text-emerald-800">−{fmtINR(a.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {breakdown.explanations.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Why this price?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {breakdown.explanations.map(e => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {breakdown.suggestions.map(s => (
        <div key={s.message} className="flex items-center justify-between gap-3 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {s.message}
          </span>
          {s.kind === 'add-item' && s.slug && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={adding === s.message}
              onClick={() => addSuggested(s)}
            >
              Add
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Promo code entry; codes are validated by the next quote, which reports rejections. */
export function PromoCodes({
  codes,
  onChange,
  breakdown,
}: {
  codes: string[];
  onChange: (codes: string[]) => void;
  breakdown: Breakdown | null;
}) {
  const [input, setInput] = useState('');
  const rejected = new Map((breakdown?.rejectedCodes ?? []).map(r => [r.code, r.reason]));

  const add = () => {
    const code = input.trim().toUpperCase();
    if (!code) return;
    if (!codes.includes(code)) onChange([...codes, code].slice(-3));
    setInput('');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          data-testid="coupon-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Promo code (try WELCOME10)"
          className="h-10 flex-1"
        />
        <Button data-testid="coupon-apply-button" variant="outline" className="h-10 px-4" onClick={add} disabled={!input.trim()}>
          Apply
        </Button>
      </div>
      {codes.map(code => (
        <div key={code} className="flex items-center justify-between text-sm" data-testid={`promo-code-${code}`}>
          <span className={rejected.has(code) ? 'text-destructive' : 'font-medium text-emerald-800'}>
            {code} {rejected.has(code) ? `— ${rejected.get(code)}` : 'applied'}
          </span>
          <button
            aria-label={`Remove ${code}`}
            onClick={() => onChange(codes.filter(c => c !== code))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
