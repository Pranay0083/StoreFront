import type { Order, OrderStatus, StatusEvent } from '@storefront/contracts';
import { fmtDateTime, fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';

const FLOW: Array<{ status: OrderStatus; label: string }> = [
  { status: 'created', label: 'Order placed' },
  { status: 'paid', label: 'Paid' },
  { status: 'packed', label: 'Packed' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'delivered', label: 'Delivered' },
];

const BRANCH: Partial<Record<OrderStatus, string>> = {
  cancelled: 'Cancelled',
  refund_requested: 'Refund requested',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
};

const labelOf = (status: OrderStatus) => BRANCH[status] ?? FLOW.find(s => s.status === status)?.label ?? status;

/** Who moved the order, in words a customer would use. */
function actor(by: string) {
  if (by.startsWith('user:')) return 'You';
  if (by.startsWith('system:')) return 'Automatic';
  if (by.startsWith('webhook') || by.includes('razorpay')) return 'Payment provider';
  return 'STOREFRONT team';
}

interface Step {
  key: string;
  label: string;
  at?: string;
  state: 'done' | 'current' | 'pending' | 'stopped';
}

/**
 * The order's state machine as rows: one mark per state, its date on the right. States the order has
 * not reached yet show a dash; a cancellation or refund continues the list from where it branched.
 */
export function OrderTimeline({ order }: { order: Order }) {
  const lastAt = (status: OrderStatus, events: StatusEvent[]) => [...events].reverse().find(e => e.to === status)?.at;
  const reached = new Set<string>(order.statusHistory.map(e => e.to));
  reached.add(order.status);
  const lastFlowIdx = Math.max(...FLOW.map((s, i) => (reached.has(s.status) ? i : -1)));
  const inFlow = FLOW.some(s => s.status === order.status);

  const steps: Step[] = FLOW.filter((_, i) => inFlow || i <= lastFlowIdx).map((s, i) => ({
    key: s.status,
    label: s.label,
    at: lastAt(s.status, order.statusHistory) ?? (s.status === 'created' ? order.createdAt : undefined),
    state: i > lastFlowIdx ? 'pending' : order.status === s.status ? 'current' : 'done',
  }));
  order.statusHistory.forEach((e, i) => {
    const label = BRANCH[e.to];
    if (!label) return;
    const isLast = i === order.statusHistory.length - 1;
    steps.push({
      key: `${e.to}-${i}`,
      label,
      at: e.at,
      state: e.to === 'cancelled' || e.to === 'refunded' ? 'stopped' : isLast ? 'current' : 'done',
    });
  });

  const openRefund = order.refunds?.find(r => r.status === 'requested' || r.status === 'processing' || r.status === 'pending');
  const history = [...order.statusHistory].reverse();

  return (
    <div data-testid="order-timeline">
      <ol className="text-[15px]">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const trackDone = next && next.state !== 'pending';
          return (
            <li key={step.key} className="relative grid h-12 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-4">
              {next && (
                <span
                  aria-hidden
                  className={cn('absolute left-[6px] top-[31px] h-[34px] w-0.5', trackDone ? 'bg-foreground' : 'bg-border')}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'h-3.5 w-3.5',
                  step.state === 'pending' && 'border-2 border-input bg-transparent',
                  step.state === 'done' && 'bg-foreground',
                  step.state === 'current' && 'bg-foreground outline outline-[3px] outline-offset-2 outline-foreground/15',
                  step.state === 'stopped' && 'bg-destructive',
                )}
              />
              <span
                className={cn(
                  step.state === 'pending' && 'text-muted-foreground',
                  step.state === 'current' && 'font-semibold',
                  step.state === 'stopped' && 'font-semibold',
                )}
              >
                {step.label}
                {step.state === 'current' && <span className="sr-only"> (current)</span>}
              </span>
              <span className={cn('text-right', step.at ? 'text-foreground' : 'text-muted-foreground')}>
                {step.at ? fmtDateTime(step.at) : '—'}
              </span>
            </li>
          );
        })}
      </ol>

      {order.status === 'refund_requested' && (
        <p data-testid="order-refund-banner" className="mt-6 bg-secondary px-5 py-4 text-[15px] leading-relaxed">
          {openRefund?.kind === 'partial'
            ? `A refund of ${fmtINR(openRefund.amount)} for the returned pieces is on its way to your original payment method.`
            : 'A refund of the full amount is on its way to your original payment method.'}
        </p>
      )}

      {order.status === 'partially_refunded' && (
        <p data-testid="order-partial-refund-banner" className="mt-6 bg-secondary px-5 py-4 text-[15px] leading-relaxed">
          {fmtINR(order.refundedAmount)} has been refunded for the pieces you returned.
        </p>
      )}

      {(order.status === 'cancelled' || order.status === 'refunded') && (
        <p data-testid="order-terminal-banner" className="mt-6 flex items-center gap-3 bg-secondary px-5 py-4 text-[15px]">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-destructive" />
          {order.status === 'cancelled' ? 'This order was cancelled.' : 'This order was refunded in full.'}
        </p>
      )}

      <details className="group mt-6">
        <summary className="cursor-pointer select-none text-[15px] font-medium underline underline-offset-4 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show the full history</span>
          <span className="hidden group-open:inline">Hide the full history</span>
        </summary>
        <ol className="mt-4 space-y-3 text-[15px]">
          {history.map((e, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
              <span>{labelOf(e.to)}</span>
              <span className="text-right text-muted-foreground">{fmtDateTime(e.at)}</span>
              <span className="col-span-2 text-sm text-muted-foreground">
                {actor(e.by)}
                {e.note ? `. ${e.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
