import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const cartItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    title: String,
    image: String,
    price: Number,
    size: { type: String, required: true },
    qty: { type: Number, required: true },
    slug: String,
  },
  { _id: true },
);

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);

export type CartRecord = InferSchemaType<typeof cartSchema> & { _id: Types.ObjectId };

export const CartModel = mongoose.model('Cart', cartSchema);
