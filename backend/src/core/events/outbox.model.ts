import mongoose, { Schema } from 'mongoose';

export const OUTBOX_STATUSES = ['pending', 'processing', 'done', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxRecord {
  _id: string;
  name: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil?: Date;
  handlersDone: string[];
  lastError?: string;
  processedAt?: Date;
}

const outboxSchema = new Schema<OutboxRecord>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    aggregateId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    occurredAt: { type: Date, required: true },
    status: { type: String, enum: OUTBOX_STATUSES, default: 'pending', required: true },
    attempts: { type: Number, default: 0, required: true },
    nextAttemptAt: { type: Date, required: true },
    lockedUntil: Date,
    handlersDone: { type: [String], default: [] },
    lastError: String,
    processedAt: Date,
  },
  { versionKey: false, minimize: false },
);

outboxSchema.index({ status: 1, nextAttemptAt: 1 });
outboxSchema.index({ aggregateId: 1, occurredAt: 1 });
outboxSchema.index({ processedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600, partialFilterExpression: { status: 'done' } });

export const OutboxModel = mongoose.model<OutboxRecord>('OutboxEvent', outboxSchema, 'outbox');
