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
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
