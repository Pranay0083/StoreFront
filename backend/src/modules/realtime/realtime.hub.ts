import type { Logger } from 'pino';
import type { PubSub } from '../../core/pubsub';

export const REALTIME_PUBSUB_CHANNEL = 'realtime:events';

export interface RealtimeMessage {
  /** `<epoch ms>-<seq>`, assigned by the publishing process so every instance replays the same ids. */
  id: string;
  channel: string;
  event: string;
  data: unknown;
}

export interface RealtimeClient {
  write(chunk: string): void;
  end(): void;
}

interface Subscriber {
  client: RealtimeClient;
  channels: Set<string>;
  detach?: () => void;
}

const parseId = (id: string): [number, number] | null => {
  const m = /^(\d+)-(\d+)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

const isAfter = (id: string, after: [number, number]) => {
  const parsed = parseId(id);
  return !!parsed && (parsed[0] > after[0] || (parsed[0] === after[0] && parsed[1] > after[1]));
};

export const formatSse = (m: RealtimeMessage) =>
  `id: ${m.id}\nevent: ${m.event}\ndata: ${JSON.stringify({ channel: m.channel, ...((m.data as object) ?? {}) })}\n\n`;

/**
 * Fan-out hub for Server-Sent Events. Publishing goes through pub/sub so a message raised in any
 * process (API or worker) reaches clients connected to every API instance; each instance keeps a
 * short per-channel replay buffer so reconnecting clients resume from Last-Event-ID.
 */
export class RealtimeHub {
  private readonly subscribers = new Set<Subscriber>();
  private readonly buffers = new Map<string, RealtimeMessage[]>();
  private seq = 0;
  private listening?: Promise<void>;

  constructor(
    private readonly pubsub: PubSub,
    private readonly logger: Logger,
    private readonly options: { bufferSize: number; heartbeatMs: number } = { bufferSize: 100, heartbeatMs: 25_000 },
  ) {}

  /** Subscribes this instance to the shared channel; idempotent. */
  listen(): Promise<void> {
    this.listening ??= this.pubsub.subscribe(REALTIME_PUBSUB_CHANNEL, raw => {
      try {
        this.deliver(JSON.parse(raw) as RealtimeMessage);
      } catch (err) {
        this.logger.warn({ err }, 'Dropped a malformed realtime message');
      }
    });
    return this.listening;
  }

  async publish(channel: string, event: string, data: unknown): Promise<void> {
    const message: RealtimeMessage = { id: `${Date.now()}-${this.seq++}`, channel, event, data };
    await this.pubsub.publish(REALTIME_PUBSUB_CHANNEL, JSON.stringify(message));
  }

  get connections(): number {
    return this.subscribers.size;
  }

  /** Attaches a client, replays anything it missed since `lastEventId`, and returns a detach function. */
  attach(client: RealtimeClient, channels: string[], lastEventId?: string): () => void {
    const subscriber: Subscriber = { client, channels: new Set(channels) };
    client.write(`retry: 5000\n\n`);
    const after = lastEventId ? parseId(lastEventId) : null;
    if (after) {
      const missed = channels
        .flatMap(c => this.buffers.get(c) ?? [])
        .filter(m => isAfter(m.id, after))
        .sort((a, b) => (isAfter(a.id, parseId(b.id)!) ? 1 : -1));
      for (const m of missed) client.write(formatSse(m));
    }
    this.subscribers.add(subscriber);
    const heartbeat = setInterval(() => client.write(`: ping ${Date.now()}\n\n`), this.options.heartbeatMs);
    heartbeat.unref?.();
    const detach = () => {
      clearInterval(heartbeat);
      this.subscribers.delete(subscriber);
    };
    subscriber.detach = detach;
    return detach;
  }

  /** Ends every open stream so the HTTP server can drain during shutdown; clients reconnect elsewhere. */
  close(): void {
    for (const s of this.subscribers) {
      try {
        s.detach?.();
        s.client.end();
      } catch {
        // already closed
      }
    }
    this.subscribers.clear();
  }

  private deliver(message: RealtimeMessage): void {
    const buffer = this.buffers.get(message.channel) ?? [];
    buffer.push(message);
    if (buffer.length > this.options.bufferSize) buffer.splice(0, buffer.length - this.options.bufferSize);
    this.buffers.set(message.channel, buffer);
    const chunk = formatSse(message);
    for (const s of this.subscribers) {
      if (!s.channels.has(message.channel)) continue;
      try {
        s.client.write(chunk);
      } catch (err) {
        this.logger.debug({ err }, 'Realtime client write failed');
      }
    }
  }
}
