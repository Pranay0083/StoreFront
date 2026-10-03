import { ROLES } from '@storefront/contracts';
import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'customer', required: true },
    sessionsValidAfter: Date,
  },
  { timestamps: true },
);

export type UserRecord = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const UserModel = mongoose.model('User', userSchema);
