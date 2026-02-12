'use client';

import { Minus, Plus, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth, useCart } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, fmtINR } from '@/lib/api';
import type { Product, Review } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { addItem } = useCart();
  const { user } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [imageIdx, setImageIdx] = useState(0);
  const [size, setSize] = useState('');
  const [qty, setQty] = useState(1);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<Product>(`/products/${slug}`)
      .then(p => {
        setProduct(p);
        if (p.sizes.length === 1) setSize(p.sizes[0].size);
        api<Review[]>(`/reviews/product/${p._id}`).then(setReviews).catch(() => {});
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-32 text-center sm:px-8">
        <p className="font-serif text-4xl">This piece doesn&apos;t exist.</p>
        <Button asChild className="mt-6"><Link href="/products">Back to the collection</Link></Button>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-12 sm:px-8 lg:grid-cols-2">
        <Skeleton className="aspect-[3/4] w-full" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const selected = product.sizes.find(s => s.size === size);

  const handleAdd = () => {
    if (!size) return toast.error('Select a size first');
    if (!selected || selected.stock < 1) return toast.error('This size is out of stock');
    addItem({
      productId: product._id, title: product.title, image: product.images[0],
      price: product.price, size, qty, slug: product.slug,
    });
    toast.success(`${product.title} added to your bag`);
  };

  const submitReview = async () => {
    setSubmitting(true);
    try {
      await api('/reviews', { method: 'POST', body: JSON.stringify({ productId: product._id, rating, comment }) });
      toast.success('Review submitted');
      setComment('');
      api<Review[]>(`/reviews/product/${product._id}`).then(setReviews).catch(() => {});
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8" data-testid="product-detail-page">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <div className="relative aspect-[3/4] max-h-[80vh] w-full overflow-hidden bg-muted">
            <Image
              src={product.images[imageIdx] || product.images[0]}
              alt={product.title}
              fill
              priority
              sizes="(max-width:1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          {product.images.length > 1 && (
            <div className="mt-4 flex gap-3">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  data-testid={`product-thumb-${i}`}
                  onClick={() => setImageIdx(i)}
                  className={cn('relative h-24 w-20 overflow-hidden border transition-colors', i === imageIdx ? 'border-black' : 'border-transparent')}
                >
                  <Image src={img} alt="" fill sizes="80px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:pt-6">
          <p className="label-caps text-muted-foreground">{product.category}</p>
          <h1 data-testid="product-title" className="mt-3 font-serif text-4xl font-semibold leading-none tracking-tighter sm:text-5xl">
            {product.title}
          </h1>
          <div className="mt-4 flex items-center gap-4">
            <p data-testid="product-price" className="text-xl font-semibold">{fmtINR(product.price)}</p>
            {product.compareAtPrice && (
              <p className="text-muted-foreground line-through">{fmtINR(product.compareAtPrice)}</p>
            )}
            {product.numReviews > 0 && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="h-4 w-4 fill-black text-black" /> {product.rating} ({product.numReviews})
              </span>
            )}
          </div>

          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground">{product.description}</p>

          <div className="mt-9">
            <p className="label-caps mb-3 text-muted-foreground">Size</p>
            <div className="flex flex-wrap gap-2">
              {product.sizes.map(s => (
                <button
                  key={s.size}
                  data-testid={`product-size-${s.size.toLowerCase().replace(/\s/g, '-')}`}
                  disabled={s.stock < 1}
                  onClick={() => setSize(s.size)}
                  className={cn(
                    'min-w-12 border px-4 py-2.5 text-sm transition-colors',
                    size === s.size ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black',
                    s.stock < 1 && 'cursor-not-allowed opacity-30 line-through'
                  )}
                >
                  {s.size}
                </button>
              ))}
            </div>
            {selected && selected.stock <= 5 && (
              <p data-testid="product-low-stock-note" className="mt-2 text-xs text-destructive">
                Only {selected.stock} left in {selected.size}
              </p>
            )}
          </div>

          <div className="mt-8 flex items-center gap-4">
            <div className="flex items-center border border-black/20">
              <button data-testid="product-qty-decrease" onClick={() => setQty(Math.max(1, qty - 1))} className="flex h-11 w-11 items-center justify-center hover:bg-black/5">
                <Minus className="h-4 w-4" />
              </button>
              <span data-testid="product-qty" className="w-10 text-center">{qty}</span>
              <button data-testid="product-qty-increase" onClick={() => setQty(Math.min(10, qty + 1))} className="flex h-11 w-11 items-center justify-center hover:bg-black/5">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <Button data-testid="product-add-to-cart" size="lg" className="flex-1" onClick={handleAdd}>
              Add to bag — {fmtINR(product.price * qty)}
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Free shipping over ₹2,999 · Cancel any time before shipping · Audited order tracking
          </p>
        </div>
      </div>

      <Separator className="my-20" />

      <section className="max-w-3xl" data-testid="reviews-section">
        <h2 className="font-serif text-3xl font-semibold tracking-tight">
          Reviews {product.numReviews > 0 && <span className="text-muted-foreground">({product.numReviews})</span>}
        </h2>

        {user && typeof user === 'object' ? (
          <div className="mt-8 border border-black/10 bg-white p-6">
            <p className="label-caps mb-4 text-muted-foreground">Leave a review</p>
            <div className="mb-4 flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} data-testid={`review-star-${n}`} onClick={() => setRating(n)} aria-label={`${n} stars`}>
                  <Star className={cn('h-6 w-6 transition-colors', n <= rating ? 'fill-black text-black' : 'text-black/25')} />
                </button>
              ))}
            </div>
            <Textarea
              data-testid="review-comment-input"
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="How does it wear?"
            />
            <Button data-testid="review-submit-button" className="mt-4" onClick={submitReview} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit review'}
            </Button>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            <Link href="/login" className="underline">Sign in</Link> to leave a review.
          </p>
        )}

        <div className="mt-10 space-y-8">
          {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
          {reviews.map(r => (
            <div key={r._id} className="border-b border-black/5 pb-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center bg-black font-serif text-white">
                  {r.userName?.[0] || '?'}
                </span>
                <div>
                  <p className="text-sm font-medium">{r.userName}</p>
                  <div className="flex items-center gap-2">
                    <span className="flex">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={cn('h-3.5 w-3.5', i < r.rating ? 'fill-black text-black' : 'text-black/20')} />
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
                  </div>
                </div>
              </div>
              {r.comment && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
