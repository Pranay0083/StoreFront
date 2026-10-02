# Build context: repository root
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace frontend --include-workspace-root=false

FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:4001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG INTERNAL_API_URL=http://backend:4001
ENV INTERNAL_API_URL=$INTERNAL_API_URL

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY frontend ./frontend
RUN mkdir -p frontend/public && npm run build -w frontend

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN npm install sharp
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public

USER nextjs
EXPOSE 3000
CMD ["node", "frontend/server.js"]
