# Bug Ledger

| Date | Root Cause | Affected Files | Regression Test | Fix Commit | Prevention Note |
|------|-----------|----------------|-----------------|------------|-----------------|
| — | — | — | — | — | Initial build — no bugs logged yet |
| 2026-09-30 | WORKSPACES-500: Next.js rewrite proxy baked `http://localhost:3001` at build time; inside Docker web container `localhost` = self, not the API service → ECONNREFUSED → 500 for every `/api/*` request. | `apps/web/next.config.ts`, `apps/web/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `apps/api/src/app.ts` | `apps/api/src/__tests__/workspaces.test.ts` — "error handler logs err.stack and reqId on route errors" + "returns 200 with seeded Semiconductors workspace for brand-new user" | ead6809 (squash-merge of hotfix/workspace-seed-500, PR #1) | Server-side proxy destinations must use `INTERNAL_API_URL` (Docker service name), not `NEXT_PUBLIC_API_URL` (public LAN URL baked only at build time). |
| 2026-10-05 | AUTH-MISMATCH: `apps/web/auth.ts` uses `session: { strategy: "jwt" }` (Auth.js JWE cookie, no Postgres session row). `apps/api/src/plugins/auth.ts` did `prisma.session.findUnique(...)` which always returned `null` because JWT strategy never writes session rows → every cookie-authenticated request returned 401. | `apps/api/src/plugins/auth.ts`, `apps/api/src/__tests__/auth.test.ts`, `apps/api/package.json`, `pnpm-lock.yaml` | `apps/api/src/__tests__/auth.test.ts` — 5 new JWE cases: valid HTTP cookie, valid HTTPS cookie, expired JWE, malformed cookie, wrong-secret JWE | (see commit on hotfix/web-api-auth-mismatch) | If any future refactor changes `session: { strategy: "jwt" }` in `apps/web/auth.ts`, the `verifySessionPlugin` in `apps/api/src/plugins/auth.ts` MUST be updated in the same commit — the `decode()` call is coupled to JWT strategy. |
| 2026-10-05 | CANDLES-FINNHUB-403: Finnhub moved `/stock/candle` to a paid tier (upstream change in 2024). The free `FINNHUB_API_KEY` returns 403 "You don't have access to this resource" for every candle request → `GET /api/candles` returned 500 → every workspace chart stuck on "loading chart data". Masked since Phase 1 (2026-09-27) first by the workspace-seed 500, then by the auth 401. | `apps/api/src/services/finnhub.ts` (removed `getCandles`), `apps/api/src/services/alphaVantage.ts` (new), `apps/api/src/services/candles.ts` (new re-export), `apps/api/src/routes/market.ts`, `apps/api/src/__tests__/alphaVantage.test.ts` (new), `apps/api/src/__tests__/market.test.ts`, `apps/api/src/__tests__/finnhub.test.ts`, `apps/api/src/__tests__/setup.ts`, `.env.example`, `README.md`, `CONTRACTS.md` | 40 new unit tests in `alphaVantage.test.ts` covering resolution map, response transform (incl. defensive `*Time Series*` key picking, ascending sort, invalid-row drop, no_data fallback), error payload classification (unknown symbol / quota / unexpected), cache hit path, per-resolution TTL (24h D/W/M, 5min intraday), rate-limit cool-off window, API-key leak scrub. 3 new route-level tests in `market.test.ts` covering 200 Finnhub-shaped payload from Alpha Vantage, 200 `{s:"no_data"}` for unknown symbol, 429 rate-limited. | (see PR against main) | Swap candle provider via `services/candles.ts` re-export — route layer must stay provider-agnostic. If `apps/web/*` ever reaches past `/api/candles` into the service layer (it shouldn't), that import path becomes the choke point for future provider swaps. Alpha Vantage free tier is 25 req/day; the 24h D/W/M cache keeps a single user comfortably under the cap. |

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

## AUTH-MISMATCH (2026-10-05)

### Symptoms

Every authenticated dashboard load returned HTTP 401 from `GET /api/workspaces`:
```
GET /api/workspaces → 401 Unauthorized (8ms)
```
Browser showed: "Could not load workspaces. Something went wrong on our end."

### Root Cause

`apps/web/auth.ts` configures Auth.js v5 with `session: { strategy: "jwt" }`. Under JWT strategy the session token is stored as a **JWE (encrypted JWT)** in a cookie (`__Secure-authjs.session-token` on HTTPS, `authjs.session-token` on HTTP). **No row is ever written to the Postgres `sessions` table**.

`apps/api/src/plugins/auth.ts` (the `verifySessionPlugin`) was doing:
```ts
const session = await prisma.session.findUnique({ where: { sessionToken } });
```
Because JWT strategy never writes a `sessions` row, `findUnique` returned `null` → 401 for every cookie-authenticated request. The two services had been incompatible since Phase 1 (2026-09-27). The Bearer-JWT branch still worked (exercised by tests), masking the problem until actual browser sessions were tested.

### Fix

Replaced the `prisma.session.findUnique(...)` call with `decode()` from `@auth/core/jwt` (Auth.js's public JWE decoding API). The decoded payload provides `id` and `email` directly from the cookie. No DB lookup needed.

Critical detail: the **salt** passed to `decode()` must equal the **cookie name** exactly. A mismatch causes a silent null return (not an error). The plugin now detects which cookie name was used and passes it as the salt:
- `__Secure-authjs.session-token` → HTTPS path (Cloudflare, `https://alpha.wunderware.app`)
- `authjs.session-token` → HTTP path (LAN, `http://192.168.0.162:3002`)

`@auth/core` was pinned at exact version `0.41.3` (matching what `next-auth@5.0.0-beta.32` resolves) in `apps/api/package.json`.

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/plugins/auth.ts` | Removed `prisma` import + `prisma.session.findUnique`. Added `decode` from `@auth/core/jwt`. Rewrote cookie branch. |
| `apps/api/src/__tests__/auth.test.ts` | Replaced Prisma-mock cookie tests with real JWE encode/decode fixtures. Added HTTPS cookie, expired, malformed, wrong-secret cases (+3 tests, 5→8). |
| `apps/api/package.json` | Added `"@auth/core": "0.41.3"` (exact pin) to dependencies. |
| `pnpm-lock.yaml` | Updated lockfile. |

### Regression Tests Added

In `apps/api/src/__tests__/auth.test.ts`:
1. Valid JWE in `authjs.session-token` cookie → 200 (HTTP/LAN path)
2. Valid JWE in `__Secure-authjs.session-token` cookie → 200 (HTTPS/Cloudflare path)
3. Expired JWE (maxAge: -60, beyond 15s clockTolerance) → 401
4. Malformed cookie value → 401
5. JWE encoded with wrong secret → 401

### Prevention

If any future refactor changes `session: { strategy: "jwt" }` in `apps/web/auth.ts` (e.g. switching to DB strategy), the `decode()` call in `apps/api/src/plugins/auth.ts` must be updated in the same commit. A warning comment is present in the plugin.

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
