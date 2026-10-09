import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

export const REVOKE_REASONS = ['logout', 'logout_all', 'reuse_detected', 'user_revoked'] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

/**
 * One refresh-token family per login. Only the SHA-256 fingerprint of the current token
 * (and the one it replaced) is stored, never the token itself.
 */
const authSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    currentHash: { type: String, required: true },
    previousHash: String,
    rotatedAt: Date,
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: { type: String, enum: REVOKE_REASONS },
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
);

authSessionSchema.index({ userId: 1, revokedAt: 1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthSessionRecord = InferSchemaType<typeof authSessionSchema> & { _id: Types.ObjectId; createdAt: Date };

export const AuthSessionModel = mongoose.model('AuthSession', authSessionSchema);
