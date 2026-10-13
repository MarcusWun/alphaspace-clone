# Bug Ledger

| Date | Root Cause | Affected Files | Regression Test | Fix Commit | Prevention Note |
|------|-----------|----------------|-----------------|------------|-----------------|
| — | — | — | — | — | Initial build — no bugs logged yet |
| 2026-10-13 | **CLOUD-DORMANT-DEFAULT** — risk that a stale or placeholder `ANTHROPIC_API_KEY` silently activates cloud escalation, routing user queries to Anthropic unexpectedly or incurring surprise API costs. | `apps/api/src/services/ai/cloudConfig.ts`, `.env.example`, `docker-compose.yml` | `apps/api/src/__tests__/ai/cloudConfig.test.ts` — 6 unit tests: unset → false; empty string → false; `your_anthropic_api_key_here` placeholder → false; any `your_*` prefix → false; 15-char key → false; 40-char `sk-ant-api03-...` stub → true. | (Phase 3a commit) | `isCloudConfigured()` rejects any key with `your_*` prefix or length < 20. Do NOT bake real keys into `.env.example`, `docker-compose.yml` defaults, or committed test fixtures. Real key activates only on deliberate `restart` after setting the var in A9 `.env`. |
| 2026-09-30 | WORKSPACES-500: Next.js rewrite proxy baked `http://localhost:3001` at build time; inside Docker web container `localhost` = self, not the API service → ECONNREFUSED → 500 for every `/api/*` request. | `apps/web/next.config.ts`, `apps/web/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `apps/api/src/app.ts` | `apps/api/src/__tests__/workspaces.test.ts` — "error handler logs err.stack and reqId on route errors" + "returns 200 with seeded Semiconductors workspace for brand-new user" | ead6809 (squash-merge of hotfix/workspace-seed-500, PR #1) | Server-side proxy destinations must use `INTERNAL_API_URL` (Docker service name), not `NEXT_PUBLIC_API_URL` (public LAN URL baked only at build time). |
| 2026-10-05 | AUTH-MISMATCH: `apps/web/auth.ts` uses `session: { strategy: "jwt" }` (Auth.js JWE cookie, no Postgres session row). `apps/api/src/plugins/auth.ts` did `prisma.session.findUnique(...)` which always returned `null` because JWT strategy never writes session rows → every cookie-authenticated request returned 401. | `apps/api/src/plugins/auth.ts`, `apps/api/src/__tests__/auth.test.ts`, `apps/api/package.json`, `pnpm-lock.yaml` | `apps/api/src/__tests__/auth.test.ts` — 5 new JWE cases: valid HTTP cookie, valid HTTPS cookie, expired JWE, malformed cookie, wrong-secret JWE | (see commit on hotfix/web-api-auth-mismatch) | If any future refactor changes `session: { strategy: "jwt" }` in `apps/web/auth.ts`, the `verifySessionPlugin` in `apps/api/src/plugins/auth.ts` MUST be updated in the same commit — the `decode()` call is coupled to JWT strategy. |
| 2026-10-05 | CANDLES-FINNHUB-403: Finnhub moved `/stock/candle` to a paid tier (upstream change in 2024). The free `FINNHUB_API_KEY` returns 403 "You don't have access to this resource" for every candle request → `GET /api/candles` returned 500 → every workspace chart stuck on "loading chart data". Masked since Phase 1 (2026-09-27) first by the workspace-seed 500, then by the auth 401. | `apps/api/src/services/finnhub.ts` (removed `getCandles`), `apps/api/src/services/alphaVantage.ts` (new), `apps/api/src/services/candles.ts` (new re-export), `apps/api/src/routes/market.ts`, `apps/api/src/__tests__/alphaVantage.test.ts` (new), `apps/api/src/__tests__/market.test.ts`, `apps/api/src/__tests__/finnhub.test.ts`, `apps/api/src/__tests__/setup.ts`, `.env.example`, `README.md`, `CONTRACTS.md` | 40 new unit tests in `alphaVantage.test.ts` covering resolution map, response transform (incl. defensive `*Time Series*` key picking, ascending sort, invalid-row drop, no_data fallback), error payload classification (unknown symbol / quota / unexpected), cache hit path, per-resolution TTL (24h D/W/M, 5min intraday), rate-limit cool-off window, API-key leak scrub. 3 new route-level tests in `market.test.ts` covering 200 Finnhub-shaped payload from Alpha Vantage, 200 `{s:"no_data"}` for unknown symbol, 429 rate-limited. | (see PR against main) | Swap candle provider via `services/candles.ts` re-export — route layer must stay provider-agnostic. If `apps/web/*` ever reaches past `/api/candles` into the service layer (it shouldn't), that import path becomes the choke point for future provider swaps. Alpha Vantage free tier is 25 req/day; the 24h D/W/M cache keeps a single user comfortably under the cap. |

| 2026-10-06 | CANDLES-FE-RETRY-STORM: `ComparisonChartPanel` computed `from`/`to` timestamps via `timeRangeToUnix()` (which calls `Date.now()`) on every render without `useMemo`. The queryKey `["candles", symbol, resolution, from, to]` changed every second as `Date.now()` advanced during retry delays. TanStack Query treated each new key as a new query — the old query was abandoned, retries reset to 0, and the query never exhausted. Effect: the chart showed a permanent loading spinner; the "Chart data unavailable" error state was never reached. AV's 429 sentinel was also refreshed on every reset, compounding the AV rate-limit bug. | `apps/web/components/panels/ComparisonChartPanel.tsx` | `apps/web/__tests__/chartToggle.test.tsx` — "shows 'Chart data unavailable' with Retry button after all retries exhausted" (times out if from/to are unstable; passes in 7s with memoised keys). "Retry button triggers a fresh fetch and clears error on success". | (this commit) | ALWAYS wrap `timeRangeToUnix()` (and any `Date.now()`-derived param) in `useMemo` keyed on `[timeRange, customFromDate, customToDate]` before using the result in a queryKey. A queryKey containing an unstable value creates a new query every render — the query never accumulates failure count and retries never exhaust. |

| 2026-10-06 | CANDLES-AV-OUTPUTSIZE-FULL: `apps/api/src/services/alphaVantage.ts` hardcoded `outputsize=full` in the AV query. `outputsize=full` is a premium-tier feature; free-tier keys return a 200 with `{"Information": "..."}` → `classifyPayload` correctly identifies this as quota exhaustion → sets `alphavantage:ratelimited` sentinel for 60s → subsequent candle requests short-circuit to 429. Because the frontend kept retrying on 429, every retry refreshed the sentinel → permanent broken state: no candle data ever loads. | `apps/api/src/services/alphaVantage.ts` (removed, moved), `apps/api/src/services/candles/alphaVantage.ts` (new), `apps/api/src/services/candles/index.ts`, `apps/api/src/services/candles/yahoo.ts`, `apps/api/src/services/candles/types.ts`, `apps/api/src/services/candles/errors.ts`, `apps/api/src/services/candles.ts`, `.env.example`, `docker-compose.yml`, `CONTRACTS.md` | `apps/api/src/__tests__/alphaVantage.test.ts` — "request URL does NOT contain outputsize=full (CANDLES-AV-OUTPUTSIZE-FULL regression)" test asserts URL passed to fetch never contains `outputsize`. "SENTINEL CHECK: short-circuits with QuotaExceededError and never enqueues when sentinel is set" asserts fetch is never called when sentinel is active. | (see commit on feat/candles-yahoo-and-chart-toggle) | (1) Never add `outputsize=full` to AV queries — it is a premium feature. The free-tier compact response (last 100 bars) is sufficient and is what AV returns by default. (2) Always test request shape against free-tier docs before shipping. (3) Yahoo Finance 2 is now the default provider; AV is a fallback only. |

| 2026-10-11 | CANDLES-RATE-LIMIT-HARDENING: Three compounding backend-owned bugs caused persistent Yahoo rate-limiting on the A9 workspace. (1) Cache-key bug: `yahoo:candles:<sym>:<res>:<from>:<to>` used exact request seconds, so every unique from/to (frontend sends `Date.now()` on every poll) was a cache miss → Yahoo hit on every request instead of once per day. (2) No 429 handling: when Yahoo returned the text `"Too Many Requests"`, the library threw a `SyntaxError`. The service caught this as a generic `UpstreamError` → re-threw → route returned 502 → frontend retried → sentinel never set → IP stayed in permanent rate-limit. | `apps/api/src/services/candles/yahoo.ts`, `apps/api/src/services/candles/alphaVantage.ts`, `apps/api/src/services/candles/index.ts`, `apps/api/src/services/candles/types.ts`, `apps/api/src/routes/market.ts`, `apps/api/package.json`, `pnpm-lock.yaml`, `CONTRACTS.md` | `apps/api/src/__tests__/yahoo.test.ts` — bucketedKey same-day/cross-day, isRateLimitError cases, sentinel cool-off (no upstream call), stale cache fallback on 429. `apps/api/src/__tests__/market.test.ts` — X-Candles-Status header set, rateLimited/stale stripped from body. `apps/api/src/__tests__/candles-index.test.ts` — sliceCandles boundary, empty-overlap, meta flag preservation. | 058fd03 | (1) Always test cache keys with `vi.setSystemTime` to confirm steady-state collapses to a single key per day/5min. (2) Always catch `SyntaxError` on upstream JSON-shaped responses and classify as upstream throttle before rethrow. (3) Cache keys MUST NOT include volatile per-request values (`from`/`to` seconds) for long-lived data — use time-bucketed keys. |
| 2026-10-11 | CANDLES-FE-STORM-ROUND2: `useCandles` hook and `ComparisonChartPanel` were using `fetchCandles` (via `apiClient.get`) which discards response headers, making the `X-Candles-Status: rate_limited` signal invisible to the frontend. Additionally: (1) `useCandles` still accepted `from`/`to` as caller args, making it possible for callers to pass `Date.now()`-derived values again; (2) `ComparisonChartPanel`'s `from`/`to` useMemo was keyed on `[timeRange, customFromDate, customToDate]` but `bucketedFrom/bucketedTo` depend on `resolution` — adding `resolution` to the memo dep-array and computing resolution first was required; (3) `candleQueryConfig` still had `staleTime: 300_000` and `retry: failureCount < 3` (3 retries), compounding the retry storm risk; (4) no rate-limited banner existed, so users saw an empty chart with no explanation during cool-off. | `apps/web/lib/queries/useCandles.ts`, `apps/web/lib/queries/market.ts`, `apps/web/components/panels/ComparisonChartPanel.tsx`, `apps/web/__tests__/useCandlesHook.test.tsx` (new), `apps/web/__tests__/chartToggle.test.tsx`, `apps/web/__tests__/comparisonChart.test.tsx`, `CONTRACTS.md` | `apps/web/__tests__/useCandlesHook.test.tsx` — 9 new tests: single-flight (10 concurrent), 2-component dedup, bucket-stability +1s, bucket-stability +25h, rateLimited no-retry (resolve), rateLimited no-retry (reject), banner shows with rateLimited:true, banner absent with rateLimited:false, chart-type toggle stability. | (this commit) | (1) `useCandles` MUST NOT accept `from`/`to` args — bucket boundaries are internal. Callers that need custom ranges should NOT use `useCandles`; they should call `fetchCandlesWithMeta` directly in `useQueries`. (2) `fetchCandlesWithMeta` uses `fetch()` directly (not `apiClient.get`) so headers are readable. (3) `candleQueryConfig` retry cap must match the backend sentinel TTL: 1 retry is enough with 15-min sentinel. (4) Always use `resolution` in the dep-array of any memo that feeds `bucketedFrom/bucketedTo`. |

| 2026-10-11 | PHASE-2A-FUNDAMENTALS-ADDED | No bug; feature addition — fundamentals service + 5 Finnhub proxy routes added (Phase 2a P1). See CONTRACTS.md "Fundamentals (Phase 2a)" section. Baseline was clean (141/141 api tests). FinnhubError typed class added to `services/finnhub.ts`; `finnhubFetch` and `cachedFetch` exported; `cachedFetchWithMeta` added. New files: `services/fundamentals.ts`, `routes/fundamentals.ts`. Tests: +29 (12 service, 17 route). | — | — | — | — |

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

## CANDLES-AV-OUTPUTSIZE-FULL (2026-10-06)

### Symptoms

All candle requests on every workspace returned HTTP 429 after the first chart load. Refreshing the page continued to return 429. The 60-second cool-off sentinel never cleared because the frontend retry loop kept refreshing it.

### Root Cause

`alphaVantageFetch()` in `services/alphaVantage.ts` included `outputsize=full` in every AV request:

```typescript
url.searchParams.set("outputsize", "full");
```

`outputsize=full` is a **premium-tier** parameter. Alpha Vantage free-tier keys return HTTP 200 with:
```json
{ "Information": "Thank you for using Alpha Vantage! This is a premium endpoint..." }
```

`classifyPayload()` correctly identifies `Information` as quota exhaustion → calls `redis.set("alphavantage:ratelimited", "1", "EX", 60)`. Because the frontend was retrying on 429, every retry hit the route → route threw QuotaExceededError (sentinel check) → returned 429 → frontend retried → refreshed the sentinel. Permanent broken state: sentinel was kept alive indefinitely.

### Why It Was Also a Provider Architecture Issue

The real fix is that Yahoo Finance 2 is now the default provider (`CANDLES_PROVIDER=yahoo`). Alpha Vantage is retained as a fallback only, with the `outputsize=full` bug fixed in the rewritten `services/candles/alphaVantage.ts`.

### Fix Summary

1. Removed `url.searchParams.set("outputsize", "full")` from `alphaVantageFetch()`.
2. Changed PQueue from `intervalCap: 5, interval: 60_000` to `intervalCap: 1, interval: ~1000ms` (1 req/sec, matching actual free-tier burst limit).
3. Created `services/candles/` provider directory with Yahoo as default.
4. Updated cache key to include `from:to` so distinct windows don't collide.
5. Confirmed sentinel check is BEFORE `queue.add()` — added regression test.

### Regression Tests Added

In `apps/api/src/__tests__/alphaVantage.test.ts`:
- "request URL does NOT contain outputsize=full (CANDLES-AV-OUTPUTSIZE-FULL regression)" — captures the URL argument to `fetch` and asserts no `outputsize` param.
- "SENTINEL CHECK: short-circuits with QuotaExceededError and never enqueues when sentinel is set" — asserts `fetch` is never called when the sentinel Redis key is set.

### Prevention

1. **Never use `outputsize=full`** on Alpha Vantage free-tier keys. The compact response (last 100 bars) is what the free tier provides by default.
2. **Test request shape against free-tier docs before shipping** any provider integration.
3. **Yahoo Finance 2 is now the default.** AV is a fallback only — set `CANDLES_PROVIDER=alphaVantage` in `.env` to activate it. Demoing with AV against a single workspace will exhaust 25 req/day quickly.

| 2026-10-13 | **AI-HISTORY-PERSISTENCE** — `routes/ai.ts` persisted the full assistant turn as a single row with both `content` and `tool_calls` set together, and never persisted `tool_result` events as `role=tool` rows. On the next prompt, `historyToMessages` emitted an assistant message with `tool_calls` but no following `tool` row → Ollama rejected the conversation shape with 400 Bad Request within 38ms (too fast for inference — Ollama rejects before generation). | `apps/api/src/routes/ai.ts`, `apps/api/src/services/ai/historyLoader.ts` (new), `apps/api/src/services/ai/ollama.ts`, `apps/api/src/services/ai/anthropic.ts` | 3 in `apps/api/src/__tests__/ai/ai.routes.test.ts` (single tool call 4-row shape, multi-tool batched call, pure content turn) + 4 in `apps/api/src/__tests__/ai/historyLoader.test.ts` (well-formed pass-through, malformed middle drop, multi-tool-call well-formed, multi-tool partial match) | (see commit on hotfix/ai-history-persistence) | Reducer-first discipline for any future stream-time persistence (never persist mid-stream, never combine protocol-distinct turns into one row). Sanitizer `sanitizeHistory` tolerates legacy malformed rows at load time so no destructive one-time migration is needed. |

---

## AI-HISTORY-PERSISTENCE (2026-10-13)

- **Root cause:** `routes/ai.ts` persisted the full assistant turn as a single row with both `content` and `tool_calls` set together, and never persisted `tool_result` events as `role=tool` rows. On the next prompt, `historyToMessages` emitted an assistant message with `tool_calls` but no following `tool` row → Ollama rejected the conversation shape with 400 Bad Request within 38ms.
- **Affected files:** `apps/api/src/routes/ai.ts`, `apps/api/src/services/ai/historyLoader.ts` (new), `apps/api/src/services/ai/ollama.ts`, `apps/api/src/services/ai/anthropic.ts`.
- **Regression tests:** 3 in `__tests__/ai/ai.routes.test.ts` (single/multi/pure-content persistence) + 4 in `__tests__/ai/historyLoader.test.ts` (sanitizer).
- **Fix commit:** acaa7e5
- **Prevention:** Reducer-first discipline for any future stream-time persistence (never persist mid-stream, never combine protocol-distinct turns into one row). Sanitizer `sanitizeHistory` tolerates legacy malformed rows at load time so no destructive one-time migration is needed.

| 2026-10-13 | **AI-TOOL-CALL-ORDERING** — `ollama.ts` built follow-up `messages` array with `{role:"tool"}` results BEFORE the `{role:"assistant", tool_calls:[...]}` message. Ollama's `/v1/chat/completions` endpoint mirrors the OpenAI chat protocol which requires assistant(tool_calls) to precede all tool-result messages. Invalid ordering caused Ollama to return 0 tokens on the second turn (`ai.chat.done assistantTokens=0`, 87s turn). **Audit finding:** Anthropic path ordering was already correct (assistant(tool_use) before user(tool_result)); a latent field-name bug `id` vs `tool_use_id` in the tool_result content block was also fixed. | `apps/api/src/services/ai/ollama.ts` (primary fix: collect results, push assistant FIRST, then tool-role messages); `apps/api/src/services/ai/anthropic.ts` (audit: ordering correct; `tool_use_id` field name corrected); `apps/api/src/services/ai/types.ts` (new `error` ChatEvent variant); `apps/api/src/routes/ai.ts` (handle error event to end stream cleanly) | `apps/api/src/__tests__/ai/ollama.test.ts` — ORDERING-REGRESSION: second-turn messages array has assistant(tool_calls) at lower index than tool-role message; TIMEOUT-REGRESSION: AbortSignal timeout fires, `ai.ollama.timeout` log emitted, error event yielded. `apps/api/src/__tests__/ai/anthropic.test.ts` — ORDERING-REGRESSION: second-turn messages array has assistant(tool_use) before user(tool_result); `tool_use_id` in tool_result references matching tool_use id. | ddebc14 | Regression test asserts `messages[assistantIdx] < messages[firstToolIdx]`. Same shape test on Anthropic path. If tool-call loop is future-refactored, these tests catch the swap. |

| 2026-10-12 | 5Y-BASELINE-SLIP: `timeRangeToResolution("5Y")` returned `"W"` (weekly bars). Yahoo returns weekly bars with Friday closes; the first weekly bar after the exact 5-year anchor is ~1 week late (Yahoo week bins start Monday). `normalizeCandles` uses `candles.c[0]` as baseline → baseline ~1 week too late → percentage systematically understated. Error was ~10 pp on steady movers (MSFT 73% vs 83% correct), ~100 pp on volatile movers (NVDA 909% vs 1009% correct). Separately, all panel time-range buttons drove `from`/`to` via `bucketedFrom(resolution)` rather than a time-range-aware window — `StockChartPanel` computed `fromBucket`/`toBucket` but voided them (`void fromBucket; void toBucket;`), so `useCandles` always received the default 370-day D window regardless of selected range (NB-2 Phase 2a carry-forward). | `apps/web/lib/queries/market.ts`, `apps/web/lib/queries/useCandles.ts`, `apps/web/components/panels/ComparisonChartPanel.tsx`, `apps/web/components/panels/StockChartPanel.tsx`, `CONTRACTS.md` | `apps/web/__tests__/lib/queries/market.test.ts` (new, 14 tests): `timeRangeToResolution("5Y") === "D"`, `bucketedWindowForTimeRange` boundary assertions for all ranges, YTD Jan-1 bucketing, same-day `to` stability. `apps/web/__tests__/comparisonChart.test.tsx` (+1): selecting 5Y → fetch with `resolution="D"` and `from ≈ now-5y`. `apps/web/__tests__/panels/StockChartPanel.test.tsx` (+1): selecting 5Y → `useCandles` receives `resolution="D"` and 5y window. | (this commit) | Time-range buttons must drive BOTH `resolution` AND the `{from, to}` window together. Use `bucketedWindowForTimeRange(timeRange)` as the single source of truth for window boundaries — never `bucketedFrom(resolution)` alone. Resolution-only driving (without matching window) causes baseline slip for any range whose resolution's default window is longer than the intended range. |

---

## Known Risks

| Risk | Symptom | Impact | Migration Owner | Workaround |
|------|---------|--------|-----------------|------------|
| Next.js middleware deprecation | Build warning: `middleware` is deprecated in favour of `proxy` (Next.js 16.3+) | Non-breaking — Phase 1 auth middleware still functions correctly | Frontend — Phase 2 | None required for Phase 1; migrate `apps/web/middleware.ts` to the `proxy` pattern before Phase 2 deployment |

## QA Carryovers (Non-Blocking — Logged at Deployment, 2026-09-27)

| ID | Source | Description | Owner | Action |
|----|--------|-------------|-------|--------|
| NB-2 | QA Gate 2 | Panel-linking E2E test (`apps/web/src/__tests__/panelLinking.test.ts`) uses a synthetic Zustand subscriber to assert cross-panel ticker sync. A full end-to-end test rendering `WatchlistPanel` + `NewsFeedPanel` side-by-side in a real DOM and asserting the cross-panel re-render is needed to close this gap. | Frontend — Phase 2 | Add integration test in Phase 2 sprint. |
| NB-2-P2A | Phase 2a baseline discovery | **FIXED in hotfix/5y-baseline.** `StockChartPanel` computed `fromBucket`/`toBucket` via `bucketedFrom(resolution)` but voided both values (`void fromBucket; void toBucket;`), so `useCandles` always received the default 370-day D window regardless of selected range. 1D range rendered ~30 days of 60-min bars instead of ~2 days. Fix: `bucketedWindowForTimeRange(timeRange)` now drives `from`/`to`; `useCandles` extended to accept optional `fromOverride`/`toOverride`. | Frontend | Fixed this commit (hotfix/5y-baseline). |
| NB-3 | PRD §10 | PRD §10 says "Sign in via Clerk" — stale wording. Implementation uses Auth.js v5 (NextAuth). No code change needed; PRD correction required. | CTO | Route to CTO for PRD v1.2 correction. |
| NB-4 | `.nvmrc` vs CI | `.nvmrc` specifies Node 24; current GitHub Actions runner and A9 runner use Node 22. Either bump the A9 runner to Node 24 or relax `engines.node` in `package.json` from `>=24` to `>=22`. | Marcus | Marcus's call — runner upgrade or engine relax before Phase 2. |
