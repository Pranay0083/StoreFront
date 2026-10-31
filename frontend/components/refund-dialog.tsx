'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PARTIAL_REFUND_STATUSES, REFUND_WINDOW_DAYS, refundableAmount, type Order } from '@storefront/contracts';
import { Field } from '@/components/checkout/field';
import { QtyStepper } from '@/components/checkout/qty-stepper';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, fmtINR } from '@/lib/api';

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
      toast.success(`Refund of ${fmtINR(amount)} requested.`);
    } catch (e) {
      toast.error(errorMessage(e, 'We couldn’t request the refund. Try again in a moment.'));
    } finally {
      setSubmitting(false);
    }
  };

  const reasonShort = reason.trim().length < 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="order-refund-dialog" className="gap-0">
        <DialogTitle className="pr-10">{title}</DialogTitle>
        <DialogDescription className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {partialAllowed
            ? `Choose what you are sending back. Returns are open for ${REFUND_WINDOW_DAYS} days after delivery, and each piece is refunded at what you paid for it after offers.`
            : 'Before delivery the whole order is refunded, shipping included.'}
        </DialogDescription>
        <ul className="mt-6 divide-y divide-border">
          {remaining.map(i => {
            const k = keyOf(i);
            const n = qty[k] ?? 0;
            return (
              <li key={k} className="flex items-center justify-between gap-4 py-3" data-testid={`refund-line-${i.slug}`}>
                <div className="min-w-0 text-[15px]">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Size {i.size}, {i.left} returnable, paid {fmtINR(i.lineTotal)} for {i.qty}
                  </p>
                </div>
                <QtyStepper
                  value={n}
                  dense
                  onDecrease={() => setQty(q => ({ ...q, [k]: n - 1 }))}
                  onIncrease={() => setQty(q => ({ ...q, [k]: n + 1 }))}
                  canDecrease={partialAllowed && n > 0}
                  canIncrease={partialAllowed && n < i.left}
                  decreaseLabel={`One fewer ${i.title}`}
                  increaseLabel={`One more ${i.title}`}
                />
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-baseline justify-between gap-4">
          <span className="text-[15px] font-semibold">
            Refund
            {everything && order.shipping > 0 && <span className="font-normal text-muted-foreground">, shipping included</span>}
          </span>
          <span data-testid="refund-preview-amount" className="text-2xl font-extrabold tracking-[-0.03em]">
            {fmtINR(amount)}
          </span>
        </div>
        <Field id="refund-reason" label="What went wrong?" hint="A few words is enough" className="mt-6">
          {control => (
            <Textarea
              {...control}
              data-testid="order-refund-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
          )}
        </Field>
        <Button
          data-testid="order-refund-submit"
          size="lg"
          className="mt-6"
          onClick={submit}
          disabled={submitting || units === 0 || reasonShort}
        >
          {submitting ? 'Requesting…' : units === 0 ? 'Choose what to return' : `Request a ${fmtINR(amount)} refund`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
