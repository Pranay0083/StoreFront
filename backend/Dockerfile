# ── Stage 1: Install dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: Production runner ──
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4001

# Accept env vars as build-args from CI
ARG MONGO_URL
ARG DB_NAME=storefront
ARG JWT_SECRET
ARG ADMIN_EMAIL=admin@storefront.dev
ARG ADMIN_PASSWORD=Admin@123
ARG FRONTEND_URL=http://localhost:3000
ARG RAZORPAY_KEY_ID=
ARG RAZORPAY_KEY_SECRET=
ARG RAZORPAY_WEBHOOK_SECRET=

# Set them as runtime env vars
ENV MONGO_URL=$MONGO_URL \
    DB_NAME=$DB_NAME \
    JWT_SECRET=$JWT_SECRET \
    ADMIN_EMAIL=$ADMIN_EMAIL \
    ADMIN_PASSWORD=$ADMIN_PASSWORD \
    FRONTEND_URL=$FRONTEND_URL \
    RAZORPAY_KEY_ID=$RAZORPAY_KEY_ID \
    RAZORPAY_KEY_SECRET=$RAZORPAY_KEY_SECRET \
    RAZORPAY_WEBHOOK_SECRET=$RAZORPAY_WEBHOOK_SECRET

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 4001

CMD ["npx", "tsx", "src/index.ts"]
