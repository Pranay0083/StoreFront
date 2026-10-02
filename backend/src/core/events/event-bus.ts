import type { DomainEvent, DomainEventName } from './domain-events';

export interface HandlerContext {
  /** 1-based delivery attempt for this event. */
  attempt: number;
  maxAttempts: number;
}

export type EventHandler<N extends DomainEventName> = (event: DomainEvent<N>, ctx: HandlerContext) => Promise<void>;

export interface Subscription {
  /** Stable id used to track per-handler completion so retries never re-run a handler that already succeeded. */
  id: string;
  run: (event: DomainEvent, ctx: HandlerContext) => Promise<void>;
}

/** In-process Observer: maps event names to named, independently retried handlers. */
export class EventBus {
  private readonly subscriptions = new Map<DomainEventName, Subscription[]>();

  subscribe<N extends DomainEventName>(name: N, id: string, handler: EventHandler<N>): this {
    const list = this.subscriptions.get(name) ?? [];
    if (list.some(s => s.id === id)) throw new Error(`Handler "${id}" is already subscribed to ${name}`);
    list.push({ id, run: handler as Subscription['run'] });
    this.subscriptions.set(name, list);
    return this;
  }

  handlersFor(name: DomainEventName): readonly Subscription[] {
    return this.subscriptions.get(name) ?? [];
  }
}
