# syntax=docker/dockerfile:1
# Build context: repository root. One image runs the API, the worker or migrations (see docker-entrypoint.sh).
# Secrets are never baked in: every credential is provided as a runtime environment variable.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace backend --include-workspace-root=false --omit=dev --ignore-scripts \
  && mkdir -p backend/node_modules \
  && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4001 \
    WORKER_PORT=4002

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node packages/contracts ./packages/contracts
COPY --chown=node:node backend/package.json backend/tsconfig.json ./backend/
COPY --chown=node:node backend/src ./backend/src
COPY --chown=node:node --chmod=0755 backend/docker-entrypoint.sh /usr/local/bin/storefront
# Hosts that cannot inject runtime env get an optional backend/.env (the path src/core/config/dotenv.ts
# loads) from a build secret; real env vars still win.
RUN --mount=type=secret,id=backend_env,required=false \
    if [ -f /run/secrets/backend_env ]; then \
      cp /run/secrets/backend_env /app/backend/.env && chown node:node /app/backend/.env && chmod 0400 /app/backend/.env; \
    fi

USER node
WORKDIR /app/backend
EXPOSE 4001 4002
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || wget -qO- "http://127.0.0.1:${WORKER_PORT}/health" >/dev/null 2>&1 || exit 1
ENTRYPOINT ["storefront"]
CMD ["api"]
