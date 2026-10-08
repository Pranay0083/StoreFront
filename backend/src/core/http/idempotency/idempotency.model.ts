import mongoose, { Schema } from 'mongoose';

export const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

export interface IdempotencyRecord {
  _id: string;
  requestHash: string;
  status: 'in_progress' | 'completed';
  responseStatus?: number;
  responseBody?: unknown;
  lockedAt: Date;
  createdAt: Date;
}

const idempotencySchema = new Schema<IdempotencyRecord>(
  {
    _id: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['in_progress', 'completed'], required: true },
    responseStatus: Number,
    responseBody: Schema.Types.Mixed,
    lockedAt: { type: Date, required: true },
    createdAt: { type: Date, required: true, default: Date.now, expires: IDEMPOTENCY_TTL_SECONDS },
  },
  { versionKey: false, minimize: false },
);

export const IdempotencyModel = mongoose.model<IdempotencyRecord>('IdempotencyKey', idempotencySchema, 'idempotencykeys');
