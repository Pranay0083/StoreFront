import { REVENUE_STATUSES } from '@storefront/contracts';
import mongoose, { Schema, Types } from 'mongoose';
import type { Logger } from 'pino';
import { CacheNamespace, type CacheObserver, type CacheProvider } from '../../core/cache/cache';
import { NotFoundError } from '../../core/errors';
import type { EventBus } from '../../core/events/event-bus';
import type { JobQueue } from '../../core/queue/job-queue';
import { ProductModel } from '../catalog/product.model';
import { OrderModel } from '../orders/order.model';
import { DEFAULT_THRESHOLDS, mineAssociations, type Association, type AssociationThresholds } from './association';

export const REBUILD_RECOMMENDATIONS_JOB = 'recommendations.rebuild';

interface RecommendationRecord {
  _id: string;
  items: Association[];
  computedAt: Date;
}

const recommendationSchema = new Schema<RecommendationRecord>(
  {
    _id: { type: String, required: true },
    items: [{ _id: false, productId: String, pairCount: Number, support: Number, confidence: Number, lift: Number }],
    computedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
recommendationSchema.index({ computedAt: 1 });
export const RecommendationModel = mongoose.model<RecommendationRecord>('Recommendation', recommendationSchema, 'recommendations');

export type RecommendationSource = 'frequently-bought-together' | 'category-bestsellers';

export interface RecommendedProduct {
  _id: string;
  title: string;
  slug: string;
  price: number;
  compareAtPrice?: number | null;
  images: string[];
  category: string;
  rating: number;
  numReviews: number;
  score?: { confidence: number; lift: number; pairCount: number };
}

export interface Recommendations {
  productId: string;
  source: RecommendationSource;
  items: RecommendedProduct[];
}

export interface RebuildStats {
  orders: number;
  products: number;
  rules: number;
  durationMs: number;
}

type ProductRow = RecommendedProduct & { sizes: Array<{ stock: number }> };

const SUMMARY_FIELDS = { title: 1, slug: 1, price: 1, compareAtPrice: 1, images: 1, category: 1, rating: 1, numReviews: 1, sizes: 1 };
const inStock = (p: { sizes?: Array<{ stock: number }> }) => (p.sizes ?? []).some(s => s.stock > 0);
/** Larger than the biggest page (12) plus the product itself. */
const BESTSELLER_POOL = 24;

export class RecommendationsService {
  private readonly cache: CacheNamespace;

  constructor(
    cache: CacheProvider,
    private readonly logger: Logger,
    private readonly options: { rebuildIntervalMs: number; lookbackDays: number; thresholds?: AssociationThresholds },
    observer?: CacheObserver,
  ) {
    this.cache = new CacheNamespace(cache, 'recommendations', 600, observer);
  }

  register(jobs: JobQueue, eventBus: EventBus): void {
    jobs.register({
      name: REBUILD_RECOMMENDATIONS_JOB,
      queue: 'maintenance',
      attempts: 2,
      handler: () => this.rebuild().then(() => undefined),
    });
    eventBus.subscribe('ProductChanged', 'recommendations.invalidate', async () => this.cache.invalidate());
  }

  start(jobs: JobQueue): void {
    jobs
      .schedule(REBUILD_RECOMMENDATIONS_JOB, {}, { everyMs: this.options.rebuildIntervalMs })
      .catch(err => this.logger.error({ err }, 'Could not schedule the recommendations rebuild'));
    jobs
      .enqueue(REBUILD_RECOMMENDATIONS_JOB, {}, { jobId: `recommendations-boot-${Math.floor(Date.now() / 3_600_000)}` })
      .catch(err => this.logger.error({ err }, 'Could not queue the initial recommendations rebuild'));
  }

  async rebuild(now = new Date()): Promise<RebuildStats> {
    const started = performance.now();
    const since = new Date(now.getTime() - this.options.lookbackDays * 86_400_000);
    const baskets: string[][] = [];
    const cursor = OrderModel.find({ status: { $in: REVENUE_STATUSES }, paidAt: { $gte: since } }, { 'items.productId': 1 })
      .lean()
      .cursor();
    for await (const order of cursor) baskets.push(order.items.map(i => String(i.productId)));

    const rules = mineAssociations(baskets, this.options.thresholds ?? DEFAULT_THRESHOLDS);
    const ops = [...rules].map(([productId, items]) => ({
      replaceOne: { filter: { _id: productId }, replacement: { _id: productId, items, computedAt: now }, upsert: true },
    }));
    if (ops.length) await RecommendationModel.bulkWrite(ops, { ordered: false });
    await RecommendationModel.deleteMany({ computedAt: { $lt: now } });
    await this.cache.invalidate();

    const stats = {
      orders: baskets.length,
      products: rules.size,
      rules: [...rules.values()].reduce((s, r) => s + r.length, 0),
      durationMs: Math.round(performance.now() - started),
    };
    this.logger.info(stats, 'Rebuilt frequently-bought-together recommendations');
    return stats;
  }

  forProduct(productId: string, limit = 4): Promise<Recommendations> {
    return this.cache.getOrLoad(`${productId}:${limit}`, () => this.load(productId, limit));
  }

  private async load(productId: string, limit: number): Promise<Recommendations> {
    const product = await ProductModel.findById(productId, { category: 1 }).lean<{ _id: Types.ObjectId; category: string }>();
    if (!product) throw new NotFoundError('Product not found');

    const record = await RecommendationModel.findById(productId).lean<RecommendationRecord>();
    if (record?.items.length) {
      const ids = record.items.map(i => new Types.ObjectId(i.productId));
      const products = await ProductModel.find({ _id: { $in: ids } }, SUMMARY_FIELDS).lean<ProductRow[]>();
      const byId = new Map(products.filter(inStock).map(p => [String(p._id), p]));
      const items = record.items
        .filter(i => byId.has(i.productId))
        .slice(0, limit)
        .map(i => ({ ...this.summary(byId.get(i.productId)!), score: { confidence: i.confidence, lift: i.lift, pairCount: i.pairCount } }));
      if (items.length) return { productId, source: 'frequently-bought-together', items };
    }
    return { productId, source: 'category-bestsellers', items: await this.categoryBestsellers(product, limit) };
  }

  private async categoryBestsellers(product: { _id: Types.ObjectId; category: string }, limit: number): Promise<RecommendedProduct[]> {
    const pool = await this.cache.getOrLoad(`bestsellers:${product.category}`, () => this.rankCategory(product.category));
    return pool.filter(p => p._id !== String(product._id)).slice(0, limit);
  }

  /**
   * A bounded, per-category ranking shared by every product in the category: best sellers first,
   * then top-rated. Only the candidates are loaded, never the whole category.
   */
  private async rankCategory(category: string): Promise<RecommendedProduct[]> {
    const sold = await OrderModel.aggregate<{ _id: Types.ObjectId; units: number }>([
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', units: { $sum: '$items.qty' } } },
      { $sort: { units: -1 } },
      { $limit: 200 },
    ]);
    const rank = new Map(sold.map((s, i) => [String(s._id), i]));
    const [bestSellers, topRated] = await Promise.all([
      ProductModel.find({ category, _id: { $in: sold.map(s => s._id) } }, SUMMARY_FIELDS).lean<ProductRow[]>(),
      ProductModel.find({ category }, SUMMARY_FIELDS).sort({ rating: -1, _id: -1 }).limit(BESTSELLER_POOL).lean<ProductRow[]>(),
    ]);
    const candidates = new Map([...bestSellers, ...topRated].map(p => [String(p._id), p]));
    return [...candidates.values()]
      .filter(inStock)
      .sort((a, b) => (rank.get(String(a._id)) ?? Infinity) - (rank.get(String(b._id)) ?? Infinity) || b.rating - a.rating)
      .slice(0, BESTSELLER_POOL)
      .map(p => this.summary(p));
  }

  private summary(p: RecommendedProduct): RecommendedProduct {
    return {
      _id: String(p._id),
      title: p.title,
      slug: p.slug,
      price: p.price,
      compareAtPrice: p.compareAtPrice ?? null,
      images: p.images,
      category: p.category,
      rating: p.rating,
      numReviews: p.numReviews,
    };
  }
}
