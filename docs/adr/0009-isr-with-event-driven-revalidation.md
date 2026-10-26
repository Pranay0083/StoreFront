# ADR 0009: ISR with event-driven tag revalidation

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The storefront rendered every page on the client, which hurt SEO and LCP. Fully static pages would go stale when prices, stock or promotions change, and short TTLs waste rendering and API capacity.

## Decision

Home, listing and product pages are Server Components that fetch through a tagged data cache (`frontend/lib/server-api.ts`: tags such as `products`, `product:<slug>`, `product-id:<id>`), with a 5-minute fallback TTL. When catalog or stock events fire, the API's `StorefrontRevalidator` job calls `POST /api/revalidate` on the web app. The call is coalesced, best-effort, and authenticated with `STOREFRONT_REVALIDATE_SECRET`. The web app revalidates the affected tags. Interactive pieces (cart, checkout, admin) use TanStack Query, invalidated by realtime SSE events.

## Consequences

- **Positive:** fast, crawlable pages (Lighthouse 99–100) that refresh within seconds of a change, without polling.
- **Positive:** checkout never trusts cached prices; quotes are computed server-side.
- **Negative:** revalidation is best-effort. A missed call is bounded by the TTL.
- **Negative:** the API needs to know the web app's URL and share a secret with it.

## Alternatives considered

- **Client-side rendering:** the status quo, with poor SEO.
- **SSR on every request:** always fresh, but every view costs a render and API calls.
- **Time-based ISR only:** simple, but stale prices and stock for up to the TTL.
