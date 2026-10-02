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

  async setRating(id: string, rating: number, numReviews: number): Promise<void> {
    await ProductModel.updateOne({ _id: id }, { $set: { rating, numReviews } });
  }

  async adjustStock(productId: string, size: string, delta: number): Promise<void> {
    await ProductModel.updateOne({ _id: productId, 'sizes.size': size }, { $inc: { 'sizes.$.stock': delta } });
  }
}
