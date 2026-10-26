# Storefront rendering and frontend quality

See also [ADR 0009](adr/0009-isr-with-event-driven-revalidation.md).

- **Server Components + ISR.** Home, listing and product pages render on the server from a tagged data cache (`products`, `product:<slug>`, `product-id:<id>`); product pages are generated on first request and cached. When catalog or stock changes, the API's `storefront.revalidate` job (coalesced, best-effort) calls `POST /api/revalidate` on the web app with `STOREFRONT_REVALIDATE_SECRET`, so pages refresh in seconds instead of waiting out the 5-minute TTL.
- **SEO.** Per-page metadata with OpenGraph/Twitter cards, Product/Offer/AggregateRating/BreadcrumbList/ItemList JSON-LD, `sitemap.xml` and `robots.txt`; filtered and search listings are `noindex`.
- **Client state.** TanStack Query owns server data (orders, admin tables, reviews, search suggestions, infinite catalog pages) and is invalidated by the realtime SSE stream; the bag stays local-first and syncs through a mutation that rolls back when the server rejects a line.
- **Quality gates.** Playwright journeys (`npm run e2e:build -w frontend && npm run e2e -w frontend`) drive a production build against the API on an in-memory replica set; Lighthouse CI (`npm run lhci -w frontend`, desktop preset) enforces ≥ 0.85 performance and ≥ 0.95 accessibility/SEO on the home and product pages.
