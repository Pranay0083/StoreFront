# Orders, payments and pricing

The order lifecycle, the consistency guarantees around stock, payments and promotions, and the refund saga. [architecture.md](architecture.md) explains the consistency model at a higher level.

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
   `duplicate_ignored`. A new event is acknowledged as `accepted` and processed by the
   `payments.process-webhook` job (job id `webhook:<eventId>`, so it is enqueued at most once) with the
   queue's retries; without a job queue it is processed inline and answered `processed`. If enqueueing or
   inline processing fails, the event id is forgotten so Razorpay's own retry is processed.
3. Checkout verification also checks that the signed Razorpay order id belongs to the order being
   paid, so a signature from one order cannot confirm another.

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
