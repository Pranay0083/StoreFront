import type { OrderStatus } from '@storefront/contracts';
import { cn } from '@/lib/utils';

type Tone = 'waiting' | 'moving' | 'done' | 'stopped';

/** One hue at a few intensities: hollow while waiting, ink while the order moves, green once delivered. */
const TONE: Record<OrderStatus, Tone> = {
  created: 'waiting',
  paid: 'moving',
  packed: 'moving',
  shipped: 'moving',
  delivered: 'done',
  cancelled: 'stopped',
  refund_requested: 'waiting',
  partially_refunded: 'done',
  refunded: 'stopped',
};

const MARK: Record<Tone, string> = {
  waiting: 'border-[1.5px] border-muted-foreground',
  moving: 'bg-foreground',
  done: 'bg-positive',
  stopped: 'bg-destructive',
};

export const statusLabel = (status: OrderStatus) => status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ');

/** An order's status as a small square mark and a sentence-case word: one mark per row, never squeezed. */
export function StatusBadge({ status, testId, className }: { status: OrderStatus; testId?: string; className?: string }) {
  return (
    <span
      data-testid={testId || `status-badge-${status}`}
      className={cn('inline-flex flex-none items-center gap-2 whitespace-nowrap text-sm font-medium', className)}
    >
      <span aria-hidden className={cn('h-2 w-2 shrink-0', MARK[TONE[status] ?? 'waiting'])} />
      {statusLabel(status)}
    </span>
  );
}
