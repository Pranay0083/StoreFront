# Build context: repository root
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace backend --include-workspace-root=false

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4001

ARG MONGO_URL
ARG DB_NAME=storefront
ARG JWT_SECRET
ARG ADMIN_EMAIL=admin@storefront.dev
ARG ADMIN_PASSWORD
ARG FRONTEND_URL=http://localhost:3000
ARG RAZORPAY_KEY_ID=
ARG RAZORPAY_KEY_SECRET=
ARG RAZORPAY_WEBHOOK_SECRET=
ARG GROQ_API_KEY=
ARG GROQ_MODEL=openai/gpt-oss-120b

ENV MONGO_URL=$MONGO_URL \
    DB_NAME=$DB_NAME \
    JWT_SECRET=$JWT_SECRET \
    ADMIN_EMAIL=$ADMIN_EMAIL \
    ADMIN_PASSWORD=$ADMIN_PASSWORD \
    FRONTEND_URL=$FRONTEND_URL \
    RAZORPAY_KEY_ID=$RAZORPAY_KEY_ID \
    RAZORPAY_KEY_SECRET=$RAZORPAY_KEY_SECRET \
    RAZORPAY_WEBHOOK_SECRET=$RAZORPAY_WEBHOOK_SECRET \
    GROQ_API_KEY=$GROQ_API_KEY \
    GROQ_MODEL=$GROQ_MODEL

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY backend ./backend

WORKDIR /app/backend
EXPOSE 4001
CMD ["npm", "start"]
