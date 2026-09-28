# Alpha — Quality Gates

Run these commands from the **repo root** before merging any PR or cutting a release.

## Install

```bash
pnpm install
```

## Lint

```bash
pnpm -w lint
```

Expected: 0 errors.

## Type Check

```bash
pnpm -w typecheck
```

Expected: 0 errors.

## Tests

```bash
pnpm -w test
```

Expected: all tests passing, 0 failures.

## Build

```bash
pnpm -w build
```

Expected: all packages and apps build without errors.

## Local Smoke Test

```bash
cp .env.example .env
# Fill in FINNHUB_API_KEY and AUTH_SECRET
docker compose up --build
```

Expected:
- `http://localhost:3000` returns 200 (Next.js web)
- `http://localhost:3001/healthz` returns `{"status":"ok",...}`
- All four containers report `healthy` in `docker compose ps`

## Known Risks

1. **Cross-user data leaks** — every Prisma query must filter by `userId`. Integration test AS-BE-15 covers two-user isolation.
2. **FINNHUB_API_KEY in responses** — regression test asserts the raw key never appears in proxy response bodies.
3. **Layout restore edge cases** — `sanitizeLayout()` must drop unknown panel IDs without corrupting grid positions.
4. **Seed idempotency** — `ensureStarterWorkspace` is guarded by a count check; calling it twice must not create two workspaces.
5. **Cache hit ratio** — candle cache TTL is 300s. Under normal browsing the hit ratio should exceed 90%.
6. **Upstream Finnhub 429 handling** — p-queue rate limiter caps at 60 req/min. If Finnhub still returns 429, the error propagates as 502.
7. **Auth.js session expiry** — expired sessions return 401; client must handle redirect to sign-in.
8. **Finnhub WebSocket reconnect** — exponential backoff with cap at 30s. Redis pub/sub channels may miss ticks during reconnect window.

## Release Criteria (Phase 1)

- [ ] All quality gates above pass with 0 errors
- [ ] `docker compose up` boots all four services healthy
- [ ] New user signup → Semiconductors workspace visible
- [ ] Workspace save/load round-trips correctly
- [ ] Two users cannot see each other's data
- [ ] FINNHUB_API_KEY absent from all client-visible responses
- [ ] `/healthz` reports healthy when Postgres and Redis are up
