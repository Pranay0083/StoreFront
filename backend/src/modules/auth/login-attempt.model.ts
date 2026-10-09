import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const loginAttemptSchema = new Schema(
  {
    /** Throttle bucket, e.g. `ip:1.2.3.4|email:a@b.c`; a new field so it never clashes with the legacy identifier index. */
    key: { type: String, required: true, unique: true },
    failures: { type: Number, default: 0, required: true },
    lastFailureAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
);

loginAttemptSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export type LoginAttemptRecord = InferSchemaType<typeof loginAttemptSchema>;

export const LoginAttemptModel = mongoose.model('LoginAttempt', loginAttemptSchema);
