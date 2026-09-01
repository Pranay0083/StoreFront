import mongoose, { Schema } from 'mongoose';

const productSchema = new Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  compareAtPrice: { type: Number },
  images: { type: [String], default: [] },
  sizes: [{ size: String, stock: Number }],
  featured: { type: Boolean, default: false },
  rating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 },
}, { timestamps: true });

productSchema.index({ category: 1, price: 1 });
productSchema.index({ title: 'text', description: 'text' });

export const Product = mongoose.model('Product', productSchema);
