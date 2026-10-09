import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const reviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: String,
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: '' },
    verifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true },
);

reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

export type ReviewRecord = InferSchemaType<typeof reviewSchema> & { _id: Types.ObjectId; createdAt: Date };

export const ReviewModel = mongoose.model('Review', reviewSchema);
