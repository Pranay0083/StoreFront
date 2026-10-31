'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import type { Review } from '@storefront/contracts';

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('flex', className)} aria-label={`${rating} out of 5 stars`} role="img">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          aria-hidden
          className={cn('h-4 w-4', i < Math.round(rating) ? 'fill-foreground text-foreground' : 'text-foreground/30')}
        />
      ))}
    </span>
  );
}

/** Reviews in two columns: the score and the form on the left, what people wrote on the right. */
export function ReviewsSection({
  productId,
  initialReviews,
  numReviews,
  rating,
}: {
  productId: string;
  initialReviews: Review[];
  numReviews: number;
  rating?: number;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');

  const { data: reviews = initialReviews } = useQuery({
    queryKey: queryKeys.reviews(productId),
    queryFn: () => api<Review[]>(`/reviews/product/${productId}`),
    initialData: initialReviews,
    staleTime: 60_000,
  });

  const submit = useMutation({
    mutationFn: () => api('/reviews', { method: 'POST', body: JSON.stringify({ productId, rating: stars, comment }) }),
    onSuccess: () => {
      toast.success('Review submitted');
      setComment('');
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews(productId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section
      id="reviews"
      className="grid scroll-mt-20 grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8"
      data-testid="reviews-section"
      aria-labelledby="reviews-heading"
    >
      <div className="lg:col-span-4">
        <h2 id="reviews-heading" className="text-display-md font-extrabold">
          Reviews
        </h2>
        {numReviews > 0 && rating !== undefined && (
          <div className="mt-6 flex items-center gap-4">
            <span className="text-display-md font-extrabold">{rating.toFixed(1)}</span>
            <span>
              <Stars rating={rating} />
              <span className="mt-1 block text-base text-muted-foreground">
                from {numReviews} review{numReviews === 1 ? '' : 's'}
              </span>
            </span>
          </div>
        )}

        {user && typeof user === 'object' ? (
          <form
            className="mt-8 bg-card p-6"
            onSubmit={e => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <fieldset>
              <legend className="mb-3 text-base font-semibold">Leave a review</legend>
              <div className="mb-4 flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={n === stars}
                    data-testid={`review-star-${n}`}
                    onClick={() => setStars(n)}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    className="flex h-10 w-10 items-center justify-center transition-transform duration-150 ease-out active:scale-[0.9]"
                  >
                    <Star
                      className={cn('h-6 w-6 transition-colors', n <= stars ? 'fill-foreground text-foreground' : 'text-foreground/30')}
                    />
                  </button>
                ))}
              </div>
              <label htmlFor="review-comment" className="sr-only">
                Your review
              </label>
              <Textarea
                id="review-comment"
                data-testid="review-comment-input"
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="How does it wear?"
                aria-describedby="review-rule"
              />
            </fieldset>
            <Button data-testid="review-submit-button" type="submit" className="mt-4" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit review'}
            </Button>
            <p id="review-rule" className="mt-3 text-sm text-muted-foreground">
              Only customers with a delivered order for this piece can review it.
            </p>
          </form>
        ) : (
          <p className="mt-6 text-base">
            <Link href="/login" className="font-semibold underline underline-offset-4">
              Sign in
            </Link>{' '}
            to review a piece you have received.
          </p>
        )}
      </div>

      <div className="lg:col-span-8">
        {reviews.length === 0 ? (
          <p className="max-w-[40ch] text-xl leading-snug lg:pt-3">
            No one has reviewed this piece yet. Reviews come only from customers whose order of it has been delivered.
          </p>
        ) : (
          <ul className="space-y-10 lg:pt-3">
            {reviews.map(r => (
              <li key={r._id}>
                <article>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <p className="text-base font-semibold">{r.userName}</p>
                    <Stars rating={r.rating} />
                    <p className="text-base text-muted-foreground">
                      {fmtDate(r.createdAt)}
                      {r.verifiedPurchase ? ', verified purchase' : ''}
                    </p>
                  </div>
                  {r.comment && <p className="mt-2 max-w-[62ch] text-lg leading-relaxed">{r.comment}</p>}
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
