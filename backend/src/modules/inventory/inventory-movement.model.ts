import mongoose, { Schema, type Types } from 'mongoose';

export const MOVEMENT_TYPES = ['RESERVE', 'RELEASE', 'SALE', 'RESTOCK', 'RETURN', 'ADJUST'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * One immutable line in the stock ledger. `delta` is the effect on sellable stock, so the sum of
 * deltas for a variant always equals its current stock; `qty` is the number of units involved
 * (a SALE converts already-reserved units and therefore has delta 0).
 */
export interface InventoryMovementRecord {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  size: string;
  type: MovementType;
  qty: number;
  delta: number;
  orderId?: Types.ObjectId;
  actor: string;
  note?: string;
  createdAt: Date;
}

const movementSchema = new Schema<InventoryMovementRecord>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    size: { type: String, required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    qty: { type: Number, required: true },
    delta: { type: Number, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    actor: { type: String, required: true },
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

movementSchema.index({ productId: 1, size: 1, createdAt: -1 });
movementSchema.index({ orderId: 1 });

export const InventoryMovementModel = mongoose.model<InventoryMovementRecord>('InventoryMovement', movementSchema, 'inventorymovements');
