import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import type { Redis } from './redis';

export type PubSubHandler = (message: string) => void;

/** Fire-and-forget broadcast between processes (cache invalidation, relay wake-ups). Not durable. */
export interface PubSub {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: PubSubHandler): Promise<void>;
  close(): Promise<void>;
}

export class LocalPubSub implements PubSub {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  async publish(channel: string, message: string): Promise<void> {
    queueMicrotask(() => this.emitter.emit(channel, message));
  }

  async subscribe(channel: string, handler: PubSubHandler): Promise<void> {
    this.emitter.on(channel, handler);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

/** Redis needs a dedicated connection in subscriber mode, so this owns a duplicate of the given client. */
export class RedisPubSub implements PubSub {
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, PubSubHandler[]>();

  constructor(
    private readonly publisher: Redis,
    private readonly logger: Logger,
  ) {
    this.subscriber = publisher.duplicate();
    this.subscriber.on('message', (channel: string, message: string) => {
      for (const handler of this.handlers.get(channel) ?? []) {
        try {
          handler(message);
        } catch (err) {
          this.logger.error({ err, channel }, 'Pub/sub handler failed');
        }
      }
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, handler: PubSubHandler): Promise<void> {
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.push(handler);
      return;
    }
    this.handlers.set(channel, [handler]);
    await this.subscriber.subscribe(channel);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await this.subscriber.quit().catch(() => undefined);
  }
}
