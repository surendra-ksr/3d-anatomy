# ---------------------------------------------------------------------------
# Interactive Anatomy Engine — Next.js frontend (multi-stage)
#
# Build:
#   docker build -t anatomy-web \
#     --build-arg FASTAPI_URL=http://backend:8000 \
#     --build-arg NEXT_PUBLIC_MESH_ASSET_BASE_URL=https://dXXX.cloudfront.net \
#     .
#
# Run (see docker-compose.yml):
#   DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, AUTH_INTERNAL_SECRET, FASTAPI_URL
# ---------------------------------------------------------------------------
# ---- 1. dependencies -------------------------------------------------------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. build --------------------------------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma's engine preflight works against the public CDN in normal network
# conditions; set PRISMA_ENGINES_MIRROR to an internal mirror if you build in
# a restricted network.
ARG PRISMA_ENGINES_MIRROR=""
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}

# Build-time inlined values: middleware.ts (edge runtime) reads FASTAPI_URL /
# AUTH_INTERNAL_SECRET, and lib/assets.ts bakes NEXT_PUBLIC_MESH_ASSET_BASE_URL
# into the client bundle.
ARG DATABASE_URL="postgresql://postgres@db:5432/anatomy"
ARG FASTAPI_URL="http://backend:8000"
ARG NEXTAUTH_URL="/"
ARG NEXTAUTH_SECRET="build-time-placeholder-change-me"
ARG AUTH_INTERNAL_SECRET="build-time-placeholder-change-me"
ARG NEXT_PUBLIC_MESH_ASSET_BASE_URL=""

ENV DATABASE_URL=${DATABASE_URL} \
    FASTAPI_URL=${FASTAPI_URL} \
    NEXTAUTH_URL=${NEXTAUTH_URL} \
    NEXTAUTH_SECRET=${NEXTAUTH_SECRET} \
    AUTH_INTERNAL_SECRET=${AUTH_INTERNAL_SECRET} \
    NEXT_PUBLIC_MESH_ASSET_BASE_URL=${NEXT_PUBLIC_MESH_ASSET_BASE_URL} \
    NEXT_TELEMETRY_DISABLED=1

RUN node node_modules/prisma/build/index.js generate --schema=prisma/schema.prisma
RUN npm run build

# ---- 3. runtime ------------------------------------------------------------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# standalone server (next.config.ts -> output: "standalone")
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# static assets (GLBs, manifest, Draco decoder, overlays config)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# prisma query-compiler wasm + schema (runtime data access)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
