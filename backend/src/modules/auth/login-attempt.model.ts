import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const loginAttemptSchema = new Schema(
  {
    identifier: { type: String, required: true, unique: true },
    failures: { type: Number, default: 0, required: true },
    lastFailureAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
);

loginAttemptSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export type LoginAttemptRecord = InferSchemaType<typeof loginAttemptSchema>;

export const LoginAttemptModel = mongoose.model('LoginAttempt', loginAttemptSchema);
