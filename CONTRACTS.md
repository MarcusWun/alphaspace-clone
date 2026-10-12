# Alpha — API Contracts

## REST Endpoints

All endpoints under `/api/*` require authentication (Auth.js session cookie or `Authorization: Bearer <jwt>`).
Exception: `/healthz` is public.

### Health

#### `GET /healthz`
- **Auth:** none
- **Response 200:**
```json
{
  "status": "ok",
  "checks": {
    "postgres": "ok",
    "redis": "ok",
    "finnhub": "ok"
  },
  "timestamp": "2026-09-27T00:00:00.000Z"
}
```
- **Response 503** (when postgres or redis fail): same shape, `status: "degraded"`, individual check = `"fail"`

---

### Market Data (Finnhub quote/news/fundamentals, Yahoo Finance candles)

#### Candle provider abstraction

The candles service selects its upstream provider via `CANDLES_PROVIDER` env var:

| Value | Provider | Notes |
|---|---|---|
| `yahoo` (default) | `yahoo-finance2` v3 npm package | No API key required; uses `chart()` for all resolutions |
| `alphaVantage` | Alpha Vantage API | Requires `ALPHA_VANTAGE_API_KEY`; hard-fail at startup if key missing |

**Provider interface** (`services/candles/types.ts`):
```ts
interface CandlesProvider {
  name: "yahoo" | "alphaVantage";
  getCandles(params: CandlesParams): Promise<CandlesResponse>;
}
interface CandlesParams { symbol: string; resolution: string; from: number; to: number; }
interface CandlesResponse {
  s: "ok" | "no_data";
  t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[];
  // Service-internal meta — NEVER included in HTTP response body; signal is via header
  rateLimited?: boolean; // provider is in rate-limit cool-off
  stale?: boolean;       // data served from expired/stale cache
}
```

**Startup log:** `[candles] provider=yahoo` or `[candles] provider=alphaVantage` — confirms active provider after restart.

**Redis cache key scheme (v2, 2026-10-11):**
- `yahoo:candles:<symbol>:<resolution>:<bucket>` — bucket = `floor(now/86_400_000)` for D/W/M; `floor(now/300_000)` for intraday. No `from`/`to` in key.
- `yahoo:candles:<symbol>:<resolution>:<bucket>:stale` — same bucket, 72h TTL; written on every successful upstream fetch. Serves as fallback during rate-limit cool-off.
- `yahoo:ratelimited` — rate-limit sentinel, 15 min TTL. Set when Yahoo returns any 429 signal.
- `alphavantage:candles:<symbol>:<resolution>:<bucket>` — same bucket format.
- `alphavantage:ratelimited` — AV rate-limit sentinel, 60s TTL.

**Route-level slicing:** providers return a full envelope (Yahoo: 10-year window for D/W/M; AV: compact 100-bar response). The `sliceCandles()` function in `services/candles/index.ts` narrows to the requested `[from, to]` window. This decouples cache granularity from request granularity.

#### `GET /api/candles`
- **Auth:** required
- **Query params:** `symbol` (string), `resolution` (enum: `1|5|15|30|60|D|W|M`), `from` (unix timestamp string), `to` (unix timestamp string)
- **Response 200 (success):** `{ "data": { s:"ok", t:number[], o:number[], h:number[], l:number[], c:number[], v:number[] } }` — Finnhub-shaped envelope (unchanged for the frontend)
- **Response 200 (unknown symbol):** `{ "data": { s:"no_data" } }` — matches Finnhub's `s:"no_data"` sentinel
- **Response 200 (rate limited):** `{ "data": { s:"no_data" } }` with **`X-Candles-Status: rate_limited`** response header — Yahoo is in 15-min cool-off; stale data served if cached, else no_data. Do NOT retry immediately. Frontend should show a banner and suppress refetch during cool-off.
- **Response 429 (AV quota):** `{ "data": { s:"error", reason:"rate_limited" } }` — Alpha Vantage daily quota exhausted (only when `provider=alphaVantage`); 60s cool-off window.
- **Response 502:** upstream provider returned unexpected shape or threw non-recoverable error
- **Errors:** 400 (invalid params), 401, 429, 502
- **Default upstream:** Yahoo Finance 2 (v3, `chart()`-only). Set `CANDLES_PROVIDER=alphaVantage` + restart to fall back.
- **Cache:** Redis, 24h TTL for D/W/M, 5min for intraday. Bucketed by `(provider, symbol, resolution, time-bucket)`.
- **`rateLimited`/`stale` meta fields:** internal service flags — **always stripped** from HTTP response body. Signal is via `X-Candles-Status` header only.

#### `GET /api/quote`
- **Auth:** required
- **Query params:** `symbol` (string)
- **Response 200:** `{ "data": <FinnhubQuoteResponse> }`
- **Cache:** Redis, TTL 30s

#### `GET /api/company-news`
- **Auth:** required
- **Query params:** `symbol`, `from` (YYYY-MM-DD), `to` (YYYY-MM-DD)
- **Response 200:** `{ "data": <FinnhubNewsItem[]> }`
- **Cache:** Redis, TTL 120s

#### `GET /api/fundamentals`
- **Auth:** required
- **Query params:** `symbol`
- **Response 200:** `{ "data": <FinnhubMetricResponse> }`
- **Cache:** Redis, TTL 3600s

**Security invariant:** `FINNHUB_API_KEY` and `ALPHA_VANTAGE_API_KEY` must never appear in any of these response bodies.

---

### Fundamentals (Phase 2a)

All five routes are under the `/api/stock/*` prefix, auth-required, rate-limited globally.

Shared implementation: `apps/api/src/services/fundamentals.ts` (five thin cached wrappers) + `apps/api/src/routes/fundamentals.ts` (five GET handlers). Both use the exported `finnhubFetch` and `cachedFetchWithMeta` from `services/finnhub.ts`. The PQueue instance (60 req/min free tier) is private in `finnhub.ts`; all callers share it transitively via `finnhubFetch`.

**FinnhubError** (`services/finnhub.ts`) — typed error class; carries `statusCode: number`. Replaces the string-based `Error("Finnhub error 429: ...")` so route handlers can catch typed errors without message parsing.

#### `GET /api/stock/metric`
- **Auth:** required
- **Query params:** `symbol` (string, required, minLength 1)
- **200 response:** `{ "data": <FinnhubStockMetricResponse> }` — raw Finnhub `/stock/metric?metric=all` passthrough
- **Sample 200:** `{ "data": { "metric": { "52WeekHigh": 502.66, "peBasicExclExtraTTM": 35.12, ... }, "symbol": "NVDA" } }`
- **Errors:** 400 (missing/empty symbol), 429 (Finnhub rate-limit), 502 (Finnhub 5xx), 500 (other)
- **Error 429:** `{ "error": "rate_limited", "statusCode": 429 }`
- **Error 502:** `{ "error": "upstream_error", "statusCode": 502 }`
- **Cache key:** `finnhub:metric:<symbol>` — TTL 86400s (24h)

#### `GET /api/stock/earnings`
- **Auth:** required
- **Query params:** `symbol` (string, required, minLength 1)
- **200 response:** `{ "data": <FinnhubEarningsResponse[]> }` — raw Finnhub `/stock/earnings` passthrough
- **Sample 200:** `{ "data": [{ "actual": 0.68, "estimate": 0.64, "period": "2026-07-27", "symbol": "NVDA", "surprise": 0.04, "surprisePercent": 6.25 }] }`
- **Errors:** 400, 429, 502, 500 (same contract as `/stock/metric`)
- **Cache key:** `finnhub:earnings:<symbol>` — TTL 86400s

#### `GET /api/stock/financials`
- **Auth:** required
- **Query params:** `symbol` (string, required, minLength 1)
- **200 response:** `{ "data": <FinnhubFinancialsReportedResponse> }` — raw `/stock/financials-reported` passthrough; Finnhub returns `{ "data": [...], "symbol": "NVDA" }` nested structure — not flattened.
- **Errors:** 400, 429, 502, 500
- **Cache key:** `finnhub:financials:<symbol>` — TTL 86400s

#### `GET /api/stock/filings`
- **Auth:** required
- **Query params:** `symbol` (string, required, minLength 1), `limit` (integer, optional, 1–50, default 10)
- **200 response:** `{ "data": <FinnhubFilingsItem[]> }` — raw `/stock/filings` passthrough
- **Sample 200:** `{ "data": [{ "form": "10-K", "filedDate": "2026-01-15", "reportUrl": "https://...", "symbol": "NVDA" }] }`
- **Errors:** 400, 429, 502, 500
- **Cache key:** `finnhub:filings:<symbol>:<limit>` — TTL 21600s (6h)

#### `GET /api/stock/recommendation`
- **Auth:** required
- **Query params:** `symbol` (string, required, minLength 1)
- **200 response:** `{ "data": <FinnhubRecommendationItem[]> }` — raw `/stock/recommendation` passthrough; monthly distribution of analyst ratings
- **Sample 200:** `{ "data": [{ "strongBuy": 10, "buy": 15, "hold": 5, "sell": 2, "strongSell": 1, "period": "2026-10-01", "symbol": "NVDA" }] }`
- **Errors:** 400, 429, 502, 500
- **Cache key:** `finnhub:recommendation:<symbol>` — TTL 86400s

**Observability log events** (pino, req-scoped, match `candles.*` naming from PR #7):

| Event | Level | Fields |
|-------|-------|--------|
| `fundamentals.cache_hit` | info | `section`, `symbol` |
| `fundamentals.cache_miss` | info | `section`, `symbol` |
| `fundamentals.upstream_call` | info | `section`, `symbol` |
| `fundamentals.rate_limited` | warn | `section`, `symbol` |

---

### Workspaces

#### `GET /api/workspaces`
- **Auth:** required
- **Response 200:** `{ "data": Workspace[] }`
- **Side effect:** Creates starter "Semiconductors" workspace if user has none (F9)

#### `POST /api/workspaces`
- **Auth:** required
- **Body:** `{ "name": string, "layout"?: WorkspaceLayout }`
- **Response 201:** `{ "data": Workspace }`
- **Errors:** 400 (validation), 401

#### `GET /api/workspaces/:id`
- **Auth:** required (owner only)
- **Response 200:** `{ "data": Workspace }`
- **Errors:** 401, 404

#### `PUT /api/workspaces/:id`
- **Auth:** required (owner only)
- **Body:** `{ "name"?: string, "layout"?: WorkspaceLayout, "chartType"?: "line" | "candles" }`
- **Response 200:** `{ "data": Workspace }` — includes `chartType` field
- **Validation:** `chartType` must be `"line"` or `"candles"`; any other value → 400
- **Layout handling:** `sanitizeLayout()` drops grid items whose `i` doesn't match a panel ID
- **`Workspace.chartType`:** persisted DB field (`String @default("line") @map("chart_type")`); frontend reads this to initialize the Line/Candles toggle

#### `DELETE /api/workspaces/:id`
- **Auth:** required (owner only)
- **Response 204:** no body
- **Errors:** 401, 404

---

### Watchlists

#### `GET /api/watchlists`
- **Auth:** required
- **Response 200:** `{ "data": Watchlist[] }`

#### `POST /api/watchlists`
- **Auth:** required
- **Body:** `{ "name": string, "tickers"?: string[] }`
- **Response 201:** `{ "data": Watchlist }`
- **Normalization:** tickers are trimmed and uppercased

#### `GET /api/watchlists/:id`
- **Auth:** required (owner only)
- **Response 200:** `{ "data": Watchlist }`

#### `PUT /api/watchlists/:id`
- **Auth:** required (owner only)
- **Body:** `{ "name"?: string, "tickers"?: string[] }`
- **Response 200:** `{ "data": Watchlist }`

#### `DELETE /api/watchlists/:id`
- **Auth:** required (owner only)
- **Response 204:** no body

---

## Workspace Layout JSONB Schema

```typescript
interface WorkspaceLayout {
  panels: PanelConfig[];
  grid: LayoutItem[];
}

interface PanelConfig {
  id: string;       // UUID — must match grid[].i
  type: PanelType;  // "watchlist" | "comparison_chart" | "stock_chart" | "news_feed" | "fundamentals" | "ai_assistant"
  title?: string;
  tickers?: string[];
  activeTicker?: string;
  timeRange?: "1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y" | "custom";
  [key: string]: unknown;
}

interface LayoutItem {
  i: string;   // panel UUID — must match a panels[].id
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}
```

**Restore invariant:** Any `grid` item whose `i` value doesn't appear in `panels[].id` is silently dropped. This prevents key drift.

---

## Redis Pub/Sub Channels

| Channel pattern       | Publisher           | Payload               | Phase |
|----------------------|---------------------|-----------------------|-------|
| `ticker:{SYM}:update` | `finnhubStream.ts`  | `FinnhubTrade[]` JSON | 1 (scaffold) → Phase 2 fan-out |

**Note:** Phase 1 scaffolds the Redis pub/sub plumbing. Full multi-client WebSocket fan-out (F13) lands in Phase 2.

---

## Phase 2a Panels — Frontend Contracts

### Panel Keys

| Type | Registry key | Phase |
|---|---|---|
| `stock_chart` | `stock_chart` | Phase 2a |
| `fundamentals` | `fundamentals` | Phase 2a |

### Panel Props / Persistence Shape

Both new panel types follow the existing `PanelConfig` shape (`{id, type, activeTicker?, title?, [key:string]:unknown}`).

```typescript
// Stock Chart panel — fields that round-trip through workspaces.layout.panels[]
{ id: string, type: "stock_chart", activeTicker?: string, title?: string }

// Fundamentals panel
{ id: string, type: "fundamentals", activeTicker?: string, title?: string }
```

`activeTicker` is the per-panel active symbol. If absent, the panel falls back to the Zustand `useTickerStore.activeTicker`, then to default "NVDA".

### Hooks Used

- **`useCandles(symbol, resolution)`** — same hook as ComparisonChartPanel; see "Frontend Hook — `useCandles`" section below.
- **`useQuote(symbol)`** — file: `apps/web/lib/queries/useQuote.ts`. 15s polling via `refetchInterval: 15_000`. QueryKey: `["quote", symbol]`. Returns `QuoteData | undefined`.

### Fundamentals Section → Endpoint Mapping

| Section | Component | Endpoint | QueryKey prefix | staleTime |
|---|---|---|---|---|
| Valuation & Metrics | `FundamentalsMetrics` | `GET /api/stock/metric` | `fundamentals.metric` | 24h |
| Earnings | `FundamentalsEarnings` | `GET /api/stock/earnings` | `fundamentals.earnings` | 24h |
| Financials | `FundamentalsFinancials` | `GET /api/stock/financials` | `fundamentals.financials` | 24h |
| SEC Filings | `FundamentalsFilings` | `GET /api/stock/filings` | `fundamentals.filings` | 6h |
| Analyst Recs | `FundamentalsRecommendations` | `GET /api/stock/recommendation` | `fundamentals.recommendation` | 24h |

Shared fetch helpers live in `apps/web/lib/queries/fundamentals.ts`. QueryKey builder exported as `fundamentalsKeys`.

### Zustand Integration Points

- `StockChartPanel` and `FundamentalsPanel` both subscribe to `useTickerStore((s) => s.activeTicker)`.
- When `activeTicker` changes (e.g. from WatchlistPanel clicking a ticker), both panels re-render with the new symbol.
- Neither panel writes to `activeTicker` — they are consumers only.

### Chart Renderer Decision (Phase 2a)

`StockChartPanel` contains its own inline `StockLightweightChart` memo'd renderer with volume (HistogramSeries) support. `ComparisonChartPanel`'s `LightweightChart` does not include volume; extraction was deferred to Phase 2b (PRD §9 risk note). TODO: consolidate in Phase 2b.

---

## Frontend Hook — `useCandles`

**File:** `apps/web/lib/queries/useCandles.ts`

**Purpose:** Fetches OHLCV candle data from `/api/candles` for a single ticker with bucketed queryKey (no per-second churn), no-refetch policy, capped retry, and `X-Candles-Status` header surfacing.

**Signature:**
```ts
function useCandles(symbol: string, resolution: string): UseCandlesResult
// UseCandlesResult includes: data, isLoading, isFetching, isError, error, rateLimited, refetch
```

**queryKey shape:** `["candles", symbol, resolution, bucketedFrom, bucketedTo]`
- `bucketedTo` for D/W/M: UTC-midnight of the current day (`Math.floor(Date.now() / 86_400_000) * 86_400`). Advances by one day at a time.
- `bucketedTo` for intraday: 5-minute window (`Math.floor(Date.now() / 1000 / 300) * 300`).
- `bucketedFrom`: wide fixed window (370 days for D, 5 years for W, 10 years for M, 30 days for intraday).
- Bucket boundaries are memoised on `[resolution]` inside the hook — no external `from`/`to` args.

**Fetch function:** `fetchCandlesWithMeta(symbol, resolution, from, to)` in `apps/web/lib/queries/market.ts`
- Uses `fetch()` directly (not `apiClient.get`) to read response headers.
- Returns `{ data: CandleData, rateLimited: boolean }`.
- `rateLimited = res.headers.get("X-Candles-Status") === "rate_limited"`.

**Retry semantics:**
- Never retries rate-limited responses (`error.rateLimited === true` → retry returns false)
- 1 retry on any other error (`failureCount < 1`)
- Retry delay: `Math.min(1000 * 2^attempt, 8000) + Math.random() * 500` (capped at 8s + jitter)
- `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchOnMount: false`
- staleTime: 24h for D resolution, 5 min otherwise; gcTime: 24h

**rateLimited state:** When `X-Candles-Status: rate_limited` is set on a 200 response, `useCandles` returns `rateLimited: true`. `ComparisonChartPanel` shows a non-interactive banner: "Chart data temporarily unavailable (rate-limited). Try again in a few minutes."

**Error state:** After retry exhaustion, `isError: true`. Callers render "Chart data unavailable" with a Retry button.

**Shared config object** (`candleQueryConfig`): exported from `useCandles.ts`; spread into `useQueries` calls in `ComparisonChartPanel` for consistent retry/refetch behavior. Does not include `staleTime` (set per-query at call site based on `resolution`).

**Single-flight invariant:** All hooks with the same `(symbol, resolution)` in the same QueryClient share one in-flight request. Bucketed keys are stable within the bucket window — no per-second key drift.

---

## Zustand Store Shape (`useTickerStore`)

```typescript
interface TickerStore {
  activeTicker: string | null;
  activeTimeRange: TimeRange;
  setActiveTicker: (ticker: string) => void;
  setActiveTimeRange: (range: TimeRange) => void;
}
```

This is a client-side store (Phase 1 frontend scaffold). It is not persisted to the backend; workspace layout stores the initial panel state.

---

## Error Response Shape

All API errors follow this envelope:

```json
{
  "error": "Human-readable message",
  "code": "OPTIONAL_MACHINE_CODE",
  "statusCode": 4xx | 5xx
}
```

Common status codes:
- 400 — validation failure (body contains field-level details from Fastify)
- 401 — unauthenticated
- 403 — forbidden (attempting to access another user's resource)
- 404 — not found
- 429 — rate limit exceeded (includes `Retry-After` header)
- 502 — upstream Finnhub error
- 503 — health check degraded
