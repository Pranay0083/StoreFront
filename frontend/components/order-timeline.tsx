import { Ban, Check, RotateCcw } from 'lucide-react';
import { fmtDateTime } from '@/lib/api';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';

const FLOW = ['created', 'paid', 'packed', 'shipped', 'delivered'] as const;

export function OrderTimeline({ order }: { order: Order }) {
  const reached = new Set(order.statusHistory.map(e => e.to));
  reached.add(order.status as any);
  const isTerminalBranch = order.status === 'cancelled' || order.status === 'refunded';
  const lastFlowIdx = Math.max(...FLOW.map((s, i) => (reached.has(s) ? i : -1)));

  return (
    <div data-testid="order-timeline">
      <div className="flex items-start">
        {FLOW.map((step, i) => {
          const done = i <= lastFlowIdx;
          const isCurrent = order.status === step;
          return (
            <div key={step} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={cn('h-px flex-1', i === 0 ? 'bg-transparent' : done ? 'bg-black' : 'bg-black/15')} />
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center border transition-colors',
                    done ? 'border-black bg-black text-white' : 'border-black/20 bg-white text-black/30'
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : <span className="text-xs">{i + 1}</span>}
                </div>
                <div className={cn('h-px flex-1', i === FLOW.length - 1 ? 'bg-transparent' : i < lastFlowIdx ? 'bg-black' : 'bg-black/15')} />
              </div>
              <p className={cn('mt-2 text-[10px] uppercase tracking-[0.15em] sm:text-xs', isCurrent ? 'font-semibold' : done ? 'text-foreground/70' : 'text-black/30')}>
                {step}
              </p>
            </div>
          );
        })}
      </div>

      {isTerminalBranch && (
        <div
          data-testid="order-terminal-banner"
          className="mt-6 flex items-center gap-3 border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {order.status === 'cancelled' ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          This order was {order.status}.
        </div>
      )}

      <div className="mt-8">
        <p className="label-caps mb-4 text-muted-foreground">Audit trail</p>
        <ul className="space-y-3 border-l border-black/10 pl-5">
          {[...order.statusHistory].reverse().map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -left-[23px] top-1.5 h-1.5 w-1.5 bg-black" />
              <span className="font-medium">{e.from ? `${e.from} → ${e.to}` : `Order ${e.to}`}</span>
              <span className="ml-2 text-xs text-muted-foreground">{fmtDateTime(e.at)} · {e.by}</span>
              {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
