/**
 * Alpha Vantage candle proxy service
 *
 * Why: Finnhub moved /stock/candle to a paid tier (upstream change in 2024).
 * The free tier still serves quote/news/fundamentals, so those stay on Finnhub.
 * Alpha Vantage replaces /stock/candle for historical OHLC data only.
 *
 * - ALPHA_VANTAGE_API_KEY is server-side only; never surfaced in responses.
 * - PQueue: 5 req/min to stay under Alpha Vantage's free-tier burst cap.
 * - Redis cache: 24h for D/W/M (daily/weekly/monthly), 5min for intraday.
 *   outputsize=full returns 20+ years, so one call per (symbol, resolution)
 *   per day serves every from/to window the user requests that day.
 * - Alpha Vantage returns 200 with Note/Information payloads for quota and
 *   premium-gate messages. The service converts those into typed errors; the
 *   route handler maps them to HTTP 200/429/502 per PRD §4.4.
 *
 * See prd/alphaspace-clone-candles-alpha-vantage-prd.md
 */

import PQueue from "p-queue";
import { getRedis } from "./redis.js";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

// Hard-fail at startup if the key is missing (same pattern as getFinnhubKey)
function getAlphaVantageKey(): string {
  const key = process.env["ALPHA_VANTAGE_API_KEY"];
  if (!key) throw new Error("ALPHA_VANTAGE_API_KEY environment variable is not set");
  return key;
}

// Free-tier burst is 5/min; daily cap is 25/day (managed via Redis cache).
// Overridable via env for tests so parallel/sequential test cases don't
// serialize through the 60s window; default stays 5/min in prod.
const BURST_PER_MINUTE = Number(process.env["ALPHA_VANTAGE_BURST_PER_MINUTE"] ?? "5");
const queue = new PQueue({ intervalCap: BURST_PER_MINUTE, interval: 60_000 });

// ─── Typed service errors ────────────────────────────────────────────────────

export class UnknownSymbolError extends Error {
  constructor(symbol: string) {
    super(`Alpha Vantage: unknown symbol "${symbol}"`);
    this.name = "UnknownSymbolError";
  }
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(`Alpha Vantage quota exceeded: ${message}`);
    this.name = "QuotaExceededError";
  }
}

export class UnexpectedResponseError extends Error {
  constructor(message: string) {
    super(`Alpha Vantage unexpected response: ${message}`);
    this.name = "UnexpectedResponseError";
  }
}

// ─── Public types ────────────────────────────────────────────────────────────

export interface CandlesParams {
  symbol: string;
  resolution: string;
  from: string;
  to: string;
}

export interface FinnhubShapedCandles {
  s: "ok" | "no_data";
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

// ─── Resolution map (PRD §4.2) ───────────────────────────────────────────────

interface AlphaVantageQuery {
  function: string;
  interval?: string;
}

export function mapResolution(resolution: string): AlphaVantageQuery {
  switch (resolution) {
    case "D":
      return { function: "TIME_SERIES_DAILY" };
    case "W":
      return { function: "TIME_SERIES_WEEKLY" };
    case "M":
      return { function: "TIME_SERIES_MONTHLY" };
    case "1":
      return { function: "TIME_SERIES_INTRADAY", interval: "1min" };
    case "5":
      return { function: "TIME_SERIES_INTRADAY", interval: "5min" };
    case "15":
      return { function: "TIME_SERIES_INTRADAY", interval: "15min" };
    case "30":
      return { function: "TIME_SERIES_INTRADAY", interval: "30min" };
    case "60":
      return { function: "TIME_SERIES_INTRADAY", interval: "60min" };
    default:
      throw new Error(`Unsupported resolution "${resolution}"`);
  }
}

export function isIntradayResolution(resolution: string): boolean {
  return ["1", "5", "15", "30", "60"].includes(resolution);
}

// ─── Response transform (PRD §4.3) ───────────────────────────────────────────

interface AlphaVantageBar {
  "1. open"?: string;
  "2. high"?: string;
  "3. low"?: string;
  "4. close"?: string;
  "5. volume"?: string;
}

/**
 * Transform Alpha Vantage payload → Finnhub-shaped candles.
 *
 * Rules:
 *  - Picks the first `*Time Series*` key defensively (Alpha Vantage has
 *    renamed keys in the past: "Time Series (Daily)" vs "Time Series Daily").
 *  - Sort ascending by timestamp (Alpha Vantage returns descending).
 *  - Invalid rows (NaN after parse) are dropped.
 *  - Missing `*Time Series*` key → returns `{s:"no_data"}`.
 */
export function transformCandles(payload: unknown): FinnhubShapedCandles {
  if (!payload || typeof payload !== "object") {
    return emptyNoData();
  }
  const obj = payload as Record<string, unknown>;

  const timeSeriesKey = Object.keys(obj).find((k) => k.includes("Time Series"));
  if (!timeSeriesKey) {
    return emptyNoData();
  }

  const series = obj[timeSeriesKey];
  if (!series || typeof series !== "object") {
    return emptyNoData();
  }

  const entries = Object.entries(series as Record<string, AlphaVantageBar>);

  const rows = entries
    .map(([dateStr, bar]) => {
      const ts = Math.floor(Date.parse(dateStr) / 1000);
      const o = Number(bar["1. open"]);
      const h = Number(bar["2. high"]);
      const l = Number(bar["3. low"]);
      const c = Number(bar["4. close"]);
      const v = Number(bar["5. volume"]);
      return { ts, o, h, l, c, v };
    })
    .filter(
      (r) =>
        Number.isFinite(r.ts) &&
        Number.isFinite(r.o) &&
        Number.isFinite(r.h) &&
        Number.isFinite(r.l) &&
        Number.isFinite(r.c) &&
        Number.isFinite(r.v)
    )
    .sort((a, b) => a.ts - b.ts);

  if (rows.length === 0) {
    return emptyNoData();
  }

  return {
    s: "ok",
    t: rows.map((r) => r.ts),
    o: rows.map((r) => r.o),
    h: rows.map((r) => r.h),
    l: rows.map((r) => r.l),
    c: rows.map((r) => r.c),
    v: rows.map((r) => r.v),
  };
}

function emptyNoData(): FinnhubShapedCandles {
  return { s: "no_data", t: [], o: [], h: [], l: [], c: [], v: [] };
}

// ─── Error payload detection (PRD §4.4) ──────────────────────────────────────

/**
 * Classify an Alpha Vantage 200-response payload. Alpha Vantage never returns
 * HTTP errors for quota exhaustion — it returns 200 with hint strings.
 *
 * Detection order:
 *   1. `Error Message` → UnknownSymbolError
 *   2. `Note` / `Information` → QuotaExceededError
 *   3. no `*Time Series*` key → UnexpectedResponseError
 *   4. otherwise → ok
 */
export function classifyPayload(
  payload: unknown,
  symbol: string
):
  | { kind: "ok" }
  | { kind: "unknown_symbol"; error: UnknownSymbolError }
  | { kind: "quota"; error: QuotaExceededError }
  | { kind: "unexpected"; error: UnexpectedResponseError } {
  if (!payload || typeof payload !== "object") {
    return {
      kind: "unexpected",
      error: new UnexpectedResponseError("empty or non-object response"),
    };
  }
  const obj = payload as Record<string, unknown>;

  if (typeof obj["Error Message"] === "string") {
    return { kind: "unknown_symbol", error: new UnknownSymbolError(symbol) };
  }

  if (typeof obj["Note"] === "string") {
    return { kind: "quota", error: new QuotaExceededError(obj["Note"]) };
  }
  if (typeof obj["Information"] === "string") {
    return { kind: "quota", error: new QuotaExceededError(obj["Information"]) };
  }

  const hasTimeSeries = Object.keys(obj).some((k) => k.includes("Time Series"));
  if (!hasTimeSeries) {
    return {
      kind: "unexpected",
      error: new UnexpectedResponseError(
        `response contained none of: Error Message, Note, Information, *Time Series* (keys: ${Object.keys(obj).join(", ")})`
      ),
    };
  }

  return { kind: "ok" };
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

const RATE_LIMIT_KEY = "alphavantage:ratelimited";

function cacheKeyFor(symbol: string, resolution: string): string {
  return `alphavantage:candles:${symbol}:${resolution}`;
}

function ttlFor(resolution: string): number {
  return isIntradayResolution(resolution) ? 300 : 86_400;
}

// ─── Low-level fetch ─────────────────────────────────────────────────────────

async function alphaVantageFetch(
  query: AlphaVantageQuery,
  symbol: string
): Promise<unknown> {
  const key = getAlphaVantageKey();
  const url = new URL(ALPHA_VANTAGE_BASE);
  url.searchParams.set("function", query.function);
  url.searchParams.set("symbol", symbol);
  if (query.interval) url.searchParams.set("interval", query.interval);
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("datatype", "json");
  url.searchParams.set("apikey", key);

  const response = await queue.add(async () => {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "alpha-investment-workspace/1.0" },
    });
    if (!res.ok) {
      throw new Error(`Alpha Vantage HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json() as Promise<unknown>;
  });

  return response;
}

function scrubKey<T>(data: T): T {
  const key = process.env["ALPHA_VANTAGE_API_KEY"];
  if (!key) return data;
  const serialized = JSON.stringify(data);
  if (!serialized.includes(key)) return data;
  const scrubbed = serialized.replaceAll(key, "[REDACTED]");
  return JSON.parse(scrubbed) as T;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch full-history candles for a symbol, cached per (symbol, resolution).
 *
 * Returns the FULL cached payload (always Finnhub-shaped). The route handler
 * is responsible for slicing to the caller's from/to window — this keeps the
 * service free of callsite-specific coupling and preserves the one-upstream-
 * call-per-day cache invariant.
 *
 * Throws:
 *   - UnknownSymbolError  → route maps to 200 {s:"no_data"}
 *   - QuotaExceededError  → route maps to 429
 *   - UnexpectedResponseError → route maps to 502
 */
export async function getCandles(
  params: CandlesParams
): Promise<FinnhubShapedCandles> {
  const redis = getRedis();

  // 1. Short-circuit if we're inside the quota cool-off window
  const cooling = await redis.get(RATE_LIMIT_KEY);
  if (cooling) {
    throw new QuotaExceededError("cooling-off window active");
  }

  // 2. Cache hit → return cached full-history
  const cacheKey = cacheKeyFor(params.symbol, params.resolution);
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FinnhubShapedCandles;
  }

  // 3. Cache miss → upstream call
  const query = mapResolution(params.resolution);
  const raw = await alphaVantageFetch(query, params.symbol);
  const safe = scrubKey(raw);

  const classification = classifyPayload(safe, params.symbol);

  switch (classification.kind) {
    case "quota":
      // Latch the 60s cool-off so we stop burning requests
      await redis.set(RATE_LIMIT_KEY, "1", "EX", 60);
      throw classification.error;
    case "unknown_symbol":
      throw classification.error;
    case "unexpected":
      throw classification.error;
    case "ok": {
      const transformed = transformCandles(safe);
      await redis.set(
        cacheKey,
        JSON.stringify(transformed),
        "EX",
        ttlFor(params.resolution)
      );
      return transformed;
    }
  }
}

/**
 * Slice a Finnhub-shaped full-history payload down to the [from, to]
 * (inclusive) unix-second window. Returns `{s:"no_data"}` if the slice is
 * empty, so the frontend's existing "no data" handling applies.
 */
export function sliceCandles(
  full: FinnhubShapedCandles,
  from: number,
  to: number
): FinnhubShapedCandles {
  if (full.s !== "ok") return full;

  const indices: number[] = [];
  for (let i = 0; i < full.t.length; i++) {
    const ts = full.t[i];
    if (ts !== undefined && ts >= from && ts <= to) indices.push(i);
  }

  if (indices.length === 0) return emptyNoData();

  const pick = (arr: number[]): number[] =>
    indices.map((i) => arr[i]!).filter((v) => v !== undefined);

  return {
    s: "ok",
    t: pick(full.t),
    o: pick(full.o),
    h: pick(full.h),
    l: pick(full.l),
    c: pick(full.c),
    v: pick(full.v),
  };
}
