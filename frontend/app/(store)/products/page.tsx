import { X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CatalogToolbar } from '@/components/catalog/catalog-toolbar';
import { FilterPanel } from '@/components/catalog/filter-panel';
import { ProductResults } from '@/components/catalog/product-results';
import { JsonLd } from '@/components/json-ld';
import { ProductGridSkeleton } from '@/components/skeletons';
import { serverApi } from '@/lib/server-api';
import { absoluteUrl } from '@/lib/site';
import { cn } from '@/lib/utils';
import { offerBadges, type FacetCount } from '@storefront/contracts';

const APPAREL_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

/** Apparel smallest to largest, then shoe sizes by number, then anything else (One Size) last. */
function sizeRank(size: string): number {
  const apparel = APPAREL_ORDER.indexOf(size);
  if (apparel >= 0) return apparel;
  const shoe = /^UK (\d+(?:\.5)?)$/.exec(size);
  return shoe ? 100 + Number(shoe[1]) : 1000;
}
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
      className={cn(
        'underline-offset-4 decoration-[1.5px] transition-colors duration-150 hover:text-foreground hover:underline',
        active ? 'font-semibold text-foreground underline' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}

const chip =
  'inline-flex h-10 items-center gap-1 px-3.5 text-[15px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97]';

async function Results({ f }: { f: Filters }) {
  const qs = apiQuery(f);
  const [first, categories, { offers }] = await Promise.all([
    serverApi.products(qs),
    serverApi.categories().catch(() => []),
    serverApi.offersOrNone(),
  ]);
  const categoryFacets: FacetCount[] = first.facets?.categories ?? categories.map(c => ({ value: c.name, count: c.count }));
  const sizeCounts = new Map((first.facets?.sizes ?? []).map(s => [s.value, s.count]));
  const sizes = [...sizeCounts.keys()].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));
  const allCount = categoryFacets.reduce((s, c) => s + c.count, 0);
  const activeFilters = [f.category, f.size, f.minPrice || f.maxPrice, f.q].filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-x-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: first.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: absoluteUrl(`/products/${p.slug}`) })),
        }}
      />
      <FilterPanel active={activeFilters}>
        <nav aria-labelledby="filter-category-heading">
          <h2 id="filter-category-heading" className="mb-3 text-base font-semibold">
            Department
          </h2>
          <ul className="space-y-2 text-base">
            <li>
              <FilterLink href={hrefWith(f, { category: '' })} active={!f.category} testId="filter-category-all">
                All <span>({allCount})</span>
              </FilterLink>
            </li>
            {categoryFacets.map(c => (
              <li key={c.value}>
                <FilterLink
                  href={hrefWith(f, { category: c.value })}
                  active={f.category === c.value}
                  testId={`filter-category-${c.value.toLowerCase()}`}
                >
                  {c.value} <span>({c.count})</span>
                </FilterLink>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="filter-size-heading">
          <h2 id="filter-size-heading" className="mb-3 text-base font-semibold">
            Size
          </h2>
          <div className="flex flex-wrap gap-2">
            {sizes.map(s => (
              <Link
                key={s}
                scroll={false}
                href={hrefWith(f, { size: f.size === s ? '' : s })}
                data-testid={`filter-size-${s.toLowerCase().replace(/\s/g, '-')}`}
                aria-current={f.size === s ? 'true' : undefined}
                className={cn(chip, f.size === s ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent')}
              >
                {s}
                {sizeCounts.has(s) && <span className="opacity-70">({sizeCounts.get(s)})</span>}
              </Link>
            ))}
          </div>
        </nav>

        <nav aria-labelledby="filter-price-heading">
          <h2 id="filter-price-heading" className="mb-3 text-base font-semibold">
            Price
          </h2>
          <ul className="space-y-2 text-base">
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

        {activeFilters > 0 && (
          <Link
            href={f.sort && f.sort !== 'newest' ? `/products?sort=${f.sort}` : '/products'}
            data-testid="filters-clear-button"
            className={cn(chip, 'bg-secondary hover:bg-accent')}
          >
            <X className="h-4 w-4" aria-hidden /> Clear filters
          </Link>
        )}
      </FilterPanel>

      <div className="min-w-0">
        <ProductResults key={qs.toString()} query={qs.toString()} initial={first} badges={offerBadges(offers)} />
      </div>
    </div>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const f = await readFilters(searchParams);
  return (
    <div className="mx-auto max-w-[1760px] px-4 pb-8 pt-8 sm:px-8 sm:pt-12" data-testid="products-page">
      <div className="mb-10 flex flex-col gap-8 sm:mb-14 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="max-w-[16ch] animate-rise text-balance break-words text-display-lg font-extrabold">
          {f.q ? `“${f.q}”` : f.category || 'All pieces'}
        </h1>
        <div className="animate-rise [animation-delay:80ms]">
          <Suspense>
            <CatalogToolbar />
          </Suspense>
        </div>
      </div>
      <Suspense
        key={JSON.stringify(f)}
        fallback={
          <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-[13rem_minmax(0,1fr)] xl:gap-x-12">
            <div className="h-11 bg-secondary lg:hidden" />
            <div className="hidden lg:block" />
            <div className="mt-10 lg:mt-0">
              <ProductGridSkeleton count={9} />
            </div>
          </div>
        }
      >
        <Results f={f} />
      </Suspense>
    </div>
  );
}
