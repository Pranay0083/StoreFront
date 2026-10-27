import Image from 'next/image';
import Link from 'next/link';
import { fmtINR } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Product } from '@storefront/contracts';

export type CardProduct = Pick<Product, '_id' | 'title' | 'slug' | 'price' | 'compareAtPrice' | 'images' | 'category'> &
  Partial<Pick<Product, 'sizes'>>;

/** The photograph, and under it a swing tag with the name and the price. */
export function ProductCard({
  product,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  className,
}: {
  product: CardProduct;
  sizes?: string;
  className?: string;
}) {
  const totalStock = product.sizes?.reduce((s, v) => s + v.stock, 0) ?? Infinity;
  const fewLeft = totalStock <= 5 && totalStock > 0;
  return (
    <Link
      href={`/products/${product.slug}`}
      data-testid={`product-card-${product.slug}`}
      className={cn('group relative block transition-transform duration-150 ease-out active:scale-[0.98]', className)}
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
      <div className="edge-notched flex items-start justify-between gap-3 bg-card px-4 pb-3.5 pt-4">
        <h3 className="text-base font-semibold leading-snug">{product.title}</h3>
        <p className="shrink-0 text-right text-base tabular-nums">
          {product.compareAtPrice ? (
            <span className="mr-2 text-muted-foreground line-through">
              <span className="sr-only">Was </span>
              {fmtINR(product.compareAtPrice)}
            </span>
          ) : null}
          <span className="font-semibold">
            {product.compareAtPrice ? <span className="sr-only">Now </span> : null}
            {fmtINR(product.price)}
          </span>
        </p>
      </div>
      {fewLeft && <p className="mt-2 text-sm text-muted-foreground">Only {totalStock} left</p>}
    </Link>
  );
}
