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

## Frontend Hook — `useCandles`

**File:** `apps/web/lib/queries/useCandles.ts`

**Purpose:** Fetches OHLCV candle data from `/api/candles` for a single ticker with stable queryKey, capped exponential backoff, and visible error state on exhaustion.

**Signature:**
```ts
function useCandles(symbol: string, resolution: string, from: number, to: number): UseCandlesResult
```

**queryKey shape:** `["candles", symbol, resolution, fromBucket, toBucket]` — bucketed timestamps (UTC-midnight-aligned for D/W/M, 5-min aligned for intraday); TanStack Query deduplicates in-flight requests with identical keys automatically. Bucket boundary prevents the from/to-seconds instability that broke dedup in the original design.

**Retry semantics:**
- Up to 3 retries on 5xx / network errors
- Never retries on 4xx (unknown symbol, auth failure, etc.) — `error instanceof ApiError && statusCode 400–499` → no retry
- Retry delays: `Math.min(1000 * 2^attempt, 10000) + Math.random() * 500` (capped at 10s + jitter)

**Error state:** After 3 retries exhausted, `isError: true`. Callers render "Chart data unavailable" with a Retry button that calls `refetch()`.

**Shared config object** (`candleQueryConfig`): spread into `useQueries` calls in `ComparisonChartPanel` for consistent behavior across single and multi-ticker charts.

**Stability invariant:** The `from`/`to` params passed to `useCandles` (and to `useQueries` via `ComparisonChartPanel`) MUST be memoised (via `useMemo`) on the enclosing component. If `from`/`to` are computed from `Date.now()` on every render, the queryKey changes every second, breaking dedup and retry exhaustion. See `CANDLES-FE-RETRY-STORM` in BUG_LEDGER.md.

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
