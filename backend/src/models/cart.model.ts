import mongoose, { Schema } from 'mongoose';

const cartSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  items: [{
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    title: String, image: String, price: Number, size: String, qty: Number, slug: String,
  }],
}, { timestamps: true });

export const Cart = mongoose.model('Cart', cartSchema);
