# StoreFront — Production MERN Commerce App with Admin Dashboard

An explicit **order state machine**, a **role-gated admin dashboard built on real MongoDB aggregations**, **idempotent payment confirmation**, and a Figma-grade editorial UI.

**Demo accounts** — admin: `admin@storefront.dev` / the `ADMIN_PASSWORD` you configure · customer: `customer@storefront.dev` / `Customer@123`

## Architecture

```
Frontend   Next.js 14 (App Router) + TypeScript + Tailwind + shadcn-style component library
           Optimistic cart (localStorage + server merge), skeleton loading, next/image, route groups
Auth       Short-lived access JWT + rotating refresh-token families (reuse detection) → httpOnly
           cookies + Bearer → signed double-submit CSRF → permission-based RBAC with an audit trail
           Provider boundary isolated in middleware.ts — swap in Firebase Admin verifyIdToken later
Monorepo   npm workspaces: backend (@storefront/api), frontend (@storefront/web), packages/contracts
           (@storefront/contracts — shared zod schemas, DTO types, order transitions, paise money helpers)
Backend    Express 5 + strict TypeScript, modular monolith (src/modules/<module>: routes → controller
           class → service class → repository class), constructor injection wired in one composition
           root (src/core/container.ts), typed AppError hierarchy, zod-validated env, versioned /api/v1
Data       MongoDB + Mongoose; versioned migrations (src/db/migrations) + idempotent demo seed;
           all money stored as integer paise
Pricing    Data-driven promotion engine (bundles, mix & match, BxGy, tiers, codes, markdowns) with a
           branch-and-bound optimizer; checkout verifies the client's quote and stores what was applied
Orders     Order aggregate + shared transition table, optimistic concurrency, audited transitions,
           stock reservations with expiry, refund saga with compensation, per-line partial refunds
Inventory  Append-only stock ledger with reconciliation; guarded conditional decrements
Events     Typed domain events, transactional outbox, polling relay with retries + dead-letter
Payments   PaymentGateway strategy (Razorpay | demo) chosen by a factory; signature-verified webhooks,
           atomic + idempotent confirmation, Idempotency-Key support on unsafe endpoints
Admin      Aggregation pipelines: revenue by day, conversion funnel, top products, low-stock alerts,
           order queue with bulk actions
```

### Runtime topology

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

## The order lifecycle

```
              ┌────────────┐  cancel / payment window expires   ┌────────────┐
   place ───▶ │  created   │ ─────────────────────────────────▶ │ cancelled  │
              └─────┬──────┘                                    └─────┬──────┘
              pay   │ (atomic, idempotent)          late capture      │
                    ▼                                                 ▼
              ┌────────────┐  cancel / refund   ┌──────────────────────────┐  gateway settles  ┌────────────┐
              │    paid    │ ─────────────────▶ │     refund_requested     │ ────────────────▶ │  refunded  │
              └─────┬──────┘                    └──────────────────────────┘                   └────────────┘
              pack  │                              ▲            ▲      │ refund fails:
                    ▼                              │            │      │ compensate back to
              ┌────────────┐  cancel / refund      │            │      │ the previous status
              │   packed   │ ──────────────────────┘            │      ▼
              └─────┬──────┘                                    │   (paid / packed /
              ship  │                                           │    delivered / cancelled)
                    ▼                                           │
              ┌────────────┐  deliver   ┌────────────┐  refund  │ (within 7 days)
              │  shipped   │ ─────────▶ │ delivered  │ ─────────┘
              └────────────┘            └────────────┘
```

Delivered orders can also return individual items: `delivered → refund_requested → partially_refunded`,
and from `partially_refunded` further returns run the same saga until the last unit settles as
`refunded`. Before delivery the whole order is refunded.

The transition table lives in `packages/contracts/src/orders.ts` and is shared by the API and the
UI. The backend models an order as an **aggregate** (`backend/src/modules/orders/order.aggregate.ts`):
every change goes through a method (`pay`, `pack`, `cancel`, `requestRefund`, `completeRefund`,
`failRefund`, …) that enforces the invariants, appends `{from, to, by, note, at}` to the audit
trail and records a domain event. The repository saves it with an **optimistic version check**,
so two writers can never silently overwrite each other. Operators are limited to
`ADMIN_ORDER_ACTIONS`: nobody can mark an order paid or refunded by hand.

## Consistency guarantees

All multi-document changes run in MongoDB transactions, so **MongoDB must run as a replica set**
(Atlas does; locally use `mongod --replSet rs0` and `rs.initiate()`). Tests use an in-memory
replica set.

| Problem | Mechanism | Proof |
|---|---|---|
| Overselling the last unit | Checkout takes stock with a guarded conditional decrement (`stock >= qty`) inside the order transaction and records a reservation that expires after `RESERVATION_TTL_MINUTES`. A sweeper cancels unpaid orders and releases their stock. | 50 parallel checkouts for 1 unit → exactly one order (`test/checkout.test.ts`) |
| Over-redeeming promotions | Every applied promotion's use is counted inside the checkout transaction with an atomic `usedCount < usageLimit` guard plus a per-order row in `promotion_redemptions`; it is released when an unpaid order is cancelled or the order is fully refunded. | 20 parallel checkouts on a 5-use promotion → exactly 5 redeemed (`test/checkout.test.ts`) |
| Charging a different price than shown | Checkout re-prices the cart inside the order transaction and, given a `quoteId`, refuses with `410 QUOTE_EXPIRED`, `409 QUOTE_CART_MISMATCH` or `409 PRICE_CHANGED` unless the price still matches the quote; the client re-quotes and shows the new total. | `test/checkout-pricing.test.ts` |
| Verify racing the webhook | Payment confirmation commits the reservation and saves the aggregate in one transaction; the losing writer retries, sees `paid` and reports `alreadyProcessed`. | 8 concurrent verify/webhook calls → one `SALE`, one `OrderPaid` (`test/payment-race.test.ts`) |
| Payment arriving after expiry | The capture is recorded and the order is routed to an automatic refund. | `test/payment-race.test.ts` |
| Client retries / double clicks | `Idempotency-Key` on `POST /orders`, `/payments/create` and `/payments/demo-confirm`: same body replays the stored response, a different body gets 422, and an in-flight duplicate gets 409. | `test/idempotency.test.ts` |
| Lost side effects | **Transactional outbox**: domain events are written in the same transaction as the state change and delivered by a relay with leases, per-handler completion tracking, exponential backoff and a dead-letter state. | `test/outbox.test.ts` |
| Stock drift | **Append-only inventory ledger** (`RESERVE`, `RELEASE`, `SALE`, `RESTOCK`, `RETURN`, `ADJUST`). The sum of deltas must equal the stock counter: `GET /api/v1/admin/inventory/reconcile`. | `test/inventory.test.ts` |

## Checkout pricing

The cart and checkout call `POST /api/v1/pricing/quote` (debounced) and show the breakdown:
per-stage totals, applied promotions with explanations, near-miss suggestions and rejected codes.
`POST /api/v1/orders` takes `{ items, codes?, quoteId?, paymentMethod?, address }`. With a `quoteId`
the engine re-prices and verifies the quote; without one it prices server-side. A rejected promo
code fails the order with `400 CODE_REJECTED`, and a promotion that ran out between quote and order
fails with `409 PROMOTION_EXHAUSTED`. Each order stores:

- per line: list `price`, `markdownPerUnit`, `discounts[]` (every promotion's share, allocated to the
  paisa by largest remainder) and `lineTotal`, the amount actually paid for the line;
- `pricing`: the applied promotion ids **and versions**, stage totals, the optimizer report and the
  explanations, so any order's price can be explained later.

Coupons were retired in favour of code promotions: migration `041` converts each coupon into an
equivalent promotion (recorded in `coupon_promotion_map`), moves its redemptions onto the promotion
ledger and keeps the old collections as `coupons_legacy` / `couponredemptions_legacy`.

## Refund saga

`RefundRequested` (from a customer cancelling a paid order, a post-delivery return of the whole
order or of specific items within 7 days, an admin action, or a late capture) drives `RefundSaga`.
An order keeps a `refunds[]` history and has at most one refund open at a time. A refund line is
worth its units' share of the line's paid total (`refundableAmount` in contracts splits `lineTotal`
over units by largest remainder), so successive partial refunds add up to exactly what was paid;
shipping is refunded only by the refund that leaves nothing unrefunded. Customers use
`POST /api/v1/orders/:id/refund { reason, lines? }`; staff with `orders:manage` use
`POST /api/v1/admin/orders/:id/refund` (no refund window).

1. **Claim** the refund (`requested → processing`) so only one worker submits it.
2. **Refund** through the `PaymentGateway` strategy (Razorpay or demo).
3. **Settle** synchronously or via the `refund.processed` webhook. Completing the refund and
   restocking exactly its units (`RELEASE` if never shipped, `RETURN` if delivered) happen in one
   transaction; the order becomes `partially_refunded`, or `refunded` once every unit is back.
4. **Compensate** on `refund.failed`, a permanent gateway rejection or exhausted retries: the order
   returns to its pre-refund status with the failure in the audit trail. Transient errors release
   the claim and are retried by the outbox.

## Aggregation pipelines, not `find()` in a loop

Revenue chart (`GET /api/v1/admin/revenue-by-day`):

```js
Order.aggregate([
  { $match: { status: { $in: ['paid','packed','shipped','delivered','partially_refunded'] }, paidAt: { $gte: since } } },
  { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
      revenue: { $sum: { $subtract: ['$total', { $ifNull: ['$refundedAmount', 0] }] } }, orders: { $sum: 1 },
  } },
  { $sort: { _id: 1 } },
])
```

Also: top products (`$unwind items → $group → $sort`), conversion funnel (`$group` by status),
low-stock alerts (`$unwind sizes → $match stock < 5`).

## Webhook idempotency — Razorpay retries, we don't duplicate

1. Webhooks (`payment.captured`, `refund.processed`, `refund.failed`) are HMAC-verified on the raw
   body with a constant-time comparison (`crypto.timingSafeEqual`).
2. Event ids are inserted into `webhookevents` under a **unique index**, so a replayed event returns
   `duplicate_ignored`. If processing fails, the event id is forgotten so Razorpay's retry runs.
3. Checkout verification also checks that the signed Razorpay order id belongs to the order being
   paid, so a signature from one order cannot confirm another.

## Security model

| Concern | Mechanism |
| --- | --- |
| Sessions | 15-min access JWT + 7-day refresh JWT signed with **separate keys**. Each login is a refresh-token **family** stored only as SHA-256 fingerprints; every refresh atomically rotates it. Replaying a rotated token (outside a 10 s multi-tab grace window) revokes the whole family. `logout` revokes the family, `logout-all` every family plus outstanding access tokens; `/auth/sessions` lists and revokes devices. |
| CSRF | Cookie-authenticated writes must echo an HMAC-signed token in `X-CSRF-Token` (signed double-submit). Tokens come from `GET /auth/csrf` and auth responses, so a cross-site frontend never needs to read the cookie; they rotate on login/logout. Bearer clients, the webhook and MCP are exempt. |
| Cookies | `SameSite=None; Secure` in production (separate frontend/API sites), `Lax` locally; refresh cookie scoped to `/api/v1/auth`. Overridable via `COOKIE_*`. |
| Brute force | Exponential backoff keyed on **IP + email** (owner is never locked out from another network) plus a looser per-email policy against distributed stuffing; `Retry-After` on 429. Unknown emails still pay for a bcrypt compare so timing does not reveal accounts. |
| Rate limits | Declarative policy table — global, sign-in, session, checkout/payments, AI chat, catalog reads, MCP — stacked per request behind a pluggable counter store (memory now, Redis-ready). |
| Trust boundary | Carts persist only `{productId, size, qty}`; titles, prices and stock are always read from the catalog. Reviews require a delivered order (verified purchase); ratings update atomically and incrementally. |
| Authorization | Roles (`support`, `fulfillment`, `catalog_manager`, `admin`) map to permissions (`orders:manage`, `catalog:write`, `audit:read`…) defined once in `@storefront/contracts`; `requirePermission()` guards routes and the UI hides what a role cannot use. |
| Audit | Every permission-guarded write is logged after the response (actor, permission, route, targets, redacted diff, status) and browsable at `/admin/audit` with keyset pagination. |
| Headers & CORS | Deny-all CSP, no-referrer, same-site CORP, HSTS in production; credentialed CORS only for `CORS_ORIGINS`. CodeQL and grouped Dependabot updates run in CI. |

## The shopping assistant

Aria is a tool-using agent, not a chatbot wrapper. The pieces, all in `backend/src/modules/agent`:

| Concern | Design |
| --- | --- |
| Tools | Each tool is a **Command object** (zod schema, description, access level, channels, `requiresConfirmation`). One `ToolRegistry` validates arguments, enforces access and generates both the chat tool specs (JSON Schema) and the **MCP server**, so the two can never drift. Pricing tools (`get_best_price`, `suggest_bundles`) call the promotion engine instead of letting the model do arithmetic. |
| Models | `LLMProvider` interface with **Groq** and **Claude** adapters (Adapter pattern: messages, tool calls, streaming, usage), chosen by `LLMProviderFactory` from `LLM_PROVIDER`. A `ResilientLLMProvider` decorator adds retry with jittered backoff (never after tokens have streamed) and a circuit breaker; the Claude adapter opts into server-side refusal fallbacks. |
| Streaming | `POST /agent/chat/stream` is Server-Sent Events over POST: `token`, `tool` (start/end), `action`, then `done`. Closing the connection aborts the model call; the widget falls back to `POST /agent/chat`. |
| Human in the loop | `add_to_cart`, `cancel_order` and `request_refund` only create a **pending action** bound to the signed-in customer and session, expiring after `AGENT_ACTION_TTL_MINUTES`. The widget renders a confirmation card; `POST /agent/actions/:id/confirm` (authenticated, CSRF-protected) claims it atomically and runs it through the normal cart/order services. Guests and MCP clients get no write tools. |
| Prompt injection | Tool results are wrapped in `<tool_result>` and customer text in `<customer_content>`; instruction-shaped phrases inside them are neutralised. A deterministic `ToolUsePolicy` caps tool calls per message and only lets a write tool through when the customer's **own message** asked for that action, so a review saying "cancel my order" cannot trigger one even if the model obeys it. An output guard blocks replies quoting the system prompt. |
| Context | Unsummarised turns are kept under `AGENT_HISTORY_TOKEN_BUDGET`; older turns are folded into a rolling summary stored on the conversation (falling back to trimming if summarisation fails). |
| Cost | Tokens, latency and estimated USD cost (per-model price table, overridable via `AGENT_MODEL_PRICING`) are recorded per reply and per conversation, shown on `/admin/chats` with daily totals, and exported as `storefront_agent_*` Prometheus metrics. |
| Evals | Six graded scenarios (discovery, best price, order status, add-to-bag, injection resistance, guest writes). `npm test` runs them with scripted reference models plus negative controls that prove the graders catch invented prices, fake links and skipped tools; `npm run eval:agent -w backend` runs them against the configured real model and prints a scorecard. |

## Indexes

- `products`: `{category:1, price:1}` compound (filters), text index on title+description (search), unique slug
- `orders`: `{userId:1, createdAt:-1}`, `{status:1, createdAt:-1}`, `payment.razorpayOrderId`, sparse `payment.razorpayPaymentId` and `refunds.gatewayRefundId`
- `stockreservations`: unique `orderId`, `{status:1, expiresAt:1}` · `inventorymovements`: `{productId:1, size:1, createdAt:-1}`, `orderId`
- `outbox`: `{status:1, nextAttemptAt:1}`, TTL on processed events · `idempotencykeys`: 24h TTL · `promotion_redemptions`: unique `orderId`, `{promotions.promotionId:1, status:1}`
- `reviews`: unique `{productId:1, userId:1}` · `webhookevents`: unique `eventId` · `users`: unique email

## Going live with Razorpay

Set in `backend/.env` and restart: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`. The checkout automatically switches from DEMO PAY to the real
Razorpay modal (`/api/v1/payments/config` reports the mode). Register the webhook at
`<host>/api/v1/payments/webhook`.

## Deploy

- **Frontend → Vercel**: root `frontend/`, zero-config Next.js. Set `NEXT_PUBLIC_API_URL`.
- **API → Render/Railway**: `render.yaml` included — `npm start -w backend` applies pending
  migrations, seeds demo data when the catalog is empty (`SEED_DEMO_DATA=false` to skip), then serves.
  Set Mongo, `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (a legacy `JWT_SECRET` still works and is
  HKDF-split), Razorpay env vars, `TRUST_PROXY=1` behind a proxy, and `ADMIN_PASSWORD` to provision the admin account.
- **Worker + Redis on Render**: `render.yaml` adds a Key Value instance (`noeviction`) and a
  background worker sharing an env group with the API. Workers are a paid plan; without one set
  `JOBS_IN_PROCESS=true` on the API.
- **Docker**: `docker compose up --build` runs api, worker, web, Mongo (single-node replica set,
  auto-initiated), Redis and Meilisearch. `docker compose --profile observability up` adds Jaeger
  (:16686), Prometheus (:9090) and Grafana (:3001, provisioned "StoreFront platform overview"
  dashboard). Images run as non-root and take secrets only at runtime.
- **CI**: `.github/workflows/ci.yml` — format check, lint, typecheck, the test suite on in-memory
  infrastructure and again against Redis + Meilisearch service containers, an API + worker boot
  smoke test, the frontend build and both container image builds.

## Local scripts

```bash
npm install                 # one install for every workspace
npm run dev:api             # migrate + seed, then API on :4001 (tsx watch)
npm run dev:web             # Next.js on :3000
npm test                    # contracts + backend tests (in-memory MongoDB replica set)
npm run lint && npm run typecheck && npm run format:check
npm run db:status -w backend   # applied/pending migrations
npm run worker -w backend      # job worker (needs REDIS_URL)
npm run search:reindex -w backend
npm run eval:agent -w backend  # agent scorecard against the configured model
TEST_REDIS_URL=redis://localhost:6379 TEST_MEILI_URL=http://localhost:7700 npm test -w backend
```
