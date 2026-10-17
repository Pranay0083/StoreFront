import type { FacetCount, ProductSort, ProductSuggestion, SearchFacets } from '@storefront/contracts';
import type { ProductRecord } from '../catalog/product.model';

export interface SearchQuery {
  q: string;
  category?: string;
  size?: string;
  minPrice?: number;
  maxPrice?: number;
  featured?: boolean;
  /** Omitted = relevance. */
  sort?: ProductSort;
  limit: number;
  offset: number;
}

export type { FacetCount, SearchFacets };
export type Suggestion = ProductSuggestion;

export interface SearchHits {
  ids: string[];
  total: number;
  facets: SearchFacets;
}

/**
 * Strategy interface for product search. The Mongo implementation needs no index maintenance;
 * external engines report `requiresIndexing` so catalog and stock changes are synced to them.
 */
export interface SearchProvider {
  readonly name: 'mongo' | 'meilisearch';
  readonly requiresIndexing: boolean;
  search(query: SearchQuery): Promise<SearchHits>;
  suggest(prefix: string, limit: number): Promise<Suggestion[]>;
  index(products: ProductRecord[]): Promise<void>;
  remove(productIds: string[]): Promise<void>;
  /** Idempotent: creates the index and applies settings. */
  configure(): Promise<void>;
  ping(): Promise<boolean>;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
