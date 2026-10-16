import type { PipelineStage } from 'mongoose';
import { ProductModel } from '../catalog/product.model';
import { ProductQueryBuilder } from '../catalog/product-query.builder';
import { escapeRegex, type FacetCount, type SearchHits, type SearchProvider, type SearchQuery, type Suggestion } from './search.provider';

interface FacetRow {
  items: Array<{ _id: unknown }>;
  total: Array<{ n: number }>;
  categories: Array<{ _id: string; count: number }>;
  sizes: Array<{ _id: string; count: number }>;
}

const toFacets = (rows: Array<{ _id: string; count: number }>): FacetCount[] => rows.map(r => ({ value: r._id, count: r.count }));

/** Default provider: Mongo `$text` with facet counts, falling back to a title regex when stemming finds nothing. */
export class MongoTextSearch implements SearchProvider {
  readonly name = 'mongo' as const;
  readonly requiresIndexing = false;

  async search(query: SearchQuery): Promise<SearchHits> {
    const text = await this.run(query, b => b.matchingText(query.q));
    if (text.total > 0 || !query.q.trim()) return text;
    return this.run(query, b => b.titleMatchingAnyWord(query.q));
  }

  async suggest(prefix: string, limit: number): Promise<Suggestion[]> {
    const term = prefix.trim();
    if (!term) return [];
    const rows = await ProductModel.find(
      { title: { $regex: `(^|\\s)${escapeRegex(term)}`, $options: 'i' } },
      { slug: 1, title: 1, category: 1, price: 1 },
    )
      .sort({ rating: -1, _id: 1 })
      .limit(limit)
      .lean<Suggestion[]>();
    return rows.map(r => ({ slug: r.slug, title: r.title, category: r.category, price: r.price }));
  }

  async index(): Promise<void> {}
  async remove(): Promise<void> {}
  async configure(): Promise<void> {}
  async ping(): Promise<boolean> {
    return true;
  }

  private async run(query: SearchQuery, match: (b: ProductQueryBuilder) => ProductQueryBuilder): Promise<SearchHits> {
    const builder = match(
      new ProductQueryBuilder()
        .inCategory(query.category)
        .withSizeInStock(query.size)
        .priceBetween(query.minPrice, query.maxPrice)
        .featuredOnly(query.featured),
    ).sortBy(query.sort);
    const { filter, sort } = builder.build();
    const relevance = !query.sort && '$text' in filter;
    const order = (relevance ? { score: { $meta: 'textScore' }, _id: 1 } : sort) as PipelineStage.Sort['$sort'];
    const [row] = await ProductModel.aggregate<FacetRow>([
      { $match: filter },
      {
        $facet: {
          items: [{ $sort: order }, { $skip: query.offset }, { $limit: query.limit }, { $project: { _id: 1 } }],
          total: [{ $count: 'n' }],
          categories: [{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }],
          sizes: [
            { $unwind: '$sizes' },
            { $match: { 'sizes.stock': { $gt: 0 } } },
            { $group: { _id: '$sizes.size', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);
    return {
      ids: row.items.map(i => String(i._id)),
      total: row.total[0]?.n ?? 0,
      facets: { categories: toFacets(row.categories), sizes: toFacets(row.sizes) },
    };
  }
}
