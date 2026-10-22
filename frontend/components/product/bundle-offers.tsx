'use client';

import { Tag } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/api';
import type { BundleOffer, Product } from '@storefront/contracts';

const firstInStock = (p?: Product) => p?.sizes.find(s => s.stock > 0)?.size ?? '';

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
    toast.success(`${offer.name} added — the bundle price applies in your bag`);
  };

  return (
    <article data-testid={`bundle-offer-${offer.promotionId}`} className="border border-black/10 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-caps flex items-center gap-2 text-muted-foreground">
            <Tag className="h-3.5 w-3.5" aria-hidden /> {components.length ? 'Bought together' : 'Offer'}
          </p>
          <h3 className="mt-2 font-serif text-xl font-semibold">{offer.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{offer.summary || offer.description}</p>
        </div>
        {offer.savings ? (
          <p data-testid="bundle-savings" className="bg-black px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white">
            Save {fmtINR(offer.savings)}
          </p>
        ) : null}
      </div>

      {components.length > 0 && (
        <>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {components.map(c => {
              const product = products[c.slug];
              const id = `bundle-${offer.promotionId}-${c.productId}-size`;
              return (
                <li key={c.productId} className="flex gap-3">
                  <Link href={`/products/${c.slug}`} className="relative h-20 w-16 shrink-0 overflow-hidden bg-muted">
                    {(c.image || product?.images[0]) && (
                      <Image src={c.image || product!.images[0]} alt={c.title} fill sizes="64px" className="object-cover" />
                    )}
                  </Link>
                  <div className="min-w-0 text-sm">
                    <Link href={`/products/${c.slug}`} className="font-medium hover:underline">
                      {c.title}
                    </Link>
                    <p className="text-muted-foreground">{fmtINR(c.price)}</p>
                    {product && product.sizes.length > 1 && (
                      <div className="mt-1">
                        <label htmlFor={id} className="sr-only">
                          Size for {c.title}
                        </label>
                        <select
                          id={id}
                          value={sizes[c.productId]}
                          onChange={e => setSizes(s => ({ ...s, [c.productId]: e.target.value }))}
                          className="border border-black/20 bg-transparent px-2 py-1 text-xs"
                        >
                          {product.sizes.map(s => (
                            <option key={s.size} value={s.size} disabled={s.stock < 1}>
                              {s.size}
                              {s.stock < 1 ? ' — sold out' : ''}
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
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-black/5 pt-5">
            <p className="text-sm">
              {offer.bundlePrice !== undefined && <span className="text-lg font-semibold">{fmtINR(offer.bundlePrice)}</span>}
              {offer.listPrice !== undefined && <span className="ml-2 text-muted-foreground line-through">{fmtINR(offer.listPrice)}</span>}
            </p>
            <Button data-testid={`bundle-add-${offer.promotionId}`} onClick={addSet} disabled={!purchasable}>
              Add the set to bag
            </Button>
          </div>
        </>
      )}
    </article>
  );
}

export function BundleOffers({ offers, products }: { offers: BundleOffer[]; products: Record<string, Product> }) {
  if (!offers.length) return null;
  return (
    <section aria-labelledby="bundle-offers-heading" data-testid="bundle-offers" className="mt-20">
      <h2 id="bundle-offers-heading" className="font-serif text-3xl font-semibold tracking-tight">
        Better together
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Offers apply automatically in your bag — we always pick the cheapest combination.
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {offers.map(o => (
          <BundleCard key={o.promotionId} offer={o} products={products} />
        ))}
      </div>
    </section>
  );
}
