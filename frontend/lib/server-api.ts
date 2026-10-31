import type { BundleOffer, Category, OffersResponse, Product, ProductListResponse, Review } from '@storefront/contracts';

const BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || '';

/** Cached for this long unless the API revalidates the tag sooner (see app/api/revalidate). */
export const CATALOG_REVALIDATE_SECONDS = 300;

/**
 * Offers start and stop on a schedule; the API revalidates the tag at each start and end, and this
 * shorter backstop bounds a missed call.
 */
export const OFFERS_REVALIDATE_SECONDS = 120;

export const tags = {
  products: 'products',
  offers: 'offers',
  product: (slug: string) => `product:${slug}`,
  productId: (id: string) => `product-id:${id}`,
};

export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string, cacheTags: string[], revalidate = CATALOG_REVALIDATE_SECONDS): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, { next: { revalidate, tags: cacheTags } });
  if (!res.ok) throw new ServerApiError(`GET ${path} failed with ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (e) {
    if (e instanceof ServerApiError && e.status === 404) return null;
    throw e;
  }
}

export type Recommendation = Pick<
  Product,
  '_id' | 'title' | 'slug' | 'price' | 'compareAtPrice' | 'images' | 'category' | 'rating' | 'numReviews'
> & {
  score?: { confidence: number; lift: number; pairCount: number };
};

export const serverApi = {
  products: (query: URLSearchParams) => get<ProductListResponse>(`/products?${query.toString()}`, [tags.products]),
  featured: () => get<ProductListResponse>('/products?featured=true&limit=8', [tags.products]),
  categories: () => get<Category[]>('/products/categories', [tags.products]),
  product: (slug: string) => orNull(get<Product>(`/products/${encodeURIComponent(slug)}`, [tags.product(slug)])),
  reviews: (productId: string) => get<Review[]>(`/reviews/product/${productId}`, [tags.productId(productId)]),
  bundles: (productId: string) =>
    get<{ productId: string; offers: BundleOffer[] }>(`/pricing/products/${productId}/bundles`, [
      tags.productId(productId),
      tags.products,
      tags.offers,
    ]),
  /** Live, advertised offers with their pieces and worked examples (the offers read model). */
  offers: () => get<OffersResponse>('/offers', [tags.offers], OFFERS_REVALIDATE_SECONDS),
  /** Never throws: a page renders without offers when the API cannot be reached. */
  offersOrNone: (): Promise<Pick<OffersResponse, 'offers'>> => serverApi.offers().catch(() => ({ offers: [] })),
  recommendations: (productId: string) =>
    get<{ productId: string; source: string; items: Recommendation[] }>(`/products/${productId}/recommendations?limit=4`, [
      tags.productId(productId),
      tags.products,
    ]),
  /** Every product slug, walking the keyset cursor; used by the sitemap. */
  async allProducts(): Promise<Product[]> {
    const all: Product[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams({ limit: '48', sort: 'newest' });
      if (cursor) q.set('cursor', cursor);
      const page = await this.products(q);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && all.length < 5_000);
    return all;
  },
};
