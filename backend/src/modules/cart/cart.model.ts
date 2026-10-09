import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const cartLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    size: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    items: { type: [cartLineSchema], default: [] },
  },
  { timestamps: true },
);

export type CartRecord = InferSchemaType<typeof cartSchema> & { _id: Types.ObjectId };

export const CartModel = mongoose.model('Cart', cartSchema);
