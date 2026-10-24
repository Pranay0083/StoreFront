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
      <div data-testid="products-empty" className="py-24 text-center">
        <p className="font-serif text-3xl">Nothing matches.</p>
        <p className="mt-2 text-sm text-muted-foreground">Try loosening a filter or two.</p>
      </div>
    );
  }

  return (
    <>
      <p data-testid="products-count" className="mb-6 text-xs text-muted-foreground" aria-live="polite">
        {total} piece{total === 1 ? '' : 's'}
      </p>
      <div data-testid="products-grid" className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3">
        {items.map((p, i) => (
          <ProductCard key={p._id} product={p} index={i % 24} />
        ))}
      </div>
      <div ref={sentinel} aria-hidden className="h-px" />
      {isFetchingNextPage && (
        <div className="mt-12">
          <ProductGridSkeleton count={3} />
        </div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <div className="mt-12 text-center">
          <Button variant="outline" data-testid="products-load-more" onClick={() => fetchNextPage()}>
            {isError ? 'Retry loading more' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  );
}
