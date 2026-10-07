import type { Category, ProductInput } from '@storefront/contracts';
import type { FilterQuery } from 'mongoose';
import { ProductModel, type ProductRecord } from './product.model';
import type { ProductQuery } from './product-query.builder';

export interface LowStockRow {
  _id: string;
  title: string;
  slug: string;
  image?: string;
  size: string;
  stock: number;
}

export class ProductRepository {
  find(q: ProductQuery): Promise<ProductRecord[]> {
    return ProductModel.find(q.filter).sort(q.sort).skip(q.skip).limit(q.limit).lean<ProductRecord[]>();
  }

  count(filter: FilterQuery<ProductRecord>): Promise<number> {
    return ProductModel.countDocuments(filter);
  }

  findById(id: string): Promise<ProductRecord | null> {
    return ProductModel.findById(id).lean<ProductRecord>();
  }

  findManyByIds(ids: string[]): Promise<ProductRecord[]> {
    return ProductModel.find({ _id: { $in: ids } }).lean<ProductRecord[]>();
  }

  findBySlug(slug: string): Promise<ProductRecord | null> {
    return ProductModel.findOne({ slug }).lean<ProductRecord>();
  }

  async existsBySlug(slug: string): Promise<boolean> {
    return (await ProductModel.exists({ slug })) !== null;
  }

  async create(input: ProductInput & { slug: string }): Promise<ProductRecord> {
    const doc = await ProductModel.create(input);
    return doc.toObject() as ProductRecord;
  }

  update(id: string, patch: Partial<ProductInput>): Promise<ProductRecord | null> {
    return ProductModel.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).lean<ProductRecord>();
  }

  async delete(id: string): Promise<boolean> {
    return (await ProductModel.findByIdAndDelete(id)) !== null;
  }

  async categoryCounts(): Promise<Category[]> {
    const rows = await ProductModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return rows.map(r => ({ name: r._id, count: r.count }));
  }

  lowStock(threshold: number, limit = 12): Promise<LowStockRow[]> {
    return ProductModel.aggregate<LowStockRow>([
      { $unwind: '$sizes' },
      { $match: { 'sizes.stock': { $lt: threshold } } },
      { $project: { title: 1, slug: 1, image: { $arrayElemAt: ['$images', 0] }, size: '$sizes.size', stock: '$sizes.stock' } },
      { $sort: { stock: 1 } },
      { $limit: limit },
    ]);
  }

  /**
   * Adjusts the rating aggregate in one atomic document update, so concurrent reviews never
   * overwrite each other. Products created before `ratingSum` existed seed it from rating × count.
   */
  async applyRatingDelta(id: string, sumDelta: number, countDelta: number): Promise<{ rating: number; numReviews: number }> {
    const sum = { $ifNull: ['$ratingSum', { $multiply: [{ $ifNull: ['$rating', 0] }, { $ifNull: ['$numReviews', 0] }] }] };
    const updated = await ProductModel.findOneAndUpdate(
      { _id: id },
      [
        { $set: { ratingSum: { $add: [sum, sumDelta] }, numReviews: { $add: [{ $ifNull: ['$numReviews', 0] }, countDelta] } } },
        {
          $set: {
            rating: { $cond: [{ $gt: ['$numReviews', 0] }, { $round: [{ $divide: ['$ratingSum', '$numReviews'] }, 1] }, 0] },
          },
        },
      ],
      { new: true, projection: { rating: 1, numReviews: 1 } },
    ).lean<{ rating: number; numReviews: number }>();
    return { rating: updated?.rating ?? 0, numReviews: updated?.numReviews ?? 0 };
  }

  async adjustStock(productId: string, size: string, delta: number): Promise<void> {
    await ProductModel.updateOne({ _id: productId, 'sizes.size': size }, { $inc: { 'sizes.$.stock': delta } });
  }
}
