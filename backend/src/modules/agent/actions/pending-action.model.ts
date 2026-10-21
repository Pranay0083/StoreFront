import mongoose, { Schema, type Types } from 'mongoose';

export const ACTION_TYPES = ['add_to_cart', 'cancel_order', 'request_refund'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = ['pending', 'executing', 'completed', 'declined', 'failed', 'expired'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface AddToCartPayload {
  productId: string;
  slug: string;
  title: string;
  size: string;
  qty: number;
}

export interface OrderActionPayload {
  orderId: string;
  orderNumber: string;
  reason?: string;
  lines?: Array<{ productId: string; size: string; qty: number }>;
}

export type ActionPayload = AddToCartPayload | OrderActionPayload;

export interface PendingActionRecord {
  _id: Types.ObjectId;
  type: ActionType;
  userId: Types.ObjectId;
  sessionId?: string;
  summary: string;
  payload: ActionPayload;
  status: ActionStatus;
  result?: Record<string, unknown>;
  error?: string;
  expiresAt: Date;
  /** Records are kept a while for the audit trail, then removed by a TTL index. */
  purgeAt: Date;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** What the model and the widget see: never the raw payload ids beyond what is needed to render. */
export interface PendingActionView {
  id: string;
  type: ActionType;
  summary: string;
  status: ActionStatus;
  expiresAt: string;
  result?: Record<string, unknown>;
  error?: string;
}

export const toView = (a: PendingActionRecord): PendingActionView => ({
  id: String(a._id),
  type: a.type,
  summary: a.summary,
  status: a.status === 'pending' && a.expiresAt.getTime() <= Date.now() ? 'expired' : a.status,
  expiresAt: a.expiresAt.toISOString(),
  ...(a.result ? { result: a.result } : {}),
  ...(a.error ? { error: a.error } : {}),
});

const pendingActionSchema = new Schema<PendingActionRecord>(
  {
    type: { type: String, enum: ACTION_TYPES, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: String,
    summary: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ACTION_STATUSES, default: 'pending' },
    result: Schema.Types.Mixed,
    error: String,
    expiresAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true },
    resolvedAt: Date,
  },
  { timestamps: true, minimize: false },
);

pendingActionSchema.index({ userId: 1, status: 1, createdAt: -1 });
pendingActionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const PendingActionModel = mongoose.model<PendingActionRecord>('AgentPendingAction', pendingActionSchema, 'agent_pending_actions');
