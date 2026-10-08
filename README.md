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
Orders     Explicit state machine, every transition audited, illegal transitions rejected (409)
Payments   Razorpay (auto-enabled when keys set in backend/.env) with signature-verified webhook +
           idempotent confirmation; DEMO PAY mode exercises the identical path without keys
Admin      Aggregation pipelines: revenue by day, conversion funnel, top products, low-stock alerts,
           order queue with bulk actions
```

### Runtime topology

The backend runs as Express from `backend/` on **:4001**. All routes are under
`/api/v1`. Frontend (Next dev) binds **:3000**.

## The order state machine

```
              ┌────────────┐
   place ───▶ │  created   │ ───────────────┐
              └─────┬──────┘                │ cancel
              pay   │  (signature-verified, │
                    ▼   idempotent)         ▼
              ┌────────────┐          ┌────────────┐
              │    paid    │ ───────▶ │ cancelled  │
              └─────┬──────┘  cancel  └─────┬──────┘
              pack  │                       │ refund
                    ▼                       ▼
              ┌────────────┐          ┌────────────┐
              │   packed   │ ───────▶ │  refunded  │ (terminal)
              └─────┬──────┘  cancel  └────────────┘
              ship  │                       ▲
                    ▼                       │ refund
              ┌────────────┐          ┌─────┴──────┐
              │  shipped   │ ───────▶ │ delivered  │
              └────────────┘  deliver └────────────┘
```

Single source of truth in `backend/src/stateMachine.ts`:

```ts
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created:   ['paid', 'cancelled'],
  paid:      ['packed', 'cancelled', 'refunded'],
  packed:    ['shipped', 'cancelled'],
  shipped:   ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded:  [],
};
```

Every transition appends `{from, to, by, note, at}` to `statusHistory` (rendered as the audit
trail on the order page). Illegal moves throw `409 Illegal transition: X → Y` at the service
layer — the admin bulk action surfaces these rejections per order instead of scattering
`if (status === ...)` checks.

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

1. `payment.captured` webhooks are HMAC-verified against `RAZORPAY_WEBHOOK_SECRET` on the raw body.
2. Event ids are inserted into a `webhookevents` collection with a **unique index** — a replayed
   event hits `E11000` and returns `duplicate_ignored`.
3. Confirmation itself (`markOrderPaid`) only acts on `created` orders: the second verify/webhook/
   demo-confirm for the same order returns `alreadyProcessed: true` and stock is decremented once.

Verified live: replaying demo-confirm returned `pay1: paid alreadyProcessed:false`,
`pay2: paid alreadyProcessed:true` — 0 duplicate orders.

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
- `orders`: `{userId:1, createdAt:-1}`, `{status:1, createdAt:-1}`, `payment.razorpayOrderId`
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
