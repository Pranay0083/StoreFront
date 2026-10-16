# Build context: repository root.
# NEXT_PUBLIC_API_URL and INTERNAL_API_URL are public URLs (inlined into the client bundle and the
# rewrites manifest at build time), never secrets.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace frontend --include-workspace-root=false --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4001
ARG INTERNAL_API_URL=http://api:4001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    INTERNAL_API_URL=$INTERNAL_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY frontend ./frontend
RUN mkdir -p frontend/public && npm run build -w frontend

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public ./frontend/public
# The monorepo root package.json is "type": "module"; Next's standalone server.js is CommonJS.
RUN printf '{"type":"commonjs"}\n' > ./frontend/package.json

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "frontend/server.js"]
