import mongoose, { Schema } from 'mongoose';

const loginAttemptSchema = new Schema({
  identifier: { type: String, required: true, index: true },
  count: { type: Number, default: 0 },
  lockedUntil: Date,
}, { timestamps: true });

export const LoginAttempt = mongoose.model('LoginAttempt', loginAttemptSchema);
