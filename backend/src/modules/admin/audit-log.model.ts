import { ROLES } from '@storefront/contracts';
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorEmail: { type: String, required: true },
    actorRole: { type: String, enum: ROLES, required: true },
    permissions: { type: [String], default: [] },
    method: { type: String, required: true },
    path: { type: String, required: true },
    status: { type: Number, required: true },
    targets: { type: [String], default: [] },
    summary: { type: String, required: true },
    changes: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actorId: 1, _id: -1 });
auditLogSchema.index({ targets: 1, _id: -1 });

export type AuditLogRecord = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId; createdAt: Date };

export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);
