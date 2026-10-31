'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { BundleOffer, Product } from '@storefront/contracts';

const firstInStock = (p?: Product) => p?.sizes.find(s => s.stock > 0)?.size ?? '';

/** One offer, set as a receipt: the pieces it takes, the bundle total over the struck list total, and the saving in brass. */
function BundleCard({ offer, products }: { offer: BundleOffer; products: Record<string, Product> }) {
  const { addItem } = useCart();
  const components = offer.components ?? [];
  const [sizes, setSizes] = useState<Record<string, string>>(() =>
    Object.fromEntries(components.map(c => [c.productId, firstInStock(products[c.slug])])),
  );
  const purchasable = components.length > 0 && components.every(c => products[c.slug] && sizes[c.productId]);

  const addSet = () => {
    for (const c of components) {
      const product = products[c.slug];
      const size = sizes[c.productId];
      const variant = product.sizes.find(s => s.size === size);
      addItem({
        productId: c.productId,
        title: product.title,
        image: product.images[0],
        price: product.price,
        size,
        qty: 1,
        slug: product.slug,
        stock: variant?.stock,
      });
    }
    toast.success(`${offer.name} added. The bundle price applies in your bag.`);
  };

  return (
    <article data-testid={`bundle-offer-${offer.promotionId}`} className="edge-perforated bg-card px-6 pb-9 pt-10 sm:px-8">
      <h3 className="text-2xl font-bold tracking-[-0.03em]">{offer.name}</h3>
      <p className="mt-2 max-w-[52ch] text-base">{offer.summary || offer.description}</p>

      {components.length > 0 && (
        <ul className="mt-7 space-y-5">
          {components.map(c => {
            const product = products[c.slug];
            const id = `bundle-${offer.promotionId}-${c.productId}-size`;
            const image = c.image || product?.images[0];
            return (
              <li key={c.productId} className="flex items-center gap-4">
                <Link
                  href={`/products/${c.slug}`}
                  className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden bg-secondary transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  {image && <Image src={image} alt={c.title} fill sizes="72px" className="object-cover" />}
                </Link>
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <Link href={`/products/${c.slug}`} className="text-base font-semibold underline-offset-4 hover:underline">
                      {c.title}
                    </Link>
                    <p className="text-base text-muted-foreground">{fmtINR(c.price)}</p>
                  </div>
                  {product && product.sizes.length > 1 && (
                    <div>
                      <label htmlFor={id} className="sr-only">
                        Size for {c.title}
                      </label>
                      <select
                        id={id}
                        value={sizes[c.productId]}
                        onChange={e => setSizes(s => ({ ...s, [c.productId]: e.target.value }))}
                        className="h-10 border border-input bg-card px-2.5 text-base"
                      >
                        {product.sizes.map(s => (
                          <option key={s.size} value={s.size} disabled={s.stock < 1}>
                            {s.size}
                            {s.stock < 1 ? ', sold out' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <p>
          {offer.listPrice !== undefined && (
            <span className="block text-base text-muted-foreground line-through">
              <span className="sr-only">Usually </span>
              {fmtINR(offer.listPrice)}
            </span>
          )}
          {offer.bundlePrice !== undefined && <span className="text-display-md font-extrabold">{fmtINR(offer.bundlePrice)}</span>}
        </p>
        {offer.savings ? (
          <p data-testid="bundle-savings" className="text-xl font-bold">
            <span className="highlight px-1">Save {fmtINR(offer.savings)}</span>
          </p>
        ) : null}
      </div>

      {components.length > 0 ? (
        <Button data-testid={`bundle-add-${offer.promotionId}`} size="lg" className="mt-7 w-full" onClick={addSet} disabled={!purchasable}>
          Add the set to bag
        </Button>
      ) : (
        <p className="mt-6 text-base">
          Add any qualifying pieces to your bag and it applies on its own.{' '}
          <Link href="/products" className="font-semibold underline underline-offset-4">
            Browse the catalogue
          </Link>
        </p>
      )}
    </article>
  );
}

/** The offers that include this piece; the optimizer applies them in the bag on its own. */
export function BundleOffers({
  offers,
  products,
  className,
}: {
  offers: BundleOffer[];
  products: Record<string, Product>;
  className?: string;
}) {
  if (!offers.length) return null;
  return (
    <div data-testid="bundle-offers" className={cn('grid items-start gap-8', offers.length > 1 && 'xl:grid-cols-2', className)}>
      {offers.map(o => (
        <BundleCard key={o.promotionId} offer={o} products={products} />
      ))}
    </div>
  );
}
