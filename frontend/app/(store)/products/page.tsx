import { X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CatalogToolbar } from '@/components/catalog/catalog-toolbar';
import { ProductResults } from '@/components/catalog/product-results';
import { JsonLd } from '@/components/json-ld';
import { ProductGridSkeleton } from '@/components/skeletons';
import { serverApi } from '@/lib/server-api';
import { absoluteUrl } from '@/lib/site';
import { cn } from '@/lib/utils';
import type { FacetCount } from '@storefront/contracts';

const SIZES = ['S', 'M', 'L', 'XL', 'UK 8', 'UK 9', 'One Size'];
const PRICE_RANGES = [
  { label: 'Under ₹2,000', min: '', max: '200000' },
  { label: '₹2,000 – ₹5,000', min: '200000', max: '500000' },
  { label: '₹5,000 – ₹10,000', min: '500000', max: '1000000' },
  { label: '₹10,000 +', min: '1000000', max: '' },
];
const FILTER_KEYS = ['category', 'size', 'minPrice', 'maxPrice', 'sort', 'q'] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

async function readFilters(searchParams: SearchParams): Promise<Filters> {
  const raw = await searchParams;
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  return Object.fromEntries(FILTER_KEYS.map(k => [k, one(k)])) as Filters;
}

function apiQuery(f: Filters): URLSearchParams {
  const qs = new URLSearchParams({ limit: '24', sort: f.sort || 'newest' });
  for (const k of ['category', 'size', 'minPrice', 'maxPrice', 'q'] as const) if (f[k]) qs.set(k, f[k]);
  return qs;
}

function hrefWith(f: Filters, updates: Partial<Filters>): string {
  const next = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = k in updates ? updates[k] : f[k];
    if (v) next.set(k, v);
  }
  const s = next.toString();
  return s ? `/products?${s}` : '/products';
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const f = await readFilters(searchParams);
  const title = f.q ? `Search: ${f.q}` : f.category || 'All pieces';
  const canonical = absoluteUrl(f.category ? `/products?category=${encodeURIComponent(f.category)}` : '/products');
  const filtered = Boolean(f.q || f.size || f.minPrice || f.maxPrice || (f.sort && f.sort !== 'newest'));
  return {
    title: `${title} — STOREFRONT`,
    description: `Shop ${f.category || 'the full collection'} at STOREFRONT. Free shipping over ₹2,999.`,
    alternates: { canonical },
    robots: filtered ? { index: false, follow: true } : undefined,
    openGraph: { url: canonical, title: `${title} — STOREFRONT` },
  };
}

function FilterLink({ href, active, children, testId }: { href: string; active: boolean; children: React.ReactNode; testId: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      data-testid={testId}
      aria-current={active ? 'true' : undefined}
      className={cn('transition-colors hover:text-foreground', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}
    >
      {children}
    </Link>
  );
}

async function Results({ f }: { f: Filters }) {
  const qs = apiQuery(f);
  const [first, categories] = await Promise.all([serverApi.products(qs), serverApi.categories().catch(() => [])]);
  const categoryFacets: FacetCount[] = first.facets?.categories ?? categories.map(c => ({ value: c.name, count: c.count }));
  const sizeCounts = new Map((first.facets?.sizes ?? []).map(s => [s.value, s.count]));
  const allCount = categoryFacets.reduce((s, c) => s + c.count, 0);
  const hasFilters = Boolean(f.category || f.size || f.minPrice || f.maxPrice || f.q);

  return (
    <div className="grid gap-12 lg:grid-cols-[220px_1fr]">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: first.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: absoluteUrl(`/products/${p.slug}`) })),
        }}
      />
      <aside className="space-y-10" aria-label="Filters">
        <nav aria-labelledby="filter-category-heading">
          <h2 id="filter-category-heading" className="label-caps mb-4 text-muted-foreground">
            Category
          </h2>
          <ul className="space-y-2.5 text-sm">
            <li>
              <FilterLink href={hrefWith(f, { category: '' })} active={!f.category} testId="filter-category-all">
                All ({allCount})
              </FilterLink>
            </li>
            {categoryFacets.map(c => (
              <li key={c.value}>
                <FilterLink
                  href={hrefWith(f, { category: c.value })}
                  active={f.category === c.value}
                  testId={`filter-category-${c.value.toLowerCase()}`}
                >
                  {c.value} ({c.count})
                </FilterLink>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="filter-size-heading">
          <h2 id="filter-size-heading" className="label-caps mb-4 text-muted-foreground">
            Size
          </h2>
          <div className="flex flex-wrap gap-2">
            {SIZES.map(s => (
              <Link
                key={s}
                scroll={false}
                href={hrefWith(f, { size: f.size === s ? '' : s })}
                data-testid={`filter-size-${s.toLowerCase().replace(/\s/g, '-')}`}
                aria-current={f.size === s ? 'true' : undefined}
                className={cn(
                  'border px-3 py-1.5 text-xs transition-colors',
                  f.size === s ? 'border-black bg-black text-white' : 'border-black/20 hover:border-black',
                )}
              >
                {s}
                {sizeCounts.has(s) && <span className="ml-1 opacity-70">({sizeCounts.get(s)})</span>}
              </Link>
            ))}
          </div>
        </nav>

        <nav aria-labelledby="filter-price-heading">
          <h2 id="filter-price-heading" className="label-caps mb-4 text-muted-foreground">
            Price
          </h2>
          <ul className="space-y-2.5 text-sm">
            {PRICE_RANGES.map(r => {
              const active = Boolean(f.minPrice === r.min && f.maxPrice === r.max && (r.min || r.max));
              return (
                <li key={r.label}>
                  <FilterLink
                    href={hrefWith(f, active ? { minPrice: '', maxPrice: '' } : { minPrice: r.min, maxPrice: r.max })}
                    active={active}
                    testId={`filter-price-${r.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
                  >
                    {r.label}
                  </FilterLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {hasFilters && (
          <Link
            href={f.sort && f.sort !== 'newest' ? `/products?sort=${f.sort}` : '/products'}
            data-testid="filters-clear-button"
            className="inline-flex items-center gap-2 border border-black/20 px-3 py-1.5 text-xs hover:border-black"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
          </Link>
        )}
      </aside>

      <div>
        <ProductResults key={qs.toString()} query={qs.toString()} initial={first} />
      </div>
    </div>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const f = await readFilters(searchParams);
  return (
    <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8" data-testid="products-page">
      <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="label-caps text-muted-foreground">The collection</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tighter sm:text-5xl">
            {f.q ? `“${f.q}”` : f.category || 'All pieces'}
          </h1>
        </div>
        <Suspense>
          <CatalogToolbar />
        </Suspense>
      </div>
      <Suspense key={JSON.stringify(f)} fallback={<ProductGridSkeleton count={9} />}>
        <Results f={f} />
      </Suspense>
    </div>
  );
}
