'use client';

import { toast } from 'sonner';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OfferExampleLine } from '@storefront/contracts';

/**
 * Puts the worked example's pieces in the bag, each in its first size in stock (the sizes the
 * example was priced in), so the bag prints the same offer line and total the receipt shows.
 */
export function AddSetButton({
  offerId,
  name,
  lines,
  label = 'Add the set to bag',
  className,
}: {
  offerId: string;
  name: string;
  lines: OfferExampleLine[];
  label?: string;
  className?: string;
}) {
  const { addItem } = useCart();
  const add = () => {
    for (const l of lines) {
      addItem({
        productId: l.productId,
        title: l.title,
        image: l.image ?? '',
        price: l.price,
        size: l.size,
        qty: l.qty,
        slug: l.slug,
        stock: l.stock,
      });
    }
    toast.success(`${name} added. The offer applies in your bag; change sizes there.`);
  };
  return (
    <Button data-testid={`offer-add-${offerId}`} size="lg" className={cn('w-full', className)} onClick={add} disabled={!lines.length}>
      {label}
    </Button>
  );
}
