'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { SearchBox } from '@/components/catalog/search-box';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function CatalogToolbar() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.push(`/products?${next.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <SearchBox key={params.get('q') || ''} initial={params.get('q') || ''} onSearch={q => setParam({ q })} />
      <Select value={params.get('sort') || 'newest'} onValueChange={v => setParam({ sort: v })}>
        <SelectTrigger data-testid="products-sort-select" className="w-44" aria-label="Sort by">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="price-asc">Price: Low to high</SelectItem>
          <SelectItem value="price-desc">Price: High to low</SelectItem>
          <SelectItem value="rating">Top rated</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
