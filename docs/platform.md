# Platform infrastructure and growth tooling

How the API, worker and their optional dependencies fit together, and the back-office features built on them. The reasoning behind the Redis-optional design is in [ADR 0006](adr/0006-redis-optional-with-in-memory-fallbacks.md).

## Runtime topology

The backend runs as Express from `backend/` on **:4001**. All routes are under
`/api/v1`. Frontend (Next dev) binds **:3000**.

```
          ┌──────────── web (Next.js :3000)
          ▼
   API (:4001) ──enqueue──▶ Redis/BullMQ ◀──consume── worker (:4002 probes)
     │  ▲  │                    ▲                       │
     │  │  └─ cache, rate limits, idempotency, pub/sub ─┘
     ▼  │
  MongoDB (replica set: orders, outbox, ledger)  ◀── relay ── worker
     │
     └──▶ Meilisearch (optional, synced by ProductChanged + stock events)
```

## Platform infrastructure

Every stateful dependency sits behind an interface chosen in one composition root
(`core/infrastructure.ts` + `core/container.ts`): **Redis-backed when `REDIS_URL` is set,
in-memory otherwise**, so tests and a Redis-less demo run the same application code.

| Concern | Interface | Redis mode | Fallback |
|---|---|---|---|
| Jobs | `JobQueue` (`register` / `enqueue` / `schedule`) | BullMQ, per-queue workers | `MemoryJobQueue` (same retries, delays, dedupe) |
| Dead letters | `DeadLetterStore` | Mongo `dead_letter_jobs` | same |
| Outbox delivery | `OutboxRelay` | `QueueOutboxRelay`: one job per handler, woken by pub/sub | `PollingOutboxRelay` |
| Cache | `CacheProvider` + `CacheNamespace` (O(1) generation invalidation, single-flight) | `RedisCache` | `MemoryLruCache` |
| Pub/sub | `PubSub` | Redis channels | in-process emitter |
| Rate limits | `RateLimitStoreFactory` | `rate-limit-redis` | per-process memory |
| Idempotency keys | `IdempotencyStorage` | Lua-atomic `RedisIdempotencyStore` | Mongo |
| Search | `SearchProvider` (Strategy) | Meilisearch when `MEILI_URL` is set | Mongo `$text` + facets |
| E-mail | `EmailProvider` (Strategy) | Resend / SMTP | console |

- **Worker**: `npm run worker -w backend` runs the outbox relay, every queue and repeatable jobs
  (reservation safety sweep, abandoned-cart scan). Without Redis the API does this in-process
  (`JOBS_IN_PROCESS=auto`).
- **Jobs**: reservation expiry is a per-order delayed job; Razorpay webhooks are acknowledged
  after signature check + dedupe (`{"status":"accepted"}`) and processed on the `payments` queue;
  notifications go through `notifications.send` with a notification log so each
  `(key, channel)` is sent at most once. Exhausted jobs and outbox events can be listed, retried
  or discarded at `/api/v1/admin/jobs` (`jobs:manage`).
- **Resilience**: `withRetry` (exponential backoff, full jitter) and `CircuitBreaker`
  (closed / open / half-open) wrap payment-gateway calls; refunds retry only on connection errors.
- **Catalog**: `CachingCatalog` decorates reads; admin writes and stock-moving events invalidate.
  Listings support keyset cursors (`nextCursor`) alongside page numbers; `/products/suggest`
  serves autocomplete and text queries return facet counts.
- **Observability**: request ids (`X-Request-Id`) in every log line and job; `/metrics`
  (Prometheus), `/health` (liveness) and `/ready` (Mongo, Redis, queue; search optional; `draining`
  during shutdown); OpenTelemetry tracing when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

**Adding a job**: `jobs.register({ name, queue, attempts, backoffMs, handler })` in the composition
root (or a module's `register(jobs)`), then `jobs.enqueue(name, data, { jobId, delayMs })`. Throw
`UnrecoverableJobError` to dead-letter immediately. **Adding an event handler**:
`eventBus.subscribe('OrderPaid', '<module>.<handler>', fn)`; handlers must be idempotent.

## Growth and back-office tooling

- **Feature flags & A/B experiments**: deterministic SHA-256 bucketing for percentage rollouts, sticky variant assignment that follows an anonymous visitor through sign-in, exposure logging (only visitors who actually saw the tested UI count), OrderPaid conversion attribution, and a results view with a pooled two-proportion z-test, minimum-sample and sample-ratio-mismatch warnings. The live demo experiment `checkout-near-miss` shows or hides "add one more item" nudges in the bag.
- **Frequently bought together**: a repeatable job mines association rules (support, confidence, lift) from paid baskets; `GET /api/v1/products/:id/recommendations` falls back to same-category bestsellers.
- **Real-time updates**: domain events fan out over pub/sub to a Server-Sent Events hub (`GET /api/v1/realtime/stream`) with heartbeats and Last-Event-ID replay: customers see their order move, staff see the order queue and low-stock alerts live.
- **CSV bulk import**: uploads stream into GridFS, are deduplicated by content hash, and are processed by a background job that upserts by slug through the catalog service so stock changes land in the inventory ledger; per-row errors download as CSV.
- **Promotion builder & simulator**: structured AND/OR/NOT rule editor, version diffs, and a simulator that prices any cart for a segment, time and payment method.
- **OpenAPI 3.1**: generated from the route table and zod schemas at `/api/v1/openapi.json`, browsable at `/api/v1/docs`; CI fails if `backend/openapi.json` is stale (`npm run openapi:generate -w backend`).
