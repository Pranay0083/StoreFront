import { WebhookEventModel } from './webhook-event.model';

const DUPLICATE_KEY = 11000;

export class WebhookEventRepository {
  /** Returns false when the event was already recorded (unique index on eventId). */
  async recordOnce(eventId: string, event?: string): Promise<boolean> {
    try {
      await WebhookEventModel.create({ eventId, event });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === DUPLICATE_KEY) return false;
      throw e;
    }
  }

  async forget(eventId: string): Promise<void> {
    await WebhookEventModel.deleteOne({ eventId });
  }
}
