# Deployment and local scripts

## Deploy

- **Frontend → Vercel**: root `frontend/`, zero-config Next.js. Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`
  and `STOREFRONT_REVALIDATE_SECRET` (the same value as on the API, which also needs `STOREFRONT_REVALIDATE_URL`
  or a `FRONTEND_URL` it can reach).
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
npm run e2e:build -w frontend && npm run e2e -w frontend   # Playwright (boots the seeded e2e API itself)
npm run lhci -w frontend       # Lighthouse budgets (needs the e2e API on :4801 and web on :3100)
TEST_REDIS_URL=redis://localhost:6379 TEST_MEILI_URL=http://localhost:7700 npm test -w backend
```
