'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { fmtINR } from '@/lib/api';

export function CartSheet() {
  const { items, subtotal, open, setOpen, updateQty, removeItem } = useCart();
  const router = useRouter();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent data-testid="cart-sheet">
        <div className="border-b border-black/5 px-7 py-6">
          <SheetTitle className="font-serif text-2xl font-semibold">Your bag</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Free shipping on orders over ₹2,999
          </SheetDescription>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
            <p className="font-serif text-3xl">Nothing here yet.</p>
            <Button data-testid="cart-empty-shop-button" onClick={() => { setOpen(false); router.push('/products'); }}>
              Browse the collection
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-7 py-5">
              {items.map(item => (
                <div
                  key={`${item.productId}-${item.size}`}
                  data-testid={`cart-item-${item.slug}`}
                  className="flex gap-4 border-b border-black/5 py-5 first:pt-0"
                >
                  <div className="relative h-24 w-20 shrink-0 overflow-hidden bg-muted">
                    <Image src={item.image} alt={item.title} fill sizes="80px" className="object-cover" />
                  </div>
                  <div className="flex flex-1 flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Size {item.size}</p>
                      </div>
                      <button
                        data-testid={`cart-item-remove-${item.slug}`}
                        onClick={() => removeItem(item.productId, item.size)}
                        className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center border border-black/15">
                        <button
                          data-testid={`cart-item-decrease-${item.slug}`}
                          onClick={() => updateQty(item.productId, item.size, item.qty - 1)}
                          className="flex h-7 w-7 items-center justify-center hover:bg-black/5"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span data-testid={`cart-item-qty-${item.slug}`} className="w-8 text-center text-sm">{item.qty}</span>
                        <button
                          data-testid={`cart-item-increase-${item.slug}`}
                          onClick={() => updateQty(item.productId, item.size, item.qty + 1)}
                          className="flex h-7 w-7 items-center justify-center hover:bg-black/5"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="text-sm font-semibold">{fmtINR(item.price * item.qty)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-black/10 px-7 py-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="label-caps text-muted-foreground">Subtotal</span>
                <span data-testid="cart-subtotal" className="font-serif text-2xl font-semibold">{fmtINR(subtotal)}</span>
              </div>
              <Button
                data-testid="cart-checkout-button"
                className="w-full"
                size="lg"
                onClick={() => { setOpen(false); router.push('/checkout'); }}
              >
                Checkout
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
