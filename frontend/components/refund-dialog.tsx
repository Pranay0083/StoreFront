'use client';

import { Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PARTIAL_REFUND_STATUSES, REFUND_WINDOW_DAYS, refundableAmount, type Order } from '@storefront/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtINR } from '@/lib/api';

const keyOf = (l: { productId: string; size: string }) => `${l.productId}::${l.size}`;

/**
 * Lets the customer (or an operator) choose which units to refund and previews the exact amount:
 * each unit is worth its share of what was paid for its line, and shipping comes back only when
 * nothing is left unrefunded. Before delivery only the whole order can be refunded.
 */
export function RefundDialog({
  order,
  open,
  onOpenChange,
  endpoint,
  onRefunded,
  title = 'Return items',
}: {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  onRefunded: (order: Order) => void;
  title?: string;
}) {
  const remaining = useMemo(
    () => order.items.map(i => ({ ...i, left: i.qty - (i.refundedQty ?? 0) })).filter(i => i.left > 0),
    [order.items],
  );
  const partialAllowed = PARTIAL_REFUND_STATUSES.includes(order.status);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQty(Object.fromEntries(remaining.map(i => [keyOf(i), partialAllowed ? 0 : i.left])));
      setReason('');
    }
  }, [open, remaining, partialAllowed]);

  const chosen = remaining.filter(i => (qty[keyOf(i)] ?? 0) > 0);
  const units = chosen.reduce((s, i) => s + qty[keyOf(i)], 0);
  const everything = units === remaining.reduce((s, i) => s + i.left, 0);
  const amount = chosen.reduce((s, i) => s + refundableAmount(i, i.refundedQty ?? 0, qty[keyOf(i)]), 0) + (everything ? order.shipping : 0);

  const submit = async () => {
    setSubmitting(true);
    try {
      const updated = await api<Order>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          ...(everything ? {} : { lines: chosen.map(i => ({ productId: i.productId, size: i.size, qty: qty[keyOf(i)] })) }),
        }),
      });
      onRefunded(updated);
      onOpenChange(false);
      toast.success(`Refund of ${fmtINR(amount)} requested`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not request the refund');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="order-refund-dialog">
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {partialAllowed
            ? `Choose what you are returning. Returns are open for ${REFUND_WINDOW_DAYS} days after delivery; each item is refunded at the price you paid for it after offers.`
            : 'Before delivery the whole order is refunded, including shipping.'}
        </p>
        <ul className="divide-y divide-black/5">
          {remaining.map(i => {
            const k = keyOf(i);
            const n = qty[k] ?? 0;
            return (
              <li key={k} className="flex items-center justify-between gap-3 py-3" data-testid={`refund-line-${i.slug}`}>
                <div className="text-sm">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Size {i.size} · {i.left} refundable · paid {fmtINR(i.lineTotal)} for {i.qty}
                  </p>
                </div>
                <div className="flex items-center border border-black/15">
                  <button
                    aria-label={`One fewer ${i.title}`}
                    className="flex h-8 w-8 items-center justify-center hover:bg-black/5 disabled:opacity-30"
                    disabled={!partialAllowed || n === 0}
                    onClick={() => setQty(q => ({ ...q, [k]: n - 1 }))}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-8 text-center text-sm">{n}</span>
                  <button
                    aria-label={`One more ${i.title}`}
                    className="flex h-8 w-8 items-center justify-center hover:bg-black/5 disabled:opacity-30"
                    disabled={!partialAllowed || n >= i.left}
                    onClick={() => setQty(q => ({ ...q, [k]: n + 1 }))}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-between border-t border-black/10 pt-3 text-sm font-semibold">
          <span>Refund{everything && order.shipping > 0 ? ' (incl. shipping)' : ''}</span>
          <span data-testid="refund-preview-amount">{fmtINR(amount)}</span>
        </div>
        <Textarea
          data-testid="order-refund-reason"
          placeholder="Tell us what went wrong"
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={500}
        />
        <Button data-testid="order-refund-submit" onClick={submit} disabled={submitting || units === 0 || reason.trim().length < 3}>
          {submitting ? 'Submitting…' : `Request ${fmtINR(amount)} refund`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
