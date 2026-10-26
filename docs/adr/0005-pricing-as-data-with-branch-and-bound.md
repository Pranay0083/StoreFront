# ADR 0005: Promotions as data, optimised with branch-and-bound

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The store wanted combos (fixed bundles, any-3-for, buy-X-get-Y), spend tiers, codes, flash sales and clearance markdowns, created by staff without deploys. Shoppers should automatically get the lowest valid price. Offers overlap: a tee can count towards only one bundle. Picking "biggest offer first" is often wrong; the problem is weighted set packing.

## Decision

Promotions are versioned JSON rules validated by contracts zod schemas:
- **Conditions** use Specification + Composite: `AllOf` / `AnyOf` / `Not` over cart, subtotal, date, segment and payment method.
- **Actions** use Strategy: one class per discount type.
- **Interpretation:** factories turn the stored JSON into these objects.

A Chain of Responsibility pipeline prices markdowns → bundles → cart-level → codes → shipping.

Unit-consuming offers are packed by **branch-and-bound** over interchangeable unit classes, with:
- upper-bound pruning and a dominance memo
- independent sub-problems solved separately
- a greedy incumbent
- a 50k-node / 250 ms budget that falls back to the best plan found

Each order stores the applied promotion ids and versions, plus per-line allocations.

## Consequences

- **Positive:** staff can create and simulate offers in the admin. Prices are explainable ("why X over Y") and reproducible from stored versions. The optimizer is proven equal to brute force on random small carts, and never worse than greedy.
- **Positive:** the pricing domain has no database dependency (ports in `pricing.ports.ts`), so it is fast to test and benchmark.
- **Negative:** worst-case exponential search. The budget bounds latency but can return a non-proven optimum on very large carts (about 50 units).
- **Negative:** a rule language has to be versioned and migrated (coupons were converted by migration `041`).

## Alternatives considered

- **Hard-coded promotion types in checkout code:** fast to start, but every new offer needs a deploy and there is no optimisation.
- **Greedy by savings:** simple and fast, but measurably worse (branch-and-bound beat greedy on 26 of 40 20-unit benchmark carts).
- **Integer linear programming solver:** optimal and general, but a heavy dependency for carts that are almost always small.
