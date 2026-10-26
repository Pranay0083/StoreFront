# ADR 0003: Transactional outbox for domain events

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Paying an order has side effects: committing stock, counting promotion usage, sending e-mail, attributing experiment conversions, invalidating caches and revalidating pages. Running them inline makes requests slow and fragile. Publishing to a broker after the commit risks losing the event if the process dies in between (a dual write).

## Decision

State changes append typed domain events (`core/events/domain-events.ts`) to an `outbox` collection **in the same MongoDB transaction**. A relay delivers them to subscribed handlers:
- `PollingOutboxRelay` claims events with a lease, tracks completion per handler, backs off and dead-letters.
- `QueueOutboxRelay` turns each pending event-handler pair into a BullMQ job when Redis is available.

Delivery is at least once, and handlers must be idempotent.

## Consequences

- **Positive:** no lost or phantom events. A handler failure retries independently of the others, and exhausted events are visible and retryable in the operations console.
- **Positive:** the request path stays fast; side effects run in the worker.
- **Negative:** consumers see events with a small delay, and every handler must tolerate duplicates (conditional transitions, keyed notification logs, claimed refunds).
- **Negative:** the outbox needs polling or a wake-up signal, plus cleanup (a TTL on processed events).

## Alternatives considered

- **Inline side effects:** simplest, but one slow e-mail provider fails checkout.
- **Publish to Redis or BullMQ after commit:** a dual write that loses events on crashes.
- **MongoDB change streams:** viable, but they tie delivery to oplog retention and complicate per-handler retries and dead-lettering.
