import type { ProductSelector } from '@storefront/contracts';
import mongoose from 'mongoose';
import { ProductModel } from '../catalog/product.model';
import type { CatalogProduct } from '../pricing/pricing.ports';

export interface PieceQuery {
  /** A size must have at least this many units (clearance targets deep stock). Default 1. */
  minStock?: number;
  /** Only products listed before this moment (clearance targets long-listed pieces). */
  createdBefore?: Date;
}

/** What the offers read model needs from the catalogue: in-stock pieces a selector matches. */
export interface OfferCatalog {
  /** Cheapest first; an absent selector matches every product. */
  matching(selector: ProductSelector | undefined, limit: number, query?: PieceQuery): Promise<CatalogProduct[]>;
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

const PROJECTION = { slug: 1, title: 1, category: 1, price: 1, images: { $slice: 1 }, createdAt: 1, sizes: 1 } as const;

export function selectorFilter(selector: ProductSelector | undefined): Record<string, unknown> | null {
  if (!selector) return {};
  const or = [
    ...(selector.productIds?.length ? [{ _id: { $in: selector.productIds.filter(id => mongoose.isValidObjectId(id)) } }] : []),
    ...(selector.slugs?.length ? [{ slug: { $in: selector.slugs } }] : []),
    ...(selector.categories?.length ? [{ category: { $in: selector.categories } }] : []),
  ];
  return or.length ? { $or: or } : null;
}

/** Read-only adapter over the products collection, like the pricing module's own catalog port. */
export class MongoOfferCatalog implements OfferCatalog {
  async matching(selector: ProductSelector | undefined, limit: number, query: PieceQuery = {}): Promise<CatalogProduct[]> {
    const filter = selectorFilter(selector);
    if (!filter) return [];
    const rows = await ProductModel.find(
      {
        ...filter,
        sizes: { $elemMatch: { stock: { $gte: Math.max(1, query.minStock ?? 1) } } },
        ...(query.createdBefore && { createdAt: { $lte: query.createdBefore } }),
      },
      PROJECTION,
    )
      .sort({ price: 1, _id: 1 })
      .limit(limit)
      .lean<ProductRow[]>();
    return rows.map(p => ({
      id: String(p._id),
      slug: p.slug,
      title: p.title,
      category: p.category,
      price: p.price,
      ...(p.images?.[0] && { image: p.images[0] }),
      createdAt: p.createdAt,
      sizes: (p.sizes ?? []).map(s => ({ size: s.size, stock: s.stock })),
    }));
  }
}
