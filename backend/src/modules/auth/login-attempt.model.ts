import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const loginAttemptSchema = new Schema(
  {
    identifier: { type: String, required: true, index: true },
    count: { type: Number, default: 0, required: true },
    lockedUntil: Date,
  },
  { timestamps: true },
);

export type LoginAttemptRecord = InferSchemaType<typeof loginAttemptSchema>;

export const LoginAttemptModel = mongoose.model('LoginAttempt', loginAttemptSchema);
