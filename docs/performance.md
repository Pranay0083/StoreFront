# Performance and load testing

Every number on this page comes from one laptop. The load generator ran on the same laptop as the
system under test, so read them as relative measurements (before and after a change, or one
scenario against another), not as production capacity.

## Test setup

| | |
|---|---|
| Machine | Apple M2, 8 cores, 8 GB RAM; Docker Desktop VM with 8 vCPU and 3.8 GiB |
| Topology | Production `docker-compose.yml`. The API and the BullMQ worker run as **separate containers**, alongside MongoDB 7 (single-node replica set), Redis 7, Meilisearch 1.15 and Prometheus |
| Container limits (`loadtest/docker-compose.loadtest.yml`) | api 2 CPU / 768 MB · worker 1 CPU / 512 MB · mongo 2 CPU / 1 GB · redis 0.5 CPU / 256 MB · meilisearch 1 CPU / 512 MB · k6 1.5 CPU / 512 MB |
| API process | One Node.js process (`NODE_ENV=production`, `LOG_LEVEL=warn`, tracing off). Node runs JavaScript on one thread, so about one core is its ceiling whatever the CPU limit |
| Overrides | Per-IP rate limits disabled (every virtual user comes from the single k6 container). The demo payment gateway gets a webhook secret so signed Razorpay webhooks can be replayed |
| Data | The demo seed (24 products, 110 historical orders, 9 overlapping promotions) plus generated products: 1,024 products for the first runs, then 20,028 |
| Load generator | k6 0.54 in a container on the compose network, hitting `http://api:4001` directly (no proxy) |

Run it yourself:

```bash
npm run loadtest:up                 # build and start the stack, then reindex search
npm run loadtest:catalog            # +1,000 products (set CATALOG_SIZE=19000 for the 20k runs)
npm run loadtest:browse -- -e RATE=800 -e DURATION=1m
npm run loadtest:checkout           # fixtures, then the k6 race, then the correctness checks
npm run loadtest:metrics -- 2m      # server-side view from Prometheus
npm run loadtest:down
```

## Scenarios

| Scenario | Shape | What it checks |
|---|---|---|
| `browse` | Arrival rate ramps up to `RATE`. Traffic mix: 45% product page plus recommendations, 45% listing (random category, sort and featured filter), 10% categories. Product popularity follows a power law (the top 1% of products get about 21% of views) | Latency thresholds and an error rate under 1% |
| `search` | 60% autocomplete on prefixes, 40% full-text search, 30% of those with a swapped-letter typo | Autocomplete p95 under 150 ms |
| `pricing` | `POST /pricing/quote` on mixed carts: 80% have 1–4 lines and 20% have 5–10. 70% of lines are promoted products; 30% of carts carry `WELCOME10` | Total is never negative; reports how often the optimizer falls back to greedy or beats it |
| `checkout-spike` | 300 buyers (Bearer auth, each with its own `Idempotency-Key`) all start checkout at the same instant for one variant with 50 units, then pay. One in five also replays its request | Exactly 50 orders placed and paid, replays return the same order, no unexpected statuses |
| `webhook-burst` | 150 orders addressable by Razorpay order id; signed `payment.captured` events sent at 150 iterations/s for 20 s. Each iteration sends **two identical deliveries concurrently** | Exactly one `accepted` per event, everything else `duplicate_ignored`, no rejections |
| `soak` | Constant mixed traffic (70% browse, 20% search, 10% quotes) for 20 minutes | Latency stays flat and memory doesn't grow |

After the stateful scenarios, `loadtest/setup/verify.mjs` waits for the outbox and queues to drain, then checks the database directly:
- units sold and orders per SKU;
- stock is never negative;
- each order has exactly one paid transition, one `OrderPaid` outbox event and one `SALE` ledger movement;
- one webhook-event row per distinct event;
- `/admin/inventory/reconcile` shows zero mismatches, and the dead-letter queue is empty;
- MongoDB transactions committed and aborted during the run.

## Results (after the fixes below)

| Scenario | Catalog | Throughput | p50 | p95 | p99 | Errors | Notes |
|---|---|---|---|---|---|---|---|
| Browse | 1,024 | 1,761 req/s | 0.56 ms | 7.3 ms | 47 ms | 0% | Cache hit ratio 98.9%. API at 0.74 cores, which is the single-process ceiling |
| Browse | 20,028 | 939 req/s | 0.77 ms | 10.6 ms | 65 ms | 0% | Cache hit ratio 77% (catalog 83%, recommendations 68%). API RSS 201 MB |
| Search: autocomplete | 20,028 | 180 req/s | 1.1 ms | 2.7 ms | 11.6 ms | 0% | Meilisearch |
| Search: full text | 20,028 | 120 req/s | — | ≈46 ms | ≈50 ms | 0% | Meilisearch with facet counts, limited to 1 CPU |
| Pricing quotes | 1,024 | 100 req/s | 2.0 ms | 4.0 ms | 6.2 ms | 0% | Engine p95 2.5 ms (server-side metric) |
| Pricing quotes | 20,028 | 398 req/s | 2.3 ms | 60 ms | 214 ms | 0% | Near the single-process limit (0.71 cores). Engine p50 0.8 ms, p95 17 ms |
| Checkout spike, 300 buyers × 50 units | 20,028 | 300 checkouts in 2.3 s | 2.2 s | 2.3 s | 2.3 s | 0 unexpected | 100 Mongo transactions committed, **0 aborted**. 1.3 s p95 on the 1k catalog |
| Webhook burst | — | 300 req/s | 1.6 ms | 3.1 ms | 5.2 ms | 0% | 6,002 deliveries → 150 accepted, 5,852 duplicates ignored |
| Soak, 20 min (70% browse, 20% search, 10% quotes) | 20,028 | 197 req/s, 236k requests | 1.5 ms | 9.7 ms | 50 ms | 0% | API RSS 176–219 MB, ending at its minimum; heap 77–106 MB; event-loop p99 never above 18 ms; cache hit ratio 70% |

### Correctness under load

- **Checkout spike:**
  - 50 of 50 units sold, and all 50 orders are paid.
  - The other 250 buyers got `409 Only 0 left`.
  - Stock ended at 0 and never went negative.
  - Every idempotent replay returned the original order.
- **Webhook burst:**
  - All 150 orders are paid.
  - Each has exactly one paid transition, one `OrderPaid` event and one `SALE` movement, despite 40 deliveries per event, half of them racing in pairs.
- **Every run:**
  - `/admin/inventory/reconcile` matched stock to the ledger across up to 65,080 variants with 0 mismatches.
  - The dead-letter queue stayed empty.

### Pricing engine

From the live quote load (24k quotes):
- **Optimizer:** branch-and-bound handled every quote. The greedy fallback never triggered, and branch-and-bound found a strictly better combination than greedy on 0.04% of carts. Realistic carts rarely contain enough overlapping bundles to need a search.
- **Engine latency:** 0.83 ms p50 and 17 ms p95 at 400 quotes/s. Most of the p95 is waiting on a saturated event loop, not computing.

The synthetic benchmark (`npm run bench:pricing -w backend`, 30 overlapping promotions):

| Cart | p50 | p95 | Exact (branch-and-bound) | Beat greedy | p50 / p95 before the `formatINR` fix |
|---|---|---|---|---|---|
| 8 units | 1.1 ms | 1.6 ms | 40/40 | 11/40 | 2.6 ms / 3.6 ms |
| 20 units | 4.6 ms | 14.2 ms | 40/40 | 26/40 | 7.2 ms / 17.5 ms |
| 50 units | 18.7 ms | 29.4 ms | 0/40: the 50k-node budget falls back to greedy, and the best found is never worse than greedy | 32/40 | 22 ms / 33 ms |

## Bottlenecks found and fixed

Every fix below is its own commit, with a test.

### 1. Hot-SKU checkouts aborted each other (`perf(db)`, `perf(orders)` ×2)

The first checkout spike was correct, but slow:

| | POST /orders p50 | p95 | Unexpected responses | Mongo transactions aborted |
|---|---|---|---|---|
| Baseline (driver `withTransaction`) | 36.4 s | 36.5 s | 0 | ≈13,300, while the spike committed 100 |
| + jittered backoff, fail-fast, contended write first | 7.1 s | 8.2 s | 161 × HTTP 500 (retries exhausted) | not measured separately |
| + per-variant in-process queue (final) | 1.3 s (1k catalog) / 2.2 s (20k) | 1.3 s / 2.3 s | 0 | **0** |

Why it happened:
- All 300 transactions raced to decrement the same product document.
- MongoDB aborts the losers with `WriteConflict`.
- The driver's `withTransaction` retries those immediately, so the losers kept colliding until the 120-second retry budget ran out. That's about 44 attempts per checkout.

The fixes:
- **`TransactionRunner` backs off.** It retries transient errors with capped exponential backoff and full jitter.
- **Sold-out checkouts fail early.** A snapshot stock check outside the transaction returns 409 immediately.
- **The contended write goes first.** The stock decrement is now the first write in the transaction, so a losing attempt aborts before doing the other writes.
- **Same-variant checkouts queue in process.** A `KeyedMutex` serialises checkouts for the same variant inside each API process.
  - The queue lives in memory, so waiting costs nothing in MongoDB.
  - A request for several variants registers on all its keys atomically, so overlapping requests can't deadlock.
  - Across several API instances, conflicts still fall back to the backoff.

The conditional `stock >= qty` decrement inside the transaction is still the authoritative check.

The trade-off: with the queue, one variant sells at about 25–50 checkouts/s per API instance. Pricing runs inside the critical section, and so does the commit with `w: majority`. Checkouts for different variants still run in parallel.

### 2. Recommendations fallback loaded entire categories into memory (`fix(recommendations)`)

On the 20k catalog the browse scenario **crashed the API**: `FATAL ERROR: Reached heap limit`, the container restarted, and about 50% of requests failed.

Why it happened:
- On every cache miss, the "same-category bestsellers" fallback loaded every product in the category (about 5,000 documents) and aggregated all paid orders.
- Traffic is skewed toward popular products, so most of the long tail missed the cache, and many of these large loads ran at once.

The fix: the ranking is now built once per category and cached. It uses the top sellers plus a top-rated query limited to 24, and every product in the category shares it.

After the fix: 939 req/s, 0 errors, API RSS 201 MB.

### 3. Listing queries scanned and sorted the whole collection (`perf(catalog)`)

Listings sort by `createdAt`, `price` or `rating`, each followed by `_id` so keyset cursors are deterministic. Only `{ category, price }` was indexed, so MongoDB counted about 44k in-memory sorts (`scanAndOrder`) in one session.

Migration 080 adds one index per sort, with and without the category and featured filters. It also drops the superseded index.

Uncached listing cost on 20,028 products (`loadtest/setup/listing-bench.js`, page query plus count, 30 rounds):

| Query | Docs examined (before → after) | p50 before | p50 after |
|---|---|---|---|
| newest, all | 20,028 → 24 | 22 ms | 5 ms |
| newest, one category | 5,010 → 24 | 10 ms | 2 ms |
| price ascending, all | 20,028 → 24 | 15 ms | 4 ms |
| price descending, all | 20,028 → 24 | 21 ms (p95 63 ms) | 4 ms (p95 5 ms) |
| rating, one category | 5,010 → 24 | 8 ms | 1 ms |

The caches hide most of this. The fix matters for cache misses and cursor pages, and it keeps listing cost flat as the catalog grows.

### 4. `formatINR` built a new `Intl.NumberFormat` on every call (`perf(contracts)`)

A CPU profile at 300 quotes/s showed `formatINR` as the hottest application function. `toLocaleString` with options constructs a new formatter on each call, and the pricing explanations format dozens of amounts per quote. Reusing two cached formatters cut each call from 13.8 µs to 0.35 µs.

At 400 quotes/s:

| | Achieved | p95 | p99 | Engine p95 | API CPU |
|---|---|---|---|---|---|
| Before | 393 req/s | 171 ms | 318 ms | 40 ms | 0.83 cores |
| After | 398 req/s | 60 ms | 214 ms | 17 ms | 0.71 cores |

## Known limits (not fixed here)

- **One process per container.** The API is a single Node process, so it tops out at about one core: roughly 1.7k cached browse req/s or about 400 quotes/s.
  - Scaling means more API replicas behind a load balancer. The Redis-backed cache, rate limits, idempotency keys and pub/sub already support that.
  - Running Node's cluster module would need the in-memory fallbacks turned off.
- **Full-text search p95 is about 46 ms.** It's dominated by Meilisearch computing facet counts with one CPU.
  - Caching popular queries, or asking for facets only on the first page, would cut it.
- **One SKU sells at about 25–50 checkouts/s per API instance** (see fix 1).
  - Moving pricing out of the critical section would raise that.
  - It's a deliberate trade-off for keeping pricing transactional.
- **Every order clears the whole catalog cache.** Each order placed, cancelled or refunded invalidates the entire catalog cache namespace, because stock changed. Any admin product edit does the same to the recommendations cache.
  - With real checkout traffic mixed in, hit ratios will be lower than the browse-only numbers above.
  - Invalidating per product, or keeping stock out of the cached page payloads, would fix it.
