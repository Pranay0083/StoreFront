import mongoose, { Schema } from 'mongoose';

const webhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  event: String,
  processedAt: { type: Date, default: Date.now },
});

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
