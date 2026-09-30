# Bug Ledger

| Date | Root Cause | Affected Files | Regression Test | Fix Commit | Prevention Note |
|------|-----------|----------------|-----------------|------------|-----------------|
| — | — | — | — | — | Initial build — no bugs logged yet |
| 2026-09-30 | WORKSPACES-500: Next.js rewrite proxy baked `http://localhost:3001` at build time; inside Docker web container `localhost` = self, not the API service → ECONNREFUSED → 500 for every `/api/*` request. | `apps/web/next.config.ts`, `apps/web/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `apps/api/src/app.ts` | `apps/api/src/__tests__/workspaces.test.ts` — "error handler logs err.stack and reqId on route errors" + "returns 200 with seeded Semiconductors workspace for brand-new user" | hotfix/workspace-seed-500 | Server-side proxy destinations must use `INTERNAL_API_URL` (Docker service name), not `NEXT_PUBLIC_API_URL` (public LAN URL baked only at build time). |

---

## WORKSPACES-500 (2026-09-30)

### Reproduction

1. Fresh user created via `POST /api/auth/signup` (`hotfix-test@example.com`).
2. Signed in via Auth.js credentials provider at `http://localhost:3002`.
3. Called `GET /api/workspaces` via curl with the `authjs.session-token` cookie through the Next.js proxy (port 3002).
4. Response: **HTTP 500 Internal Server Error**.

Reproduced with: `curl -b /tmp/test_cookies.txt http://localhost:3002/api/workspaces`

### Fastify/API log — no entry

The error occurred inside the Next.js web container **before** the request reached the Fastify API. No Fastify log entry was written for this request. The Fastify API was confirmed healthy via direct Bearer JWT test (`GET http://localhost:3001/api/workspaces` → 200).

### Verbatim error trace — Next.js web container (`docker compose logs web`)

```
Failed to proxy http://localhost:3001/api/workspaces AggregateError:
    at ignore-listed frames {
  code: 'ECONNREFUSED',
  [errors]: [
    Error: connect ECONNREFUSED ::1:3001
        at <unknown> (Error: connect ECONNREFUSED ::1:3001) {
      errno: -111,
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '::1',
      port: 3001
    },
    Error: connect ECONNREFUSED 127.0.0.1:3001
        at <unknown> (Error: connect ECONNREFUSED 127.0.0.1:3001) {
      errno: -111,
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 3001
    }
  ]
}
```

### Root Cause

`apps/web/next.config.ts` line 3:
```typescript
const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
```

`NEXT_PUBLIC_API_URL` is a browser-client env var. It is **not** passed as a Docker build ARG in `apps/web/Dockerfile`. During `docker build`, `process.env["NEXT_PUBLIC_API_URL"]` is `undefined`, so `apiUrl` defaults to `"http://localhost:3001"`. Next.js bakes this value into the compiled standalone server's rewrite routing configuration. At runtime inside the Docker web container, `localhost:3001` resolves to the container itself — the Fastify API runs at `api:3001` on the Docker internal network, not on `localhost`. Every proxied `/api/*` call triggers ECONNREFUSED, which Next.js surfaces as HTTP 500.

### Why Bearer JWT direct calls passed

Direct calls to `http://localhost:3001/api/workspaces` from the host machine work because port 3001 is published (`0.0.0.0:3001 → container:3001`). The bug only affects requests routed **through the Next.js proxy inside the web Docker container**.

### Fix summary

1. `apps/web/next.config.ts` — use `INTERNAL_API_URL` (server-side) for the rewrite destination
2. `apps/web/Dockerfile` — `ARG INTERNAL_API_URL=http://api:3001` + `ENV INTERNAL_API_URL=$INTERNAL_API_URL` before `pnpm build` in the builder stage
3. `docker-compose.yml` — `build.args.INTERNAL_API_URL: http://api:3001`
4. `docker-compose.dev.yml` — `INTERNAL_API_URL: http://api:3001` in web environment
5. `apps/api/src/app.ts` — global error handler: use `request.log.error` (adds `reqId` via Fastify request-scoped logger), log route + userId explicitly

### Same-class bug search

All `process.env["NEXT_PUBLIC_*"]` usages in server-side files audited. Only `NEXT_PUBLIC_API_URL` was used as a server-side proxy destination. All other `NEXT_PUBLIC_*` usages are in React component/hook code (client-safe). No other baked-URL proxy patterns found.

---

## Known Risks

| Risk | Symptom | Impact | Migration Owner | Workaround |
|------|---------|--------|-----------------|------------|
| Next.js middleware deprecation | Build warning: `middleware` is deprecated in favour of `proxy` (Next.js 16.3+) | Non-breaking — Phase 1 auth middleware still functions correctly | Frontend — Phase 2 | None required for Phase 1; migrate `apps/web/middleware.ts` to the `proxy` pattern before Phase 2 deployment |

## QA Carryovers (Non-Blocking — Logged at Deployment, 2026-09-27)

| ID | Source | Description | Owner | Action |
|----|--------|-------------|-------|--------|
| NB-2 | QA Gate 2 | Panel-linking E2E test (`apps/web/src/__tests__/panelLinking.test.ts`) uses a synthetic Zustand subscriber to assert cross-panel ticker sync. A full end-to-end test rendering `WatchlistPanel` + `NewsFeedPanel` side-by-side in a real DOM and asserting the cross-panel re-render is needed to close this gap. | Frontend — Phase 2 | Add integration test in Phase 2 sprint. |
| NB-3 | PRD §10 | PRD §10 says "Sign in via Clerk" — stale wording. Implementation uses Auth.js v5 (NextAuth). No code change needed; PRD correction required. | CTO | Route to CTO for PRD v1.2 correction. |
| NB-4 | `.nvmrc` vs CI | `.nvmrc` specifies Node 24; current GitHub Actions runner and A9 runner use Node 22. Either bump the A9 runner to Node 24 or relax `engines.node` in `package.json` from `>=24` to `>=22`. | Marcus | Marcus's call — runner upgrade or engine relax before Phase 2. |
