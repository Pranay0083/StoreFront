import { z } from 'zod';
import { PaiseSchema, type Paise } from './money';

export const PRODUCT_SORTS = ['price-asc', 'price-desc', 'newest', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const SizeVariantSchema = z.object({
  size: z.string({ required_error: 'Size name is required' }),
  stock: z.number({ required_error: 'Stock quantity is required' }).int('Stock must be a whole number').min(0, 'Stock cannot be negative'),
});
export type SizeVariant = z.infer<typeof SizeVariantSchema>;

export const ProductInputSchema = z
  .object({
    title: z.string({ required_error: 'Product title is required' }).min(2, 'Title must be at least 2 characters'),
    slug: z.string().min(2, 'Slug must be at least 2 characters').optional(),
    description: z.string().default(''),
    category: z.string({ required_error: 'Category is required' }).min(2, 'Category must be at least 2 characters'),
    price: PaiseSchema.positive('Price must be greater than 0'),
    compareAtPrice: PaiseSchema.positive('Compare at price must be greater than 0').optional().nullable(),
    images: z.array(z.string().url('Image must be a valid URL')).min(1, 'At least one image is required'),
    sizes: z.array(SizeVariantSchema).min(1, 'At least one size is required'),
    featured: z.boolean().default(false),
  })
  .strict();
export type ProductInput = z.infer<typeof ProductInputSchema>;

const optionalNumber = z.coerce.number().nonnegative().optional().catch(undefined);

export const ProductListQuerySchema = z.object({
  category: z.string().optional(),
  size: z.string().optional(),
  minPrice: optionalNumber,
  maxPrice: optionalNumber,
  q: z.string().max(200).optional(),
  sort: z.enum(PRODUCT_SORTS).optional().catch(undefined),
  featured: z
    .string()
    .optional()
    .transform(v => v === 'true'),
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform(n => Math.max(1, n)),
  limit: z.coerce
    .number()
    .int()
    .catch(24)
    .transform(n => Math.min(48, Math.max(1, n))),
  /** Opaque keyset cursor from a previous page's `nextCursor`; takes precedence over `page`. */
  cursor: z.string().max(512).optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export interface Product {
  _id: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  price: Paise;
  compareAtPrice?: Paise | null;
  images: string[];
  sizes: SizeVariant[];
  featured: boolean;
  rating: number;
  numReviews: number;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pages: number;
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface Category {
  name: string;
  count: number;
}

export const ReviewInputSchema = z
  .object({
    productId: z.string({ required_error: 'Product ID is required' }),
    rating: z
      .number({ required_error: 'Rating is required' })
      .int('Rating must be a whole number')
      .min(1, 'Minimum rating is 1')
      .max(5, 'Maximum rating is 5'),
    comment: z.string().max(1000, 'Comment cannot exceed 1000 characters').default(''),
  })
  .strict();
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export interface Review {
  _id: string;
  userName: string;
  rating: number;
  comment: string;
  verifiedPurchase: boolean;
  createdAt: string;
}
