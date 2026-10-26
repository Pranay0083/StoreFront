# ADR 0002: Store money as integer paise

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Prices, discounts, shipping, refunds and Razorpay amounts were JavaScript floats in rupees. Percent discounts, allocation across lines and partial refunds produce fractions, and floating-point rounding drifts: a sum of line refunds may not equal what was charged.

## Decision

Every amount is an integer number of paise (`Paise` in `packages/contracts/src/money.ts`), validated by `PaiseSchema` (whole, non-negative) at every boundary. Conversion to rupees happens only for display (`formatINR`) and LLM prompts. Discounts are split across lines with the largest-remainder method, so shares always sum exactly. Migration `002-amounts-to-paise` converted existing data.

## Consequences

- **Positive:** arithmetic is exact. Allocation and refund tests can assert equality to the paisa, and the property tests check that allocations sum exactly. Razorpay already expects paise.
- **Negative:** every UI and integration must remember the unit. The shared contracts type and the single formatter limit that risk.

## Alternatives considered

- **Decimal library (decimal.js / Decimal128):** exact, but heavier and slower in the optimizer's hot loop, and it leaks into every type.
- **Floats with rounding at the edges:** the status quo, and the source of the drift.
