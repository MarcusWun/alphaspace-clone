# ---- base ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile --filter web --filter @alpha/db --filter @alpha/types

# ---- build ----
FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/db ./packages/db
COPY packages/types ./packages/types
ENV NEXT_TELEMETRY_DISABLED=1
# INTERNAL_API_URL is the server-side proxy target used by next.config.ts
# rewrites(). Must be the Docker-internal service name so the web container
# can reach the API container on the Docker bridge network.
# WORKSPACES-500 root cause: this was missing, causing next.config.ts to bake
# "http://localhost:3001" (unreachable inside the web container) at build time.
ARG INTERNAL_API_URL=http://api:3001
ENV INTERNAL_API_URL=$INTERNAL_API_URL
# Build workspace packages that web depends on before building web itself.
# pnpm --filter web build does NOT build transitive workspace deps, so
# @alpha/db and @alpha/types must be built explicitly or the next build
# fails with TS2307 Cannot find module '@alpha/db' / '@alpha/types'.
# @alpha/db imports @prisma/client, so prisma generate must run first.
RUN pnpm --filter @alpha/db exec prisma generate \
 && pnpm --filter @alpha/types build \
 && pnpm --filter @alpha/db build
RUN pnpm --filter web build

# ---- dev target ----
FROM deps AS dev
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/db ./packages/db
COPY packages/types ./packages/types
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "dev"]

# ---- prod ----
FROM node:24-alpine AS prod
# curl is required by the docker-compose healthcheck for this service.
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js standalone server otherwise binds only to the container hostname,
# which prevents the docker-compose healthcheck (curl localhost:3000) from
# reaching it. HOSTNAME=0.0.0.0 makes it listen on all interfaces.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
