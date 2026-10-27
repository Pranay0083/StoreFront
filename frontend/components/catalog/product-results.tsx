'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ProductCard } from '@/components/product-card';
import { ProductGridSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { ProductListResponse } from '@storefront/contracts';

type PageParam = { cursor?: string; page?: number } | null;

/** Infinite list seeded with the server-rendered first page; keyset cursors when the API offers them, pages for text search. */
export function ProductResults({ query, initial }: { query: string; initial: ProductListResponse }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isError } = useInfiniteQuery({
    queryKey: queryKeys.products(query),
    initialPageParam: null as PageParam,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams(query);
      if (pageParam?.cursor) qs.set('cursor', pageParam.cursor);
      if (pageParam?.page) qs.set('page', String(pageParam.page));
      return api<ProductListResponse>(`/products?${qs.toString()}`);
    },
    getNextPageParam: (last): PageParam | undefined => {
      if (last.nextCursor) return { cursor: last.nextCursor };
      if (last.page < last.pages) return { page: last.page + 1 };
      return undefined;
    },
    initialData: { pages: [initial], pageParams: [null] },
    staleTime: 60_000,
  });

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = data.pages.flatMap(p => p.items);
  const total = data.pages[0]?.total ?? 0;

  if (!items.length) {
    return (
      <div data-testid="products-empty" className="bg-card px-6 py-16 sm:px-10">
        <p className="text-display-md font-extrabold">Nothing matches</p>
        <p className="mt-4 max-w-[44ch] text-lg">Loosen a filter or two, or clear them all to see every piece.</p>
      </div>
    );
  }

  return (
    <>
      <p data-testid="products-count" className="mb-6 text-base text-muted-foreground" aria-live="polite">
        {total} piece{total === 1 ? '' : 's'}
      </p>
      <div data-testid="products-grid" className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-3">
        {items.map(p => (
          <ProductCard key={p._id} product={p} sizes="(max-width: 1024px) 50vw, 28vw" />
        ))}
      </div>
      <div ref={sentinel} aria-hidden className="h-px" />
      {isFetchingNextPage && (
        <div className="mt-12">
          <ProductGridSkeleton count={3} />
        </div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <div className="mt-14 flex justify-center">
          <Button variant="outline" size="lg" data-testid="products-load-more" onClick={() => fetchNextPage()}>
            {isError ? 'Retry loading more' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  );
}
