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
Orders     Order aggregate + shared transition table, optimistic concurrency, audited transitions,
           stock reservations with expiry, refund saga with compensation
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
| Over-redeeming coupons | The coupon use is reserved at checkout with an atomic `usedCount < usageLimit` guard and a per-order redemption row, and released when an unpaid order is cancelled. | 12 parallel orders on a 3-use coupon → 3 succeed |
| Verify racing the webhook | Payment confirmation commits the reservation and saves the aggregate in one transaction; the losing writer retries, sees `paid` and reports `alreadyProcessed`. | 8 concurrent verify/webhook calls → one `SALE`, one `OrderPaid` (`test/payment-race.test.ts`) |
| Payment arriving after expiry | The capture is recorded and the order is routed to an automatic refund. | `test/payment-race.test.ts` |
| Client retries / double clicks | `Idempotency-Key` on `POST /orders`, `/payments/create` and `/payments/demo-confirm`: same body replays the stored response, a different body gets 422, and an in-flight duplicate gets 409. | `test/idempotency.test.ts` |
| Lost side effects | **Transactional outbox**: domain events are written in the same transaction as the state change and delivered by a relay with leases, per-handler completion tracking, exponential backoff and a dead-letter state. | `test/outbox.test.ts` |
| Stock drift | **Append-only inventory ledger** (`RESERVE`, `RELEASE`, `SALE`, `RESTOCK`, `RETURN`, `ADJUST`). The sum of deltas must equal the stock counter: `GET /api/v1/admin/inventory/reconcile`. | `test/inventory.test.ts` |

## Refund saga

`RefundRequested` (from a customer cancelling a paid order, a post-delivery refund request within
7 days, an admin action, or a late capture) drives `RefundSaga`:

1. **Claim** the refund (`requested → processing`) so only one worker submits it.
2. **Refund** through the `PaymentGateway` strategy (Razorpay or demo).
3. **Settle** synchronously or via the `refund.processed` webhook. Completing the refund and
   restocking (`RELEASE` if never shipped, `RETURN` if delivered) happen in one transaction.
4. **Compensate** on `refund.failed`, a permanent gateway rejection or exhausted retries: the order
   returns to its pre-refund status with the failure in the audit trail. Transient errors release
   the claim and are retried by the outbox.

## Aggregation pipelines, not `find()` in a loop

Revenue chart (`GET /api/v1/admin/revenue-by-day`):

```js
Order.aggregate([
  { $match: { status: { $in: ['paid','packed','shipped','delivered'] }, paidAt: { $gte: since } } },
  { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
      revenue: { $sum: '$total' }, orders: { $sum: 1 },
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

## Indexes

- `products`: `{category:1, price:1}` compound (filters), text index on title+description (search), unique slug
- `orders`: `{userId:1, createdAt:-1}`, `{status:1, createdAt:-1}`, `payment.razorpayOrderId`, sparse `payment.razorpayPaymentId` and `refund.gatewayRefundId`
- `stockreservations`: unique `orderId`, `{status:1, expiresAt:1}` · `inventorymovements`: `{productId:1, size:1, createdAt:-1}`, `orderId`
- `outbox`: `{status:1, nextAttemptAt:1}`, TTL on processed events · `idempotencykeys`: 24h TTL · `couponredemptions`: unique `orderId`
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
- **CI**: `.github/workflows/ci.yml` — format check, lint, typecheck, contracts + backend test suites
  (mongodb-memory-server), a migrate/seed/boot smoke test and the frontend build.

## Local scripts

```bash
npm install                 # one install for every workspace
npm run dev:api             # migrate + seed, then API on :4001 (tsx watch)
npm run dev:web             # Next.js on :3000
npm test                    # contracts + backend tests (in-memory MongoDB replica set)
npm run lint && npm run typecheck && npm run format:check
npm run db:status -w backend   # applied/pending migrations
```
