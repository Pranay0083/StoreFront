'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Star } from 'lucide-react';
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

export function ReviewsSection({
  productId,
  initialReviews,
  numReviews,
}: {
  productId: string;
  initialReviews: Review[];
  numReviews: number;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const { data: reviews = initialReviews } = useQuery({
    queryKey: queryKeys.reviews(productId),
    queryFn: () => api<Review[]>(`/reviews/product/${productId}`),
    initialData: initialReviews,
    staleTime: 60_000,
  });

  const submit = useMutation({
    mutationFn: () => api('/reviews', { method: 'POST', body: JSON.stringify({ productId, rating, comment }) }),
    onSuccess: () => {
      toast.success('Review submitted');
      setComment('');
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews(productId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="max-w-3xl" data-testid="reviews-section" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="font-serif text-3xl font-semibold tracking-tight">
        Reviews {numReviews > 0 && <span className="text-muted-foreground">({numReviews})</span>}
      </h2>

      {user && typeof user === 'object' ? (
        <form
          className="mt-8 border border-black/10 bg-white p-6"
          onSubmit={e => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <fieldset>
            <legend className="label-caps mb-4 text-muted-foreground">Leave a review</legend>
            <div className="mb-4 flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={n === rating}
                  data-testid={`review-star-${n}`}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  <Star className={cn('h-6 w-6 transition-colors', n <= rating ? 'fill-black text-black' : 'text-black/25')} />
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
            />
          </fieldset>
          <Button data-testid="review-submit-button" type="submit" className="mt-4" disabled={submit.isPending}>
            {submit.isPending ? 'Submitting…' : 'Submit review'}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Only customers with a delivered order for this piece can review it.</p>
        </form>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            Sign in
          </Link>{' '}
          to leave a review.
        </p>
      )}

      <div className="mt-10 space-y-8">
        {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
        {reviews.map(r => (
          <article key={r._id} className="border-b border-black/5 pb-6">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex h-9 w-9 items-center justify-center bg-black font-serif text-white">
                {r.userName?.[0] || '?'}
              </span>
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  {r.userName}
                  {r.verifiedPurchase && (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified purchase
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <span className="flex" aria-label={`${r.rating} out of 5 stars`} role="img">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} aria-hidden className={cn('h-3.5 w-3.5', i < r.rating ? 'fill-black text-black' : 'text-black/20')} />
                    ))}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span>
                </div>
              </div>
            </div>
            {r.comment && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
