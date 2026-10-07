import type { PriceBreakdown } from '@storefront/contracts';
import mongoose, { Schema } from 'mongoose';

const quoteSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, default: null },
    cartHash: { type: String, required: true },
    contentHash: { type: String, required: true },
    breakdown: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false, versionKey: false },
);

// TTL clean-up lags by up to a minute, so reads still check expiresAt themselves.
quoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface QuoteRecord {
  _id: string;
  userId: string | null;
  cartHash: string;
  contentHash: string;
  breakdown: PriceBreakdown;
  expiresAt: Date;
  createdAt: Date;
}

export const QuoteModel = mongoose.model('PricingQuote', quoteSchema, 'pricing_quotes');

export class QuoteRepository {
  async create(quote: Omit<QuoteRecord, 'createdAt'>): Promise<void> {
    await QuoteModel.create(quote);
  }

  findById(id: string): Promise<QuoteRecord | null> {
    return QuoteModel.findById(id).lean<QuoteRecord>();
  }
}
