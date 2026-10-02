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
  },
  { timestamps: true },
);

productSchema.index({ category: 1, price: 1 });
productSchema.index({ title: 'text', description: 'text' });

export type ProductRecord = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

export const ProductModel = mongoose.model('Product', productSchema);
