'use client';

import { Check, Copy } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { OrderStatus } from '@storefront/contracts';

/*
 * The back office's kit: the achromatic ledger (tasteskill app screens) on the store's palette and face.
 * Chrome is ink and greys on the ledger ground; white panels with one 1px edge and square corners;
 * colour only on data (`text-chart`/`bg-chart`) and in pale status pills. No entrances: motion is
 * feedback only (the Button's press scale, menus and sheets).
 *
 * Grid arithmetic (1440 wide): 1440 - 232 sidebar = 1208 canvas; 32px gutters each side leave 1144.
 * One gap (16px) everywhere: 3 x 370.67 + 2 x 16 = 1144; 1fr + 16 + 360 = 1144 (1fr = 768).
 */

const count = new Intl.NumberFormat('en-IN');
/** A count with Indian grouping, e.g. 1,23,456. */
export const fmtCount = (n: number) => count.format(n);
export const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** Sums and averages in whole rupees, so a column of totals keeps one number of decimals. */
export const fmtRupees = (paise: number) => `₹${rupees.format(Math.round(paise / 100))}`;

/** "Today 14:32", "Yesterday 09:10", "3 Oct 18:05": recency in words, the time always shown. */
export function fmtWhen(d: string | Date) {
  const date = new Date(d);
  const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${time}`;
}

/** "4 min", "3 h", "2 days": how long ago, for queues where age is the point. */
export function fmtAge(d: string | Date) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;

/** One h1 per screen (a noun at 24px), an optional finding line, and the screen's job on the right. */
export function PageHeader({
  title,
  crumb,
  finding,
  actions,
  className,
}: {
  title: React.ReactNode;
  crumb?: React.ReactNode;
  finding?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 max-w-3xl">
        <div className="flex items-baseline gap-2 text-2xl font-semibold leading-tight tracking-[-0.02em]">
          {crumb}
          <h1>{title}</h1>
        </div>
        {finding && <p className="mt-1.5 text-[15px] leading-snug text-muted-foreground">{finding}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A white panel with one 1px edge. Its header carries the title, a grey period or count, and at most one action. */
export function Panel({
  title,
  meta,
  action,
  children,
  className,
  bodyClassName,
  ...rest
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={cn('min-w-0 border border-border bg-card', className)} {...rest}>
      {(title || meta || action) && (
        <header className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-4">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            {meta}
            {action}
          </div>
        </header>
      )}
      <div className={cn('px-5 pb-5 pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export interface Kpi {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  testId?: string;
}

/** KPIs as type in one container split by dividers: label over value, no icons, no sparklines. */
export function KpiStrip({ items, loading, className }: { items: Kpi[]; loading?: boolean; className?: string }) {
  const cols = items.length;
  return (
    <div
      className={cn(
        'grid grid-cols-2 border border-border bg-card',
        cols === 3 && 'lg:grid-cols-3',
        cols === 4 && 'lg:grid-cols-4',
        cols === 5 && 'lg:grid-cols-5',
        className,
      )}
    >
      {items.map((k, i) => (
        <div
          key={k.label}
          data-testid={k.testId}
          className={cn(
            'min-w-0 border-border px-5 py-4',
            // Dividers: a left rule between cells on one row; a top rule on the phone's second row.
            i % 2 === 1 && 'border-l',
            i >= 2 && 'border-t lg:border-t-0',
            i > 0 && 'lg:border-l',
            // An odd count on the phone: the last cell takes the full row.
            cols % 2 === 1 && i === cols - 1 && 'col-span-2 border-l-0 lg:col-span-1 lg:border-l',
          )}
        >
          <p className="text-[13px] text-muted-foreground">{k.label}</p>
          {loading ? (
            <LoadingBar className="mt-2 h-6 w-24" />
          ) : (
            <p className="mt-1 truncate text-xl font-medium tracking-[-0.01em] md:text-2xl">{k.value}</p>
          )}
          {k.sub && !loading && <p className="mt-0.5 truncate text-xs text-muted-foreground">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export type PillTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'chart' | 'ink';

// Pale tint with dark text of the same hue (app-screens §7.6); never a saturated fill.
const PILL: Record<PillTone, string> = {
  positive: 'bg-[#dcf5e1] text-[#0d3b1a]',
  negative: 'bg-[#fbe7e3] text-[#7d1d1a]',
  warning: 'bg-[#fbf3d6] text-[#7a4108]',
  neutral: 'bg-secondary text-foreground/80',
  chart: 'bg-[hsl(var(--chart)/0.13)] text-[hsl(54_70%_18%)]',
  ink: 'bg-foreground text-background',
};

/** One status mark per row: a 20px pill that never squeezes or wraps. */
export function Pill({
  tone = 'neutral',
  children,
  className,
  ...rest
}: { tone?: PillTone; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center whitespace-nowrap px-2 text-xs font-medium leading-none',
        PILL[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** A missing value: a grey dash, never a zero. */
export const Dash = ({ label = 'Not set' }: { label?: string }) => (
  <span className="text-muted-foreground" aria-label={label}>
    —
  </span>
);

/** Loading: the final layout with each value replaced by a flat grey bar at its real size. */
export const LoadingBar = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('block bg-foreground/[0.07]', className)} />
);

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-border/70', className)} aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center gap-4">
          <LoadingBar className="h-3.5 w-1/3" />
          <LoadingBar className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** An empty block keeps its frame and says so in one sentence. */
export function Empty({
  children,
  className,
  ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border border-dashed border-input px-4 py-3 text-sm text-muted-foreground', className)} {...rest}>
      {children}
    </div>
  );
}

/** An error stays inside the block that failed: what failed, and a Retry. */
export function BlockError({ what, onRetry, className }: { what: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm', className)} role="alert">
      <span className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" aria-hidden />
      <span>Couldn&apos;t load {what}.</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline-offset-4 hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}

/** Underline tabs on a full-width 1px rule; the 2px indicator is as wide as the label. Scroll sideways on a phone. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  testIdPrefix,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number | null }>;
  testIdPrefix?: string;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-max gap-6 border-b border-border">
        {options.map(o => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={testIdPrefix ? `${testIdPrefix}${o.value}` : undefined}
              onClick={() => onChange(o.value)}
              className={cn(
                '-mb-px flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm',
                active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
              {o.count != null && <span className={cn(active ? 'text-foreground' : 'text-muted-foreground')}>{fmtCount(o.count)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A product photograph at a fixed slot, so text starts on one edge down the list. */
export function Thumb({ src, className }: { src?: string; className?: string }) {
  return (
    <span className={cn('relative block h-10 w-8 flex-none overflow-hidden bg-secondary', className)}>
      {src && <Image src={src} alt="" fill sizes="40px" className="object-cover" />}
    </span>
  );
}

// People keep a stable pale tint of their own hue, at least 60 degrees apart for neighbours.
const PERSON_HUES = [24, 96, 168, 216, 288, 336];
const hueFor = (seed: string) => PERSON_HUES[[...seed].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % PERSON_HUES.length];

/** A person's initial on a pale tint of their own hue: identity, not data. */
export function Initial({ name, className }: { name: string; className?: string }) {
  const letter = [...(name.trim() || '?')][0].toUpperCase();
  const hue = hueFor(name);
  return (
    <span
      aria-hidden
      className={cn('flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-semibold', className)}
      style={{ background: `hsl(${hue} 45% 90%)`, color: `hsl(${hue} 45% 24%)` }}
    >
      {letter}
    </span>
  );
}

/** An id truncated to 8 characters with a copy button 12px after it. */
export function ShortId({ id, className }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const short = id.length > 10 ? `${id.slice(0, 8)}…` : id;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={id}>
      {short}
      <button
        type="button"
        aria-label={`Copy ${id}`}
        onClick={e => {
          e.stopPropagation();
          void navigator.clipboard?.writeText(id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

/** A live connection: a 6px dot and the word, so the state is not colour alone. */
export function LiveDot({ live, testId }: { live: boolean; testId?: string }) {
  return (
    <span
      data-testid={testId}
      title={live ? 'Receiving live updates' : 'Live updates paused; reconnecting'}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-positive' : 'bg-foreground/25')} aria-hidden />
      {live ? 'Live' : 'Reconnecting'}
    </span>
  );
}

/** A label above its field: 13px at 500 in ink, 6px gap. */
export function FieldLabel({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="block text-[13px] font-medium text-foreground">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

/** A native select in the field style; one control height (36px) per context. */
export const selectClass =
  'h-9 w-full border border-input bg-card px-2.5 text-sm transition-[border-color] duration-150 focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground disabled:opacity-50';

const money2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Money in a column: always two decimals, so the paise line up digit for digit. */
export const fmtMoney = (paise: number) => `₹${money2.format(paise / 100)}`;

/** Order statuses in the words of the people who pack and ship. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  created: 'Awaiting payment',
  paid: 'To pack',
  packed: 'To ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refund_requested: 'Refund requested',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
};

// One state machine, few intensities: the data hue on the two queues the team works (to pack, to ship),
// a notice tint while a refund is open, green once delivered, grey for everything settled or idle.
const ORDER_TONE: Record<OrderStatus, PillTone> = {
  created: 'neutral',
  paid: 'chart',
  packed: 'chart',
  shipped: 'neutral',
  delivered: 'positive',
  cancelled: 'neutral',
  refund_requested: 'warning',
  partially_refunded: 'neutral',
  refunded: 'neutral',
};

export function OrderStatusPill({ status, testId }: { status: OrderStatus; testId?: string }) {
  return (
    <Pill tone={ORDER_TONE[status]} data-testid={testId ?? `status-badge-${status}`}>
      {ORDER_STATUS_LABEL[status]}
    </Pill>
  );
}

/** A 28x16 switch; on is near-black, never the data hue. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 flex-none items-center rounded-full transition-colors duration-150 disabled:opacity-50',
        checked ? 'bg-foreground' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 h-3 w-3 rounded-full bg-card transition-transform duration-150 ease-out',
          checked ? 'translate-x-3' : 'translate-x-0',
        )}
      />
    </button>
  );
}
