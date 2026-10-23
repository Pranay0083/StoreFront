'use client';

import { Sparkles, Tag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { PriceBreakdown as Breakdown, PricedLine, PricingSuggestion, Product } from '@storefront/contracts';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, fmtINR } from '@/lib/api';
import { useExperiment } from '@/lib/experiments';

/** A/B test: do near-miss "add one more" nudges lift paid conversion? Variants: shown (control) / hidden. */
export const NEAR_MISS_EXPERIMENT = 'checkout-near-miss';

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

/** Per-line price after offers: the list total struck through, the allocated total, and which offers paid for it. */
export function LinePrice({
  listTotal,
  line,
  breakdown,
  testId,
}: {
  listTotal: number;
  line?: PricedLine;
  breakdown?: Breakdown | null;
  testId?: string;
}) {
  if (!line || line.lineTotal === listTotal) {
    return (
      <p className="text-right text-sm font-medium" data-testid={testId}>
        {fmtINR(listTotal)}
      </p>
    );
  }
  const names = new Map((breakdown?.applied ?? []).map(a => [a.promotionId, a.name]));
  return (
    <div className="text-right text-sm" data-testid={testId}>
      <p className="text-xs text-muted-foreground line-through">
        <span className="sr-only">Was </span>
        {fmtINR(listTotal)}
      </p>
      <p className="font-medium">{fmtINR(line.lineTotal)}</p>
      {line.discounts.length > 0 && (
        <ul className="mt-0.5 text-[11px] text-emerald-800">
          {line.discounts.map(d => (
            <li key={d.promotionId}>
              {names.get(d.promotionId) ?? 'Offer'} −{fmtINR(d.amount)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const lineKey = (l: { productId: string; size: string }) => `${l.productId}::${l.size}`;

/** Stage-by-stage totals for a server price quote. */
export function PriceSummary({ breakdown, loading }: { breakdown: Breakdown | null; loading?: boolean }) {
  if (!breakdown) {
    return <p className="text-sm text-muted-foreground">{loading ? 'Calculating the best price…' : 'Add items to see your total.'}</p>;
  }
  const shippingCharged = breakdown.shipping - breakdown.shippingDiscount;
  return (
    <div
      className={`space-y-3 text-sm transition-opacity ${loading ? 'opacity-60' : ''}`}
      data-testid="price-summary"
      aria-busy={loading}
      aria-live="polite"
    >
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
  const { variant, expose } = useExperiment(NEAR_MISS_EXPERIMENT);
  const hasSuggestions = breakdown.suggestions.length > 0;
  useEffect(() => {
    if (hasSuggestions) expose();
  }, [hasSuggestions, expose]);
  const suggestions = variant === 'hidden' ? [] : breakdown.suggestions;

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

  if (!breakdown.applied.length && !suggestions.length) return null;
  return (
    <div className="space-y-4" data-testid="applied-offers">
      {breakdown.applied.length > 0 && (
        <ul className="space-y-2">
          {breakdown.applied.map(a => (
            <li
              key={a.promotionId}
              className="flex items-start justify-between gap-3 text-sm"
              data-testid={`applied-offer-${a.promotionId}`}
            >
              <span className="flex items-start gap-2">
                <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-800" aria-hidden />
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
      {suggestions.map(s => (
        <div
          key={s.message}
          data-testid="near-miss-suggestion"
          className="flex items-center justify-between gap-3 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <span className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
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
        <label htmlFor="promo-code" className="sr-only">
          Promo code
        </label>
        <Input
          id="promo-code"
          data-testid="promo-code-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Promo code (try WELCOME10)"
          className="h-10 flex-1"
        />
        <Button data-testid="promo-code-apply-button" variant="outline" className="h-10 px-4" onClick={add} disabled={!input.trim()}>
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
