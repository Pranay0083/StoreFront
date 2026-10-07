import { REVENUE_STATUSES, type Paise, type ProductSelector } from '@storefront/contracts';
import mongoose from 'mongoose';
import { ProductModel } from '../catalog/product.model';
import { OrderModel } from '../orders/order.model';

export interface CatalogProduct {
  id: string;
  slug: string;
  title: string;
  category: string;
  price: Paise;
  image?: string;
  createdAt: Date;
  sizes: Array<{ size: string; stock: number }>;
}

/** What pricing needs from the catalog. Prices always come from here, never from the client. */
export interface PricingCatalog {
  findByIds(ids: readonly string[]): Promise<CatalogProduct[]>;
  /** Cheapest in-stock products matching any of the selectors. */
  findMatching(selectors: readonly ProductSelector[], limit: number): Promise<CatalogProduct[]>;
}

export interface CustomerHistory {
  completedOrderCount(userId: string): Promise<number>;
}

interface ProductRow {
  _id: mongoose.Types.ObjectId;
  slug: string;
  title: string;
  category: string;
  price: number;
  images?: string[];
  createdAt: Date;
  sizes?: Array<{ size: string; stock: number }>;
}

const toCatalogProduct = (p: ProductRow): CatalogProduct => ({
  id: String(p._id),
  slug: p.slug,
  title: p.title,
  category: p.category,
  price: p.price,
  ...(p.images?.[0] && { image: p.images[0] }),
  createdAt: p.createdAt,
  sizes: (p.sizes ?? []).map(s => ({ size: s.size, stock: s.stock })),
});

const PROJECTION = { slug: 1, title: 1, category: 1, price: 1, images: { $slice: 1 }, createdAt: 1, sizes: 1 } as const;

/** Read-only adapter over the catalog collection. */
export class MongoPricingCatalog implements PricingCatalog {
  async findByIds(ids: readonly string[]): Promise<CatalogProduct[]> {
    const valid = ids.filter(id => mongoose.isValidObjectId(id));
    if (!valid.length) return [];
    const rows = await ProductModel.find({ _id: { $in: valid } }, PROJECTION).lean<ProductRow[]>();
    return rows.map(toCatalogProduct);
  }

  async findMatching(selectors: readonly ProductSelector[], limit: number): Promise<CatalogProduct[]> {
    const or = selectors.flatMap(s => [
      ...(s.productIds?.length ? [{ _id: { $in: s.productIds.filter(id => mongoose.isValidObjectId(id)) } }] : []),
      ...(s.slugs?.length ? [{ slug: { $in: s.slugs } }] : []),
      ...(s.categories?.length ? [{ category: { $in: s.categories } }] : []),
    ]);
    if (!or.length) return [];
    const rows = await ProductModel.find({ $or: or, 'sizes.stock': { $gt: 0 } }, PROJECTION)
      .sort({ price: 1, _id: 1 })
      .limit(limit)
      .lean<ProductRow[]>();
    return rows.map(toCatalogProduct);
  }
}

const COMPLETED_STATUSES = [...REVENUE_STATUSES, 'refunded'];

export class MongoCustomerHistory implements CustomerHistory {
  completedOrderCount(userId: string): Promise<number> {
    if (!mongoose.isValidObjectId(userId)) return Promise.resolve(0);
    return OrderModel.countDocuments({ userId, status: { $in: COMPLETED_STATUSES } });
  }
}
