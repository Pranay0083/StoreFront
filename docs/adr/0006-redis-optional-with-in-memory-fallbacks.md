# ADR 0006: Redis is optional; every dependency has an in-memory fallback

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Queues, shared caches, distributed rate limits, idempotency keys and pub/sub want Redis in production. But tests, local development, CI without containers and the free demo deployment should not need Redis, and a second code path per feature would rot.

## Decision

Each stateful concern is an interface with two implementations, selected once in `core/infrastructure.ts` from `REDIS_URL`:
- `JobQueue`: BullMQ or `MemoryJobQueue`
- `CacheProvider`: Redis or an LRU
- `PubSub`: Redis channels or an in-process emitter
- rate-limit stores, idempotency storage and the outbox relay

Search follows the same pattern with `MEILI_URL` (Meilisearch or Mongo text search). Without Redis the API runs jobs in-process (`JOBS_IN_PROCESS=auto`).

## Consequences

- **Positive:** the same application code runs in every environment. The full test suite runs on in-memory infrastructure, and again against real Redis and Meilisearch in CI.
- **Positive:** a one-process demo deploy works for free.
- **Negative:** the in-memory implementations are per process. A multi-instance deployment must set `REDIS_URL`, or rate limits, caches and SSE fan-out will diverge.
- **Negative:** both implementations must keep identical semantics. Tests exercise the Redis and Meilisearch implementations whenever those services are available, as they are in CI.

## Alternatives considered

- **Require Redis everywhere:** simpler code, but heavier tests and demos.
- **Mocks in tests only:** tests would no longer exercise the production code path.
