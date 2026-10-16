import type { ProductSort } from '@storefront/contracts';
import { Meilisearch, type Index } from 'meilisearch';
import type { ProductRecord } from '../catalog/product.model';
import type { FacetCount, SearchHits, SearchProvider, SearchQuery, Suggestion } from './search.provider';

export interface ProductDocument {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  price: number;
  rating: number;
  featured: boolean;
  sizesInStock: string[];
  createdAtTs: number;
  image?: string;
}

const SORTS: Record<ProductSort, string> = {
  'price-asc': 'price:asc',
  'price-desc': 'price:desc',
  newest: 'createdAtTs:desc',
  rating: 'rating:desc',
};

const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function toDocument(p: ProductRecord): ProductDocument {
  return {
    id: String(p._id),
    slug: p.slug,
    title: p.title,
    description: p.description ?? '',
    category: p.category,
    price: p.price,
    rating: p.rating ?? 0,
    featured: Boolean(p.featured),
    sizesInStock: (p.sizes ?? []).filter(s => (s.stock ?? 0) > 0).map(s => String(s.size)),
    createdAtTs: p.createdAt ? new Date(p.createdAt).getTime() : 0,
    ...(p.images?.[0] && { image: p.images[0] }),
  };
}

const facetCounts = (distribution: Record<string, number> | undefined): FacetCount[] =>
  Object.entries(distribution ?? {})
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

/** Meilisearch provider: typo-tolerant relevance, prefix search for autocomplete, native facet counts. */
export class MeilisearchProvider implements SearchProvider {
  readonly name = 'meilisearch' as const;
  readonly requiresIndexing = true;
  private readonly client: Meilisearch;
  private readonly index_: Index<ProductDocument>;

  constructor(
    config: { host: string; apiKey?: string },
    private readonly indexUid = 'storefront_products',
    private readonly waitForTasks = false,
  ) {
    this.client = new Meilisearch({ host: config.host, ...(config.apiKey && { apiKey: config.apiKey }) });
    this.index_ = this.client.index<ProductDocument>(indexUid);
  }

  async configure(): Promise<void> {
    await this.client.createIndex(this.indexUid, { primaryKey: 'id' }).waitTask();
    await this.index_
      .updateSettings({
        searchableAttributes: ['title', 'category', 'description'],
        filterableAttributes: ['category', 'sizesInStock', 'price', 'featured'],
        sortableAttributes: ['price', 'createdAtTs', 'rating'],
        rankingRules: ['sort', 'words', 'typo', 'proximity', 'attribute', 'exactness'],
        displayedAttributes: ['id', 'slug', 'title', 'category', 'price'],
        typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
      })
      .waitTask();
  }

  async search(query: SearchQuery): Promise<SearchHits> {
    const filter: string[] = [];
    if (query.category) filter.push(`category = ${quote(query.category)}`);
    if (query.size) filter.push(`sizesInStock = ${quote(query.size)}`);
    if (query.minPrice) filter.push(`price >= ${Number(query.minPrice)}`);
    if (query.maxPrice) filter.push(`price <= ${Number(query.maxPrice)}`);
    if (query.featured) filter.push('featured = true');
    const res = await this.index_.search(query.q, {
      filter,
      limit: query.limit,
      offset: query.offset,
      facets: ['category', 'sizesInStock'],
      attributesToRetrieve: ['id'],
      ...(query.sort && { sort: [SORTS[query.sort]] }),
    });
    return {
      ids: res.hits.map(h => h.id),
      total: res.estimatedTotalHits ?? res.hits.length,
      facets: { categories: facetCounts(res.facetDistribution?.category), sizes: facetCounts(res.facetDistribution?.sizesInStock) },
    };
  }

  async suggest(prefix: string, limit: number): Promise<Suggestion[]> {
    if (!prefix.trim()) return [];
    const res = await this.index_.search(prefix, { limit, attributesToRetrieve: ['slug', 'title', 'category', 'price'] });
    return res.hits.map(h => ({ slug: h.slug, title: h.title, category: h.category, price: h.price }));
  }

  async index(products: ProductRecord[]): Promise<void> {
    if (!products.length) return;
    const task = this.index_.addDocuments(products.map(toDocument), { primaryKey: 'id' });
    if (this.waitForTasks) await task.waitTask();
    else await task;
  }

  async remove(productIds: string[]): Promise<void> {
    if (!productIds.length) return;
    const task = this.index_.deleteDocuments(productIds);
    if (this.waitForTasks) await task.waitTask();
    else await task;
  }

  ping(): Promise<boolean> {
    return this.client.isHealthy();
  }
}
