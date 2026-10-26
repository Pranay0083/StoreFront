# ADR 0004: Reserve stock at checkout, commit on payment

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The original code checked stock when the order was created and decremented it only after payment, without a guard. Two buyers could both pay for the last unit and stock could go negative.

## Decision

Checkout reserves stock **inside the order transaction** with a guarded conditional decrement (`stock >= qty`). It records a reservation with `expiresAt` (`RESERVATION_TTL_MINUTES`, default 15) and `RESERVE` rows in an append-only inventory ledger. Payment commits the reservation (`SALE`). Cancellation, payment-window expiry (a per-order delayed job plus a safety sweep) or refunds release it (`RELEASE` / `RETURN`). A reconciliation endpoint proves that stock counters equal the ledger. Under contention, a per-variant in-process queue and jittered transaction retries keep throughput up.

## Consequences

- **Positive:** overselling is impossible by construction. Load tests sold exactly 50 of 50 units to 300 racing buyers with zero ledger mismatches.
- **Positive:** stock history is auditable, and drift is detectable.
- **Negative:** abandoned checkouts hold stock until they expire. The TTL is a business trade-off.
- **Negative:** a single hot SKU serialises per API instance (about 25–50 checkouts/s measured).

## Alternatives considered

- **Decrement on payment:** the original bug. It allows overselling between checkout and capture.
- **Optimistic stock check at payment time with apology refunds:** simpler, but a poor customer experience and more refunds.
- **Distributed lock on the SKU in Redis:** adds a dependency on the critical path. The conditional decrement already gives the guarantee.
