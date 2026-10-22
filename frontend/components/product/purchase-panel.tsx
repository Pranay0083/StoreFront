'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FREE_SHIPPING_THRESHOLD, MAX_LINE_QTY, type Product } from '@storefront/contracts';

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
      <fieldset className="mt-9">
        <legend className="label-caps mb-3 text-muted-foreground">Size</legend>
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
                'min-w-12 border px-4 py-2.5 text-sm transition-colors',
                size === s.size ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black',
                s.stock < 1 && 'cursor-not-allowed opacity-40 line-through',
              )}
            >
              {s.size}
            </button>
          ))}
        </div>
        {selected && selected.stock <= 5 && (
          <p data-testid="product-low-stock-note" className="mt-2 text-xs text-destructive" role="status">
            Only {selected.stock} left in {selected.size}
          </p>
        )}
      </fieldset>

      <div className="mt-8 flex items-center gap-4">
        <div className="flex items-center border border-black/20" role="group" aria-label="Quantity">
          <button
            type="button"
            data-testid="product-qty-decrease"
            aria-label="Decrease quantity"
            onClick={() => setQty(Math.max(1, qty - 1))}
            className="flex h-11 w-11 items-center justify-center hover:bg-black/5"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span data-testid="product-qty" className="w-10 text-center" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            data-testid="product-qty-increase"
            aria-label="Increase quantity"
            onClick={() => setQty(Math.min(maxQty, qty + 1))}
            className="flex h-11 w-11 items-center justify-center hover:bg-black/5"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <Button data-testid="product-add-to-cart" size="lg" className="flex-1" onClick={handleAdd}>
          Add to bag — {fmtINR(product.price * qty)}
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Free shipping over {fmtINR(FREE_SHIPPING_THRESHOLD)} · Cancel any time before shipping · Audited order tracking
      </p>
    </>
  );
}
