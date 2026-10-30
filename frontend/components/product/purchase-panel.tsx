'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MAX_LINE_QTY, type Product } from '@storefront/contracts';

const press = 'transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]';

export function PurchasePanel({ product }: { product: Product }) {
  const { addItem } = useCart();
  const [size, setSize] = useState(product.sizes.length === 1 ? product.sizes[0].size : '');
  const [qty, setQty] = useState(1);
  const selected = product.sizes.find(s => s.size === size);
  const maxQty = Math.max(1, Math.min(MAX_LINE_QTY, selected?.stock ?? 10));

  const handleAdd = () => {
    if (!size) return toast.error('Select a size first');
    if (!selected || selected.stock < 1) return toast.error('This size is out of stock');
    addItem({
      productId: product._id,
      title: product.title,
      image: product.images[0],
      price: product.price,
      size,
      qty,
      slug: product.slug,
      stock: selected.stock,
    });
    toast.success(`${product.title} added to your bag`);
  };

  return (
    <>
      <fieldset className="mt-8">
        <legend className="mb-3 text-base font-semibold">Size</legend>
        <div className="flex flex-wrap gap-2">
          {product.sizes.map(s => (
            <button
              key={s.size}
              type="button"
              data-testid={`product-size-${s.size.toLowerCase().replace(/\s/g, '-')}`}
              disabled={s.stock < 1}
              aria-pressed={size === s.size}
              aria-label={s.stock < 1 ? `${s.size}, sold out` : `Size ${s.size}`}
              onClick={() => {
                setSize(s.size);
                setQty(q => Math.min(q, Math.max(1, s.stock)));
              }}
              className={cn(
                'h-12 min-w-14 px-4 text-base font-medium',
                press,
                size === s.size ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent',
                s.stock < 1 && 'cursor-not-allowed line-through opacity-40',
              )}
            >
              {s.size}
            </button>
          ))}
        </div>
        <p
          data-testid={selected && selected.stock <= 5 ? 'product-low-stock-note' : undefined}
          className="mt-3 min-h-6 text-base"
          role="status"
        >
          {selected && selected.stock <= 5 ? `Only ${selected.stock} left in ${selected.size}` : ''}
        </p>
      </fieldset>

      <div className="mt-4 flex items-stretch gap-3">
        <div className="flex items-center bg-secondary" role="group" aria-label="Quantity">
          <button
            type="button"
            data-testid="product-qty-decrease"
            aria-label="Decrease quantity"
            onClick={() => setQty(Math.max(1, qty - 1))}
            className={cn('flex h-14 w-12 items-center justify-center hover:bg-accent', press)}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span data-testid="product-qty" className="w-8 text-center text-base" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            data-testid="product-qty-increase"
            aria-label="Increase quantity"
            onClick={() => setQty(Math.min(maxQty, qty + 1))}
            className={cn('flex h-14 w-12 items-center justify-center hover:bg-accent', press)}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <Button
          data-testid="product-add-to-cart"
          size="lg"
          className="min-w-0 flex-1 justify-center gap-4 px-5 min-[440px]:justify-between sm:px-8"
          onClick={handleAdd}
        >
          <span>Add to bag</span>
          <span className="hidden min-[440px]:inline">{fmtINR(product.price * qty)}</span>
        </Button>
      </div>
    </>
  );
}
