'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ProductCard } from '@/components/product-card';
import { ProductGridSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { Product } from '@/lib/types';
import { cn } from '@/lib/utils';

const SIZES = ['S', 'M', 'L', 'XL', 'UK 8', 'UK 9', 'One Size'];
const PRICE_RANGES = [
  { label: 'Under ₹2,000', min: '', max: '2000' },
  { label: '₹2,000 – ₹5,000', min: '2000', max: '5000' },
  { label: '₹5,000 – ₹10,000', min: '5000', max: '10000' },
  { label: '₹10,000 +', min: '10000', max: '' },
];

function ProductsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<{ items: Product[]; total: number } | null>(null);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [search, setSearch] = useState(params.get('q') || '');

  const category = params.get('category') || '';
  const size = params.get('size') || '';
  const minPrice = params.get('minPrice') || '';
  const maxPrice = params.get('maxPrice') || '';
  const sort = params.get('sort') || 'newest';
  const q = params.get('q') || '';

  const setParam = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/products?${next.toString()}`);
  };

  useEffect(() => {
    api<{ name: string; count: number }[]>('/products/categories').then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setData(null);
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if (size) qs.set('size', size);
    if (minPrice) qs.set('minPrice', minPrice);
    if (maxPrice) qs.set('maxPrice', maxPrice);
    if (sort) qs.set('sort', sort);
    if (q) qs.set('q', q);
    api<{ items: Product[]; total: number }>(`/products?${qs.toString()}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0 }));
  }, [category, size, minPrice, maxPrice, sort, q]);

  const hasFilters = category || size || minPrice || maxPrice || q;

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8" data-testid="products-page">
      <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="label-caps text-muted-foreground">The collection</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">
            {category || 'All pieces'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form
            className="relative"
            onSubmit={e => { e.preventDefault(); setParam({ q: search }); }}
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="products-search-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pieces…"
              className="w-56 pl-9"
            />
          </form>
          <Select value={sort} onValueChange={v => setParam({ sort: v })}>
            <SelectTrigger data-testid="products-sort-select" className="w-44">
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
      </div>

      <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-10">
          <div>
            <p className="label-caps mb-4 text-muted-foreground">Category</p>
            <ul className="space-y-2.5 text-sm">
              <li>
                <button
                  data-testid="filter-category-all"
                  onClick={() => setParam({ category: '' })}
                  className={cn('transition-colors hover:text-foreground', !category ? 'font-semibold' : 'text-muted-foreground')}
                >
                  All ({categories.reduce((s, c) => s + c.count, 0)})
                </button>
              </li>
              {categories.map(c => (
                <li key={c.name}>
                  <button
                    data-testid={`filter-category-${c.name.toLowerCase()}`}
                    onClick={() => setParam({ category: c.name })}
                    className={cn('transition-colors hover:text-foreground', category === c.name ? 'font-semibold' : 'text-muted-foreground')}
                  >
                    {c.name} ({c.count})
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="label-caps mb-4 text-muted-foreground">Size</p>
            <div className="flex flex-wrap gap-2">
              {SIZES.map(s => (
                <button
                  key={s}
                  data-testid={`filter-size-${s.toLowerCase().replace(/\s/g, '-')}`}
                  onClick={() => setParam({ size: size === s ? '' : s })}
                  className={cn(
                    'border px-3 py-1.5 text-xs transition-colors',
                    size === s ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label-caps mb-4 text-muted-foreground">Price</p>
            <ul className="space-y-2.5 text-sm">
              {PRICE_RANGES.map(r => {
                const active = minPrice === r.min && maxPrice === r.max && (r.min || r.max);
                return (
                  <li key={r.label}>
                    <button
                      data-testid={`filter-price-${r.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
                      onClick={() => setParam(active ? { minPrice: '', maxPrice: '' } : { minPrice: r.min, maxPrice: r.max })}
                      className={cn('transition-colors hover:text-foreground', active ? 'font-semibold' : 'text-muted-foreground')}
                    >
                      {r.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {hasFilters && (
            <Button variant="outline" size="sm" data-testid="filters-clear-button" onClick={() => { setSearch(''); router.push('/products'); }}>
              <X className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </aside>

        <div>
          {data === null ? (
            <ProductGridSkeleton count={9} />
          ) : data.items.length === 0 ? (
            <div data-testid="products-empty" className="py-24 text-center">
              <p className="font-serif text-3xl">Nothing matches.</p>
              <p className="mt-2 text-sm text-muted-foreground">Try loosening a filter or two.</p>
            </div>
          ) : (
            <>
              <p data-testid="products-count" className="mb-6 text-xs text-muted-foreground">
                {data.total} piece{data.total === 1 ? '' : 's'}
              </p>
              <div data-testid="products-grid" className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3">
                {data.items.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-5 py-12 sm:px-8"><ProductGridSkeleton /></div>}>
      <ProductsContent />
    </Suspense>
  );
}
