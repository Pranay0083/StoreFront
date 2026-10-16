import mongoose, { Schema, type Types } from 'mongoose';

export const RESERVATION_STATUSES = ['active', 'committed', 'released', 'partially_returned', 'returned'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface ReservedLine {
  productId: Types.ObjectId;
  size: string;
  qty: number;
  /** Units of a sold line that have come back to stock through refunds. */
  returnedQty?: number;
}

export interface StockReservationRecord {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  items: ReservedLine[];
  status: ReservationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reservationSchema = new Schema<StockReservationRecord>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    items: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        size: { type: String, required: true },
        qty: { type: Number, required: true },
        returnedQty: { type: Number, default: 0 },
      },
    ],
    status: { type: String, enum: RESERVATION_STATUSES, default: 'active', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

reservationSchema.index({ status: 1, expiresAt: 1 });

export const StockReservationModel = mongoose.model<StockReservationRecord>('StockReservation', reservationSchema, 'stockreservations');
