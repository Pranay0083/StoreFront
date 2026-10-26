# Architecture

This document goes one level deeper than the [README](../README.md): how the backend is divided into
modules, how it stays consistent under concurrency and partial failure, how the pricing optimizer
works, and where the system's limits are. Decisions and their trade-offs are recorded in
[adr/](adr/README.md).

## Processes and deployment units

| Process | Entry point | Role |
|---|---|---|
| web | `frontend/` (Next.js 15) | Server-renders the storefront from a tagged data cache (ISR) and serves the admin. Exposes `POST /api/revalidate` for the API |
| api | `backend/src/server.ts` | REST under `/api/v1`, SSE streams (chat, realtime), MCP, `/metrics`, `/health`, `/ready` |
| worker | `backend/src/worker.ts` | Outbox relay, BullMQ queues (`events`, `payments`, `notifications`, `maintenance`), repeatable jobs (reservation safety sweep, abandoned carts, recommendation rebuilds) |

All three are stateless. State lives in MongoDB (source of truth) and, when configured, in Redis
(queues, cache, rate-limit counters, idempotency keys, pub/sub) and Meilisearch (a derived search
index). Without `REDIS_URL` the API runs the worker's jobs in-process (`JOBS_IN_PROCESS=auto`), so a
single process is a complete deployment.

## Module boundaries

The backend is a **modular monolith** ([ADR 0001](adr/0001-modular-monolith.md)). Each module in
`backend/src/modules/<name>/` exposes:
- routes (HTTP only)
- a controller class (request/response mapping)
- a service class (business rules)
- repository classes (the only code that touches its Mongoose models)

Classes receive their collaborators through constructors, and `backend/src/core/container.ts` is the
only place that instantiates them. That gives the code three rules:

1. **A module owns its collections.** Other modules change that data only through the owning module's
   service. For example, CSV imports upsert products through `CatalogService`, so stock changes still
   land in the inventory ledger.
2. **Synchronous calls go "down" the dependency graph** (orders → pricing → catalog data). Reactions go
   **through domain events**, so a module never calls the modules that react to it.
3. **Types shared with the frontend live in `packages/contracts`.** That covers zod schemas, DTOs, the
   order transition table, the RBAC map and money helpers, so the API and UI cannot disagree.

| Module | Owns | Calls | Publishes | Reacts to |
|---|---|---|---|---|
| catalog | `products`, catalog cache | inventory, search | `ProductChanged` | stock-moving events (cache invalidation) |
| inventory | `stockreservations`, `inventorymovements` | — | `StockLow` | order and refund events |
| pricing | `promotions`, `promotion_versions`, quotes, `promotion_redemptions` | product data via its own port | — | `OrderCancelled`, `RefundCompleted` (release redemptions) |
| orders | `orders` | pricing, cart, inventory | `OrderPlaced`, `OrderPaid`, `OrderShipped`, `OrderDelivered`, `OrderCancelled`, `RefundRequested` | — |
| payments | `webhookevents`, refund saga | orders, inventory, `PaymentGateway` | `RefundCompleted`, `RefundFailed` | `RefundRequested` |
| auth | users, sessions, login attempts | — | — | — |
| notifications | notification log | e-mail and messaging providers | — | order, refund and cart events |
| experiments, recommendations, search, realtime, storefront | their own collections or indexes | — | — | domain events (conversions, reindexing, SSE fan-out, ISR revalidation) |
| agent, mcp | conversations, `agent_pending_actions` | catalog, pricing, orders, cart (through the tool registry) | — | — |
| admin, imports, operations | audit log, uploads (GridFS), dead letters | the owning modules' services | — | — |

Cross-cutting concerns sit in `backend/src/core/`:
- `http`: validation, CSRF, rate limits, idempotency, OpenAPI metadata, error mapping
- `events`: bus, outbox, relays
- `queue`: BullMQ or memory, dead letters
- `cache`, `persistence` (`TransactionRunner`, `KeyedMutex`)
- `resilience`: retry, circuit breaker
- `observability`: request context, metrics, health

## Consistency model

MongoDB runs as a replica set and every multi-document change is a transaction. Five mechanisms build on
that. The proof for each lives in a named test; the table is in
[orders-and-payments.md](orders-and-payments.md#consistency-guarantees).

### 1. Transactions with conflict-aware retry

`TransactionRunner` (`core/persistence/transaction.ts`) wraps every write path. It retries transient
transaction errors (`WriteConflict`) with capped exponential backoff and full jitter. The driver's own
retry loop retries immediately; under the hot-SKU load test that produced about 13,300 aborted
transactions for 100 commits (see [performance.md](performance.md)).

Inside a checkout transaction the **contended write goes first**: the guarded stock decrement. A
losing attempt therefore aborts before doing any other work. Two layers sit in front of the
transaction:
- a snapshot availability check that fails sold-out checkouts with 409 before opening one
- a per-variant in-process `KeyedMutex` that queues same-variant checkouts in memory

### 2. Stock reservations

Checkout does several things in one transaction:
- decrements stock with `stock >= qty` as the condition
- writes a `RESERVE` ledger row and a reservation with `expiresAt` (`RESERVATION_TTL_MINUTES`)
- inserts the order and appends `OrderPlaced` to the outbox

Payment commits the reservation (`active → committed`, `SALE` rows). Cancellation or expiry releases it
(`RELEASE` rows). Expiry is a per-order delayed job, with a periodic sweep as a safety net. The ledger
is append-only, so `GET /admin/inventory/reconcile` can prove that the stock counters equal the sum of
movements ([ADR 0004](adr/0004-stock-reservation-at-checkout.md)).

### 3. Optimistic concurrency on the order aggregate

`Order` (`modules/orders/order.aggregate.ts`) records events and history in memory. The repository saves
it with `version` as a condition and increments it. The client's payment verify and the provider's
webhook both call `OrdersService.confirmPayment`. Both transactions move the same reservation and save
the same version, so one conflicts. On retry it sees `paid` and returns `alreadyProcessed`, which means
exactly one `SALE` and one `OrderPaid` per order, under any interleaving.

### 4. Transactional outbox, at-least-once delivery, idempotent handlers

State changes and their domain events commit together ([ADR 0003](adr/0003-transactional-outbox.md)).
Relays deliver them separately:
- **`PollingOutboxRelay`** claims events with a 30-second lease, tracks completion per handler, and
  retries failed handlers with exponential backoff up to 8 attempts before dead-lettering.
- **`QueueOutboxRelay`** turns each pending (event, handler) pair into a BullMQ job and is woken by
  pub/sub.

Delivery is **at least once**, so every handler is idempotent:
- the refund saga claims a refund before calling the gateway
- notifications key their log on `(key, channel)`
- promotion releases and ledger moves are conditional state transitions

Dead letters can be inspected, retried or discarded from the operations console (`jobs:manage`).

### 5. Idempotency keys and quotes at the edge

`Idempotency-Key` is supported on `POST /orders`, `/payments/create` and `/payments/demo-confirm`
(`core/http/idempotency/`):
- the same key with the same body replays the stored response
- a different body gets 422
- a concurrent duplicate gets 409
- keys expire after 24 hours, and are stored in Redis (atomic Lua) or MongoDB

Prices are protected the same way. A quote has a content hash and a 10-minute TTL. Checkout re-prices
inside the transaction and refuses with `410 QUOTE_EXPIRED`, `409 QUOTE_CART_MISMATCH` or
`409 PRICE_CHANGED` instead of charging an amount the customer never saw.

### Consistency boundaries worth knowing

- **Derived stores lag their source.** The Meilisearch index, Redis caches and ISR pages are updated
  from events, so they can be stale for seconds. Prices and stock are always re-read from MongoDB inside
  checkout.
- **The payment provider is outside our transaction.** A capture after an order expired is recorded and
  routed to an automatic refund, and a refund the gateway rejects is compensated by the saga.

## The pricing optimizer

The engine (`modules/pricing/domain/promotion-engine.ts`) prices a cart in stages
(`domain/stages.ts`):

**markdowns → unit-consuming bundles → cart-level discounts → code promotions → shipping.**

Promotions are stored as data. `condition.factory.ts` and `action.factory.ts` interpret their JSON into
`Condition` trees (`AllOf` / `AnyOf` / `Not` over `CartContains`, `MinSubtotal`, `DateWindow`, customer
segment and payment method) and `PromotionAction` strategies.

### Bundle packing

Fixed bundles, mix-and-match and buy-X-get-Y each **consume units**: a tee used in one combo can't count
towards another. Choosing non-overlapping applications that maximise savings is **weighted set packing**,
which is NP-hard. Taking the biggest offer first is often wrong. `optimizeBundles`
(`domain/bundle-optimizer.ts`) solves it exactly for realistic carts:

1. **Unit classes.** Units with the same price and the same offer eligibility are interchangeable, so the
   search state is a vector of remaining counts per class, not per unit. This collapses symmetric
   branches.
2. **Candidate applications.** Each offer enumerates the distinct ways one application can draw from the
   classes, capped at 2,000 per promotion.
3. **Decomposition.** Classes that never share an application form independent components (union-find).
   Each component is solved separately, so the search space is a sum, not a product.
4. **Branch-and-bound.** The search runs depth-first over the most valuable class first. At each node it
   either uses one of the class's units in some feasible application, or retires the class.
   - **Pruning** uses two admissible upper bounds: each application's savings attributed per unit and
     per rupee, taking the tighter one.
   - A **dominance memo** keyed by the remaining-count vector skips any state already reached with at
     least as much accumulated savings.
5. **Incumbent and budget.** The greedy plan seeds the incumbent, so the result is never worse than
   greedy. The search stops at 50,000 nodes or 250 ms and reports `greedy-fallback` with the best plan
   found.

Around the packing step, the engine also handles the other offer types:
- It evaluates every combination of **stack groups** (one cart-level offer per group; exhaustive up to
  64 combinations, otherwise best per group) and every **exclusive** offer on its own, and keeps the
  cheapest scenario.
- It **allocates** each discount to lines by largest remainder (`domain/allocation.ts`). Allocations sum
  to the paisa, so a later partial refund repays exactly what was paid.
- It **explains** why one offer beat another, and computes **near-miss** suggestions.

**Complexity.** In the worst case the search is exponential in the number of unit classes within a
component. In practice carts are small and components are tiny. The benchmark
(`npm run bench:pricing -w backend`, 30 overlapping promotions) proves optimality on every 8- and
20-unit cart, with p95 14 ms at 20 units. At 50 units the 50k-node budget is reached and the best plan
found (never worse than greedy) is returned in 29 ms p95. Under live quote load, branch-and-bound
completed on every request ([performance.md](performance.md#pricing-engine)).

**Correctness.** fast-check property tests check that the optimizer equals brute force on random carts
of up to 8 units, is never worse than greedy, never produces a negative total, and that allocations sum
exactly.

## Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Two checkouts for the last unit | One must lose | Guarded decrement in the transaction; the loser gets `409 Only 0 left`; stock never goes negative |
| Verify and webhook arrive together | Double fulfilment risk | Aggregate version check plus reservation state transition; the loser returns `alreadyProcessed` |
| Duplicate or replayed webhook | Double processing | Unique `eventId` → `duplicate_ignored`; the processing job has a deterministic id |
| Webhook enqueue fails | Event lost | The event id is forgotten so the provider's retry is processed |
| Client retries `POST /orders` | Duplicate order | `Idempotency-Key` replays the first response |
| Customer never pays | Stock locked | Reservation expires (delayed job plus sweep); stock released with `RELEASE` rows; order cancelled |
| Payment captured after expiry | Money without an order | Recorded as a late payment and refunded automatically |
| Prices or offers change after quoting | Charging an unseen price | `409 PRICE_CHANGED` / `410 QUOTE_EXPIRED`; the UI re-quotes |
| Promotion runs out mid-checkout | Over-redemption | Atomic `usedCount < usageLimit` guard plus per-order redemption row; `409 PROMOTION_EXHAUSTED` |
| Payment gateway slow or down | Cascading timeouts | `withRetry` (jittered backoff; refunds retry only on connection errors) plus a `CircuitBreaker` (5 failures → open for 30 s) → `503 CIRCUIT_OPEN` |
| Gateway rejects a refund | Order stuck in refund | Saga compensates: the order returns to its prior status with the reason audited |
| Event handler throws | Side effect missing | Outbox or BullMQ retries with backoff, then the dead-letter queue (retry or discard from the console) |
| Worker crashes mid-event | Event in limbo | The outbox lease (30 s) expires and another relay re-claims it; handlers are idempotent |
| Redis unavailable | Cache and queues degraded | Cache reads fail open to MongoDB; `/ready` reports Redis as a critical check, so the load balancer stops routing |
| Meilisearch unavailable | Text search fails | Browsing, product pages and checkout are unaffected; `/ready` reports `degraded` (search is non-critical) |
| LLM provider down or rate-limited | Assistant unavailable | Retry and circuit breaker on the provider; the shop keeps working; the widget shows an error |
| Prompt injection in reviews | Agent misuse | Untrusted content is delimited and neutralised; `ToolUsePolicy` only allows write tools the customer explicitly asked for, and writes still need confirmation |
| Process receives SIGTERM | Dropped requests | Graceful shutdown: `/ready` reports `draining`, the HTTP server and workers drain within `SHUTDOWN_TIMEOUT_MS` |

## Scaling notes

- **Horizontal API scaling** works today. Rate limits, idempotency keys, cache generations and pub/sub
  move to Redis when `REDIS_URL` is set, and realtime SSE fans out across instances through pub/sub.
  The in-memory fallbacks are per process, so a multi-instance deployment needs Redis.
- **Workers scale independently** of the API (`npm run worker -w backend`) and by queue concurrency.
- **Measured limits** on one laptop ([performance.md](performance.md#known-limits-not-fixed-here)):
  - About one core per API process: roughly 1.7k cached browse req/s or about 400 quotes/s.
  - One SKU sells at about 25–50 checkouts/s per API instance, because pricing runs inside the
    per-variant critical section to keep checkout transactional.
  - Full-text search p95 is about 46 ms, dominated by Meilisearch facet counting.
  - Every order invalidates the whole catalog cache namespace.
- **Next steps if traffic demanded them:**
  - invalidate the cache per product, and keep stock out of cached payloads
  - move pricing out of the stock critical section by pre-pricing, then verifying a quote
  - shard the per-variant queue across instances with a Redis lock
  - read replicas for the admin aggregations
  - split out a module (search, or notifications) as a service only once its scaling or ownership
    needs differ ([ADR 0001](adr/0001-modular-monolith.md))
