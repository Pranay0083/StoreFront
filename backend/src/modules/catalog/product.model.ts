import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const sizeVariantSchema = new Schema({ size: { type: String, required: true }, stock: { type: Number, required: true } }, { _id: true });

const productSchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    compareAtPrice: { type: Number },
    images: { type: [String], default: [] },
    sizes: { type: [sizeVariantSchema], default: [] },
    featured: { type: Boolean, default: false },
    rating: { type: Number, default: 0 },
    numReviews: { type: Number, default: 0 },
    /** Sum of all review ratings, so the average can be maintained incrementally. */
    ratingSum: { type: Number },
  },
  { timestamps: true },
);

productSchema.index({ createdAt: -1, _id: -1 });
productSchema.index({ category: 1, createdAt: -1, _id: -1 });
productSchema.index({ featured: 1, createdAt: -1, _id: -1 });
productSchema.index({ price: 1, _id: 1 });
productSchema.index({ category: 1, price: 1, _id: 1 });
productSchema.index({ rating: -1, _id: -1 });
productSchema.index({ category: 1, rating: -1, _id: -1 });
productSchema.index({ title: 'text', description: 'text' });

export type ProductRecord = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

export const ProductModel = mongoose.model('Product', productSchema);
