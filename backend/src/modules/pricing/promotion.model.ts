import { PROMOTION_ACTIVATIONS, PROMOTION_STATUSES, type ActionSpec, type ConditionSpec } from '@storefront/contracts';
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const promotionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: PROMOTION_STATUSES, default: 'draft', required: true },
    activation: { type: String, enum: PROMOTION_ACTIVATIONS, default: 'auto', required: true },
    code: { type: String, uppercase: true, trim: true },
    priority: { type: Number, default: 100, required: true },
    stackGroup: { type: String },
    exclusive: { type: Boolean, default: false, required: true },
    conditions: { type: Schema.Types.Mixed },
    action: { type: Schema.Types.Mixed, required: true },
    startsAt: { type: Date },
    endsAt: { type: Date },
    usageLimit: { type: Number },
    usedCount: { type: Number, default: 0, required: true },
    version: { type: Number, default: 1, required: true },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true, minimize: false },
);

promotionSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });
promotionSchema.index({ status: 1, priority: -1 });

export type PromotionRecord = Omit<InferSchemaType<typeof promotionSchema>, 'action' | 'conditions'> & {
  _id: Types.ObjectId;
  action: ActionSpec;
  conditions?: ConditionSpec | null;
  createdAt: Date;
  updatedAt: Date;
};

export const PromotionModel = mongoose.model('Promotion', promotionSchema, 'promotions');

/** Immutable snapshot of every promotion version, so any priced order can be explained later. */
const promotionVersionSchema = new Schema(
  {
    promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion', required: true },
    version: { type: Number, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    changedBy: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

promotionVersionSchema.index({ promotionId: 1, version: 1 }, { unique: true });

export type PromotionVersionRecord = InferSchemaType<typeof promotionVersionSchema> & { _id: Types.ObjectId; createdAt: Date };

export const PromotionVersionModel = mongoose.model('PromotionVersion', promotionVersionSchema, 'promotion_versions');
