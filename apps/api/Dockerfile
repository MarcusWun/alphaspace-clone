# ---- base ----
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile --filter api --filter @alpha/db --filter @alpha/types

# ---- build ----
FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/types ./packages/types
# Build workspace packages that api depends on before building api itself.
# pnpm --filter api build does NOT build transitive workspace deps, so
# @alpha/db and @alpha/types must be built explicitly or the api tsc pass
# fails with TS2307 Cannot find module '@alpha/db' / '@alpha/types'.
# @alpha/db imports @prisma/client, so prisma generate must run first.
RUN pnpm --filter @alpha/db exec prisma generate \
 && pnpm --filter @alpha/types build \
 && pnpm --filter @alpha/db build
RUN pnpm --filter api build

# ---- dev target ----
FROM deps AS dev
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/types ./packages/types
EXPOSE 3001
CMD ["pnpm", "--filter", "api", "dev"]

# ---- prod ----
FROM node:24-alpine AS prod
# curl is required by the docker-compose healthcheck for this service.
RUN apk add --no-cache curl \
 && corepack enable \
 && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist
RUN pnpm install --frozen-lockfile --filter api --filter @alpha/db --filter @alpha/types --prod
# Regenerate the Prisma client in the prod image — pnpm install --prod
# reinstalls @prisma/client cleanly but does not run prisma generate, so
# the generated client at node_modules/.prisma/client would otherwise be
# missing at runtime. The prisma CLI itself is a devDep so pnpm dlx is
# used to run it without installing it into the prod node_modules.
WORKDIR /app/packages/db
RUN pnpm dlx prisma@6.19.3 generate
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
USER nodeapp

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["node", "apps/api/dist/index.js"]
