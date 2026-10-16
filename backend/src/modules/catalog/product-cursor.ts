import type { ProductSort } from '@storefront/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { BadRequestError } from '../../core/errors';
import type { ProductRecord } from './product.model';

export const SORT_FIELDS: Record<ProductSort, { field: 'price' | 'createdAt' | 'rating'; direction: 1 | -1 }> = {
  'price-asc': { field: 'price', direction: 1 },
  'price-desc': { field: 'price', direction: -1 },
  newest: { field: 'createdAt', direction: -1 },
  rating: { field: 'rating', direction: -1 },
};

interface CursorPayload {
  s: ProductSort;
  v: number | string;
  id: string;
}

/** Opaque keyset cursor: the sort key and _id of the last item seen, bound to the sort it came from. */
export function encodeCursor(sort: ProductSort, product: Pick<ProductRecord, '_id' | 'price' | 'createdAt' | 'rating'>): string {
  const { field } = SORT_FIELDS[sort];
  const raw = product[field];
  const v = raw instanceof Date ? raw.toISOString() : Number(raw ?? 0);
  return Buffer.from(JSON.stringify({ s: sort, v, id: String(product._id) } satisfies CursorPayload)).toString('base64url');
}

export function decodeCursor(cursor: string, sort: ProductSort): CursorPayload {
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    throw new BadRequestError('Invalid cursor');
  }
  if (payload?.s !== sort || !Types.ObjectId.isValid(payload.id) || (typeof payload.v !== 'number' && typeof payload.v !== 'string')) {
    throw new BadRequestError('Invalid cursor for this sort order');
  }
  return payload;
}

/** Rows strictly after the cursor in (sortField, _id) order; stable even when sort values tie. */
export function keysetFilter(payload: CursorPayload): FilterQuery<ProductRecord> {
  const { field, direction } = SORT_FIELDS[payload.s];
  const op = direction === 1 ? '$gt' : '$lt';
  const value = field === 'createdAt' ? new Date(payload.v) : payload.v;
  const id = new Types.ObjectId(payload.id);
  return { $or: [{ [field]: { [op]: value } }, { [field]: value, _id: { [op]: id } }] };
}
