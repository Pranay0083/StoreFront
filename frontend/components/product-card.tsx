import Image from 'next/image';
import Link from 'next/link';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { OfferBadge, Product } from '@storefront/contracts';

export type CardProduct = Pick<Product, '_id' | 'title' | 'slug' | 'price' | 'compareAtPrice' | 'images' | 'category'> &
  Partial<Pick<Product, 'sizes'>>;

/** "In Weekend Uniform — save ₹1,099" for a piece in a set; the multi-buy's own words otherwise. */
export function OfferLine({ badge, className }: { badge: OfferBadge; className?: string }) {
  return (
    <p data-testid="offer-line" className={cn('text-sm font-medium', className)}>
      {badge.kind === 'set' ? (
        <>
          In {badge.name}
          {badge.saving ? (
            <>
              {' '}
              — save <span className="highlight px-0.5">{fmtINR(badge.saving)}</span>
            </>
          ) : null}
        </>
      ) : (
        badge.headline
      )}
    </p>
  );
}

/** The photograph, and under it a swing tag with the name, the price and, for a piece on offer, one offer line. */
export function ProductCard({
  product,
  badge,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  className,
}: {
  product: CardProduct;
  /** From a lookup built once per page out of the offers read model. */
  badge?: OfferBadge;
  sizes?: string;
  className?: string;
}) {
  const totalStock = product.sizes?.reduce((s, v) => s + v.stock, 0) ?? Infinity;
  const fewLeft = totalStock <= 5 && totalStock > 0;
  return (
    <Link
      href={`/products/${product.slug}`}
      data-testid={`product-card-${product.slug}`}
      className={cn('group relative flex flex-col transition-transform duration-150 ease-out active:scale-[0.98]', className)}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-secondary">
        <Image
          src={product.images[0]}
          alt={product.title}
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
      </div>
      <div className="edge-notched min-h-[5.75rem] flex-1 bg-card px-4 pb-3.5 pt-4">
        <h3 className="text-base font-semibold leading-snug">{product.title}</h3>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-base">
          <span className="font-semibold">
            {product.compareAtPrice ? <span className="sr-only">Now </span> : null}
            {fmtINR(product.price)}
          </span>
          {product.compareAtPrice ? (
            <span className="text-muted-foreground line-through">
              <span className="sr-only">Was </span>
              {fmtINR(product.compareAtPrice)}
            </span>
          ) : null}
          {fewLeft && <span className="text-sm text-muted-foreground">Only {totalStock} left</span>}
        </p>
        {badge && <OfferLine badge={badge} className="mt-1.5" />}
      </div>
    </Link>
  );
}
