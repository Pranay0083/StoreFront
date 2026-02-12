import Image from 'next/image';
import Link from 'next/link';
import { fmtINR } from '@/lib/api';
import type { Product } from '@/lib/types';

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const totalStock = product.sizes.reduce((s, v) => s + v.stock, 0);
  return (
    <Link
      href={`/products/${product.slug}`}
      data-testid={`product-card-${product.slug}`}
      className="group block animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        <Image
          src={product.images[0]}
          alt={product.title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
        {product.compareAtPrice && (
          <span className="absolute left-3 top-3 bg-black px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-white">
            Sale
          </span>
        )}
        {totalStock <= 5 && totalStock > 0 && (
          <span className="absolute right-3 top-3 bg-white/90 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-destructive">
            Low stock
          </span>
        )}
      </div>
      <div className="pt-4">
        <p className="label-caps text-muted-foreground">{product.category}</p>
        <h3 className="mt-1 font-serif text-lg font-medium leading-snug">{product.title}</h3>
        <p className="mt-1 text-sm">
          <span className="font-semibold">{fmtINR(product.price)}</span>
          {product.compareAtPrice && (
            <span className="ml-2 text-muted-foreground line-through">{fmtINR(product.compareAtPrice)}</span>
          )}
        </p>
      </div>
    </Link>
  );
}
