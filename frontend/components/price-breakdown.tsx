'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type {
  AppliedPromotion,
  PriceBreakdown as Breakdown,
  PricedLine,
  PricingStageName,
  PricingSuggestion,
  Product,
} from '@storefront/contracts';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage, fmtINR } from '@/lib/api';
import { useExperiment } from '@/lib/experiments';
import { cn } from '@/lib/utils';

/*
 * The receipt: the shop's paper. Every price the optimizer computes is set here as till lines in the
 * one sans face, in proportional figures on a single right edge, the offers it chose grouped and named,
 * the total as the largest figure, and the money saved struck once with the brass highlighter.
 */

/** A/B test: do near-miss "add one more" nudges lift paid conversion? Variants: shown (control) / hidden. */
export const NEAR_MISS_EXPERIMENT = 'checkout-near-miss';

export const lineKey = (l: { productId: string; size: string }) => `${l.productId}::${l.size}`;

/** Discount stages in the order the engine applies them, as the receipt names them. */
const STAGES: Array<{ stage: PricingStageName; label: string; amount: (b: Breakdown) => number }> = [
  { stage: 'markdown', label: 'Sale prices', amount: b => b.markdownTotal },
  { stage: 'bundle', label: 'Bundle offers', amount: b => b.bundleDiscount },
  { stage: 'cart', label: 'Order offers', amount: b => b.cartDiscount },
  { stage: 'code', label: 'Promo codes', amount: b => b.codeDiscount },
];

/** Lines print in one after another, 30ms apart, and only lines whose figure changed print again. */
const printDelay = (index: number) => ({ animationDelay: `${Math.min(index, 8) * 30}ms` });

export interface SummaryTestIds {
  root?: string;
  subtotal?: string;
  total?: string;
  savings?: string;
  /** The promo-code stage's amount. */
  codeDiscount?: string;
  /** Wraps every discount group. */
  discounts?: string;
  /** Wraps the named offers. */
  offers?: string;
}

const DEFAULT_TEST_IDS: SummaryTestIds = {
  root: 'price-summary',
  subtotal: 'summary-subtotal',
  total: 'summary-total',
  savings: 'summary-savings',
  codeDiscount: 'checkout-discount',
};

function Row({
  label,
  value,
  testId,
  index,
  className,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  testId?: string;
  index: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('animate-print', className)} style={printDelay(index)}>
      <div className="flex items-baseline justify-between gap-6">
        <span>{label}</span>
        <span className="shrink-0" data-testid={testId}>
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

/** The final layout with grey bars where the figures will land, so nothing moves when they do. */
function SummarySkeleton({ compact }: { compact?: boolean }) {
  const bar = 'inline-block h-4 bg-foreground/[0.08] align-middle';
  return (
    <div aria-busy="true" aria-label="Pricing your bag" className="text-[15px]">
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {['Subtotal', 'Offers', 'Shipping'].map((label, i) => (
          <div key={label} className="flex items-baseline justify-between gap-6">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn(bar, i === 1 ? 'w-14' : 'w-20')} />
          </div>
        ))}
      </div>
      <div className={cn('flex items-baseline justify-between', compact ? 'mt-4' : 'mt-7')}>
        <span className="text-lg font-bold">Total</span>
        <span className={cn('inline-block bg-foreground/[0.08]', compact ? 'h-7 w-28' : 'h-10 w-36')} />
      </div>
    </div>
  );
}

/**
 * The receipt's figures: subtotal, each discount stage with the offers that make it up, shipping, the
 * total and the saving. Works on its own (the back office's simulator) or inside `PriceBreakdown`.
 */
export function PriceSummary({
  breakdown,
  loading,
  error,
  onRetry,
  compact = false,
  testIds,
  children,
}: {
  breakdown: Breakdown | null;
  loading?: boolean;
  /** Why the last quote failed. */
  error?: string | null;
  onRetry?: () => void;
  /** Smaller total and no offer descriptions, for the cart drawer. */
  compact?: boolean;
  testIds?: SummaryTestIds;
  /** Extra lines after the saving, such as a refund. */
  children?: ReactNode;
}) {
  const ids = { ...DEFAULT_TEST_IDS, ...testIds };

  if (!breakdown) {
    if (error) {
      return (
        <div role="alert" className="text-[15px]">
          <p className="font-medium">We couldn’t price your bag.</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-3 font-medium underline underline-offset-4">
              Try again
            </button>
          )}
        </div>
      );
    }
    if (loading) return <SummarySkeleton compact={compact} />;
    return <p className="text-[15px] text-muted-foreground">Add a piece to see your total.</p>;
  }

  const groups = STAGES.map(s => ({
    ...s,
    total: s.amount(breakdown),
    promos: breakdown.applied.filter(a => a.stage === s.stage),
  })).filter(g => g.total > 0);
  const shippingCharged = breakdown.shipping - breakdown.shippingDiscount;
  const shippingOffers = breakdown.applied.filter(a => a.stage === 'shipping');
  let index = 0;

  return (
    <div data-testid={ids.root} aria-busy={loading || undefined} className="text-[15px]">
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        <div>
          <Row
            key={`subtotal:${breakdown.listSubtotal}`}
            index={index++}
            label="Subtotal"
            value={fmtINR(breakdown.listSubtotal)}
            testId={ids.subtotal}
          />
        </div>
        {groups.length > 0 && (
          <div data-testid={ids.discounts}>
            <div data-testid={ids.offers} className={compact ? 'space-y-2' : 'space-y-3'}>
              {groups.map(g => (
                <Row
                  key={`${g.stage}:${g.total}:${g.promos.map(p => p.promotionId).join(',')}`}
                  index={index++}
                  label={g.label}
                  value={`−${fmtINR(g.total)}`}
                  testId={g.stage === 'code' ? ids.codeDiscount : undefined}
                >
                  {g.promos.length > 0 && <OfferLines promos={g.promos} compact={compact} />}
                </Row>
              ))}
            </div>
          </div>
        )}
        <div>
          <Row
            key={`shipping:${shippingCharged}`}
            index={index++}
            label="Shipping"
            value={shippingCharged === 0 ? 'Free' : fmtINR(shippingCharged)}
          >
            {shippingOffers.length > 0 && <OfferLines promos={shippingOffers} compact={compact} />}
          </Row>
        </div>
      </div>

      <div
        key={`total:${breakdown.total}`}
        className={cn('flex animate-print items-baseline justify-between gap-6', compact ? 'mt-4' : 'mt-7')}
        style={printDelay(index++)}
      >
        <span className="text-lg font-bold">Total</span>
        <span
          data-testid={ids.total}
          className={cn('font-extrabold leading-none tracking-[-0.04em]', compact ? 'text-[1.75rem]' : 'text-[2.5rem] sm:text-[2.75rem]')}
        >
          {fmtINR(breakdown.total)}
        </span>
      </div>
      {breakdown.totalSavings > 0 && (
        <p
          key={`savings:${breakdown.totalSavings}`}
          data-testid={ids.savings}
          className="mt-3 animate-print text-right"
          style={printDelay(index++)}
        >
          <span className="highlight px-1.5 py-0.5 font-semibold text-brass-foreground">You save {fmtINR(breakdown.totalSavings)}</span>
        </p>
      )}
      {children}
    </div>
  );
}

function OfferLines({ promos, compact }: { promos: AppliedPromotion[]; compact?: boolean }) {
  return (
    <ul className={cn('pl-4', compact ? 'mt-1 space-y-1' : 'mt-2 space-y-2')}>
      {promos.map(a => (
        <li key={a.promotionId} data-testid={`applied-offer-${a.promotionId}`}>
          <div className="flex items-baseline justify-between gap-6">
            <span className="font-medium">
              {a.name}
              {a.code && a.code !== a.name && <span className="font-normal text-muted-foreground"> with {a.code}</span>}
              {a.times > 1 && <span className="font-normal text-muted-foreground"> × {a.times}</span>}
            </span>
            {promos.length > 1 && <span className="shrink-0 text-muted-foreground">−{fmtINR(a.amount)}</span>}
          </div>
          {!compact && a.description && <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The pieces, at list price, so the column adds up to the subtotal beneath it. */
function ItemLines({ lines }: { lines: PricedLine[] }) {
  return (
    <ul className="space-y-3 text-[15px]">
      {lines.map((l, i) => (
        <li key={`${lineKey(l)}:${l.qty}`} className="flex animate-print items-baseline justify-between gap-6" style={printDelay(i)}>
          <span className="min-w-0">
            <span className="block font-medium leading-snug">{l.title}</span>
            <span className="block text-sm text-muted-foreground">
              Size {l.size}, qty {l.qty}
            </span>
          </span>
          <span className="shrink-0">{fmtINR(l.unitPrice * l.qty)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The receipt's footer notes: why the optimizer chose this price, and offers the customer is one
 * piece away from. (Named for what it showed before the receipt; it now carries the notes only, and
 * the applied offers are set as lines in `PriceSummary`.)
 */
export function AppliedOffers({ breakdown }: { breakdown: Breakdown }) {
  const explored = breakdown.optimizer?.nodesExplored ?? 0;
  // An explanation that only restates an offer line ("Weekend Uniform: … saves ₹1,099") is already printed above.
  const explanations = breakdown.explanations.filter(e => !breakdown.applied.some(a => e.startsWith(`${a.name}:`)));
  const hasNotes = explanations.length > 0 || breakdown.suggestions.length > 0 || explored > 1;
  if (!hasNotes) return null;
  return (
    <div data-testid="applied-offers" className="space-y-3 text-sm leading-relaxed">
      {explanations.map(e => (
        <p key={e} className="text-muted-foreground">
          {e}
        </p>
      ))}
      {explored > 1 && breakdown.applied.length > 0 && (
        <p className="text-muted-foreground">
          The optimizer compared {explored.toLocaleString('en-IN')} combinations of offers to reach this total.
        </p>
      )}
      {breakdown.suggestions.length > 0 && <NearMisses suggestions={breakdown.suggestions} />}
    </div>
  );
}

function NearMisses({ suggestions: all }: { suggestions: PricingSuggestion[] }) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState<string | null>(null);
  const { variant, expose } = useExperiment(NEAR_MISS_EXPERIMENT);
  useEffect(() => expose(), [expose]);
  const suggestions = variant === 'hidden' ? [] : all;

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
      toast.error(errorMessage(e, 'We couldn’t add that piece.'));
    } finally {
      setAdding(null);
    }
  };

  return (
    <>
      {suggestions.map(s => (
        <div key={s.message} data-testid="near-miss-suggestion" className="flex items-start justify-between gap-4">
          <p className="text-foreground">{s.message}</p>
          {s.kind === 'add-item' && s.slug && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={adding === s.message}
              onClick={() => addSuggested(s)}
              aria-label={`Add it: ${s.message}`}
            >
              {adding === s.message ? 'Adding…' : 'Add it'}
            </Button>
          )}
        </div>
      ))}
    </>
  );
}

/** Promo code entry; codes are checked by the next quote, which says why any cannot be used. */
export function PromoCodes({
  codes,
  onChange,
  breakdown,
  loading,
}: {
  codes: string[];
  onChange: (codes: string[]) => void;
  breakdown: Breakdown | null;
  /** A quote is on its way, so new codes are still being checked. */
  loading?: boolean;
}) {
  const [input, setInput] = useState('');
  const rejected = new Map((breakdown?.rejectedCodes ?? []).map(r => [r.code, r.reason]));
  const applied = new Set((breakdown?.applied ?? []).map(a => a.code).filter(Boolean));
  const full = codes.length >= 3;

  const add = () => {
    const code = input.trim().toUpperCase();
    if (!code) return;
    if (!codes.includes(code)) onChange([...codes, code].slice(-3));
    setInput('');
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor="promo-code">Promo code</Label>
        {full && (
          <span id="promo-code-hint" className="text-sm text-muted-foreground">
            Up to 3 per order
          </span>
        )}
      </div>
      <div className="mt-2 flex gap-2">
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
          placeholder="Try WELCOME10"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={full}
          aria-describedby={full ? 'promo-code-hint' : undefined}
          className="flex-1"
        />
        <Button
          type="button"
          data-testid="promo-code-apply-button"
          variant="outline"
          className="h-11"
          onClick={add}
          disabled={!input.trim() || full}
        >
          Apply
        </Button>
      </div>
      {codes.length > 0 && (
        <ul className="mt-3 space-y-2 text-[15px]" aria-live="polite">
          {codes.map(code => {
            const reason = rejected.get(code);
            const state = reason ? 'rejected' : !loading && applied.has(code) ? 'applied' : 'checking';
            return (
              <li key={code} data-testid={`promo-code-${code}`} className="flex items-start justify-between gap-4">
                <p className="min-w-0">
                  <span className="font-semibold">{code}</span>{' '}
                  {state === 'rejected' && <span className="text-destructive">— {reason}</span>}
                  {state === 'applied' && <span>applied</span>}
                  {state === 'checking' && <span className="text-muted-foreground">checking…</span>}
                </p>
                <button
                  type="button"
                  aria-label={`Remove ${code}`}
                  onClick={() => onChange(codes.filter(c => c !== code))}
                  className="shrink-0 touch-manipulation text-sm text-muted-foreground underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * One line's price after offers: the list total struck through, what this line pays, and the offers
 * that paid for the difference, by name.
 */
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
      <p className="text-right text-[15px] font-semibold" data-testid={testId}>
        {fmtINR(listTotal)}
      </p>
    );
  }
  const names = new Map((breakdown?.applied ?? []).map(a => [a.promotionId, a.name]));
  return (
    <div className="text-right text-[15px]" data-testid={testId}>
      <p className="text-sm text-muted-foreground line-through">
        <span className="sr-only">Was </span>
        {fmtINR(listTotal)}
      </p>
      <p className="font-semibold">{fmtINR(line.lineTotal)}</p>
      {line.discounts.length > 0 && (
        <ul className="mt-0.5 text-sm text-muted-foreground">
          {line.discounts.map(d => (
            <li key={d.promotionId}>
              {names.get(d.promotionId) ?? 'Offer'} <span className="whitespace-nowrap">−{fmtINR(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface PriceBreakdownProps {
  breakdown: Breakdown | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** The receipt's heading. */
  title?: string;
  /** Set the pieces as lines above the subtotal. */
  items?: boolean;
  /** A slot between the pieces and the figures, for promo code entry. */
  promo?: ReactNode;
  /** Print the optimizer's notes and near-miss offers as the receipt's footer. */
  notes?: boolean;
  /** What the receipt says beside its heading when it is not busy, such as the date. */
  meta?: ReactNode;
  compact?: boolean;
  testIds?: SummaryTestIds;
  className?: string;
  /** Extra lines after the saving. */
  children?: ReactNode;
}

/** The receipt on paper, with perforated edges. Keeps its frame while it loads, and says what failed. */
export function PriceBreakdown({
  breakdown,
  loading,
  error,
  onRetry,
  title = 'Receipt',
  items = false,
  promo,
  notes = true,
  meta,
  compact = false,
  testIds,
  className,
  children,
}: PriceBreakdownProps) {
  const headingId = useId();
  const status =
    breakdown && loading ? (
      <span className="text-muted-foreground">Repricing…</span>
    ) : breakdown && error ? (
      <span className="text-destructive">Couldn’t reprice</span>
    ) : !breakdown && loading ? (
      <span className="text-muted-foreground">Pricing…</span>
    ) : (
      meta && <span className="text-muted-foreground">{meta}</span>
    );
  const gap = compact ? 'mt-5' : 'mt-8';

  return (
    <section
      aria-labelledby={headingId}
      className={cn('edge-perforated bg-card text-card-foreground', compact ? 'px-5 py-7' : 'px-6 py-10 sm:px-8', className)}
    >
      <header className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="text-lg font-bold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-sm" aria-live="polite">
          {status}
        </p>
      </header>
      {items && breakdown && breakdown.lines.length > 0 && (
        <div className={gap}>
          <ItemLines lines={breakdown.lines} />
        </div>
      )}
      {promo && <div className={gap}>{promo}</div>}
      <div className={compact ? 'mt-4' : gap}>
        <PriceSummary breakdown={breakdown} loading={loading} error={error} onRetry={onRetry} compact={compact} testIds={testIds}>
          {children}
        </PriceSummary>
      </div>
      {notes && breakdown && (
        <div className={compact ? 'mt-5' : 'mt-9'}>
          <AppliedOffers breakdown={breakdown} />
        </div>
      )}
    </section>
  );
}
