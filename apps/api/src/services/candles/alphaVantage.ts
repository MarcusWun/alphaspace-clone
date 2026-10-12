/**
 * Alpha Vantage candle provider (fallback when CANDLES_PROVIDER=alphaVantage).
 *
 * Moved from services/alphaVantage.ts and updated per PRD §2 decision:
 *  - Removed outputsize=full (was a premium feature → returned Information payload
 *    → set ratelimited sentinel → permanent broken state). Bug: CANDLES-AV-OUTPUTSIZE-FULL.
 *  - PQueue tightened to 1 req/sec (was 5/min burst which still exceeded AV free tier).
 *  - Cache key now includes from/to so distinct windows don't collide.
 *  - Startup hard-fail if CANDLES_PROVIDER=alphaVantage and key is missing.
 *
 * Sentinel invariant: the ratelimited sentinel is ALWAYS checked before the request
 * is enqueued. If the sentinel is set, we throw immediately without touching the queue.
 *
 * See prd/alphaspace-clone-candles-yahoo-and-chart-toggle-prd.md §5.1
 */

import PQueue from "p-queue";
import { getRedis } from "../redis.js";
import type { CandlesParams, CandlesResponse, CandlesProvider } from "./types.js";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

// Hard-fail at startup if the key is missing
function getAlphaVantageKey(): string {
  const key = process.env["ALPHA_VANTAGE_API_KEY"];
  if (!key) throw new Error("ALPHA_VANTAGE_API_KEY environment variable is not set");
  return key;
}

// Free-tier: 1 req/sec. Overridable via ALPHA_VANTAGE_BURST_PER_MINUTE for tests.
// Tests set ALPHA_VANTAGE_BURST_PER_MINUTE=10000 → intervalMs≈6ms (effectively unlimited).
const BURST_PER_MINUTE = Number(process.env["ALPHA_VANTAGE_BURST_PER_MINUTE"] ?? "60");
const intervalMs = Math.max(1, Math.round(60_000 / BURST_PER_MINUTE));
const queue = new PQueue({ intervalCap: 1, interval: intervalMs });

// ─── Typed service errors ─────────────────────────────────────────────────────

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

// ─── Resolution map ───────────────────────────────────────────────────────────

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

// ─── Response transform ───────────────────────────────────────────────────────

interface AlphaVantageBar {
  "1. open"?: string;
  "2. high"?: string;
  "3. low"?: string;
  "4. close"?: string;
  "5. volume"?: string;
}

/**
 * Transform Alpha Vantage payload → Finnhub-shaped candles.
 * - Picks the first `*Time Series*` key defensively.
 * - Sorts ascending (AV returns descending).
 * - Drops rows with NaN values.
 * - Missing time-series key → {s:"no_data"}.
 */
export function transformCandles(payload: unknown): CandlesResponse {
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

function emptyNoData(): CandlesResponse {
  return { s: "no_data", t: [], o: [], h: [], l: [], c: [], v: [] };
}

// ─── Error payload detection ──────────────────────────────────────────────────

type ErrorClassification =
  | { kind: "ok" }
  | { kind: "unknown_symbol"; error: UnknownSymbolError }
  | { kind: "quota"; error: QuotaExceededError }
  | { kind: "unexpected"; error: UnexpectedResponseError };

export function classifyPayload(payload: unknown, symbol: string): ErrorClassification {
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

// ─── Cache helpers ────────────────────────────────────────────────────────────

const RATE_LIMIT_KEY = "alphavantage:ratelimited";

/**
 * Bucketed cache key — mirrors yahoo.ts bucketedKey approach for consistency.
 * Day-bucket for D/W/M, 5-min bucket for intraday. No from/to in key.
 * The route-level slicer narrows the cached full compact response to [from, to].
 */
function cacheKeyFor(symbol: string, resolution: string): string {
  const now = Date.now();
  const bucket = isIntradayResolution(resolution)
    ? Math.floor(now / 300_000)    // 5-min bucket
    : Math.floor(now / 86_400_000); // day bucket
  return `alphavantage:candles:${symbol}:${resolution}:${bucket}`;
}

function ttlFor(resolution: string): number {
  return isIntradayResolution(resolution) ? 300 : 86_400;
}

// ─── Low-level fetch ──────────────────────────────────────────────────────────

async function alphaVantageFetch(query: AlphaVantageQuery, symbol: string): Promise<unknown> {
  const key = getAlphaVantageKey();
  const url = new URL(ALPHA_VANTAGE_BASE);
  url.searchParams.set("function", query.function);
  url.searchParams.set("symbol", symbol);
  if (query.interval) url.searchParams.set("interval", query.interval);
  // NOTE: outputsize=full intentionally omitted — it is a premium feature.
  // Without it, AV returns compact (last 100 bars), which the free tier allows.
  // Bug CANDLES-AV-OUTPUTSIZE-FULL: the previous outputsize=full caused AV to
  // return an Information payload → service treated it as quota exhaustion.
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

// ─── Slice helper ─────────────────────────────────────────────────────────────

/**
 * Slice a Finnhub-shaped full-history payload to the [from, to] window.
 * Returns {s:"no_data"} if the slice is empty.
 */
export function sliceCandles(full: CandlesResponse, from: number, to: number): CandlesResponse {
  if (full.s !== "ok" || !full.t) return full;

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
    o: pick(full.o ?? []),
    h: pick(full.h ?? []),
    l: pick(full.l ?? []),
    c: pick(full.c ?? []),
    v: pick(full.v ?? []),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch candles from Alpha Vantage (compact = last 100 bars) and cache the
 * full compact response. Route-level slicer narrows to the requested [from, to].
 *
 * Sentinel invariant: the ratelimited sentinel is checked FIRST, before the
 * request is enqueued — if cool-off is active we never touch the queue.
 *
 * Throws:
 *   - UnknownSymbolError  → route maps to 200 {s:"no_data"}
 *   - QuotaExceededError  → route maps to 429
 *   - UnexpectedResponseError → route maps to 502
 */
async function getCandles(params: CandlesParams): Promise<CandlesResponse> {
  const { symbol, resolution } = params;
  const redis = getRedis();

  // 1. CHECK SENTINEL FIRST — never enqueue if cool-off is active
  const cooling = await redis.get(RATE_LIMIT_KEY);
  if (cooling) {
    console.log(JSON.stringify({ event: "candles.rate_limited", provider: "alphaVantage", ttl: 60 }));
    throw new QuotaExceededError("cooling-off window active");
  }

  // 2. Cache hit
  const cacheKey = cacheKeyFor(symbol, resolution);
  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log(JSON.stringify({ event: "candles.cache_hit", key: cacheKey, symbol, resolution }));
    return JSON.parse(cached) as CandlesResponse;
  }
  console.log(JSON.stringify({ event: "candles.cache_miss", key: cacheKey, symbol, resolution }));

  // 3. Cache miss → upstream fetch (enqueued AFTER sentinel check)
  console.log(JSON.stringify({ event: "candles.upstream_call", provider: "alphaVantage", symbol, resolution }));
  const query = mapResolution(resolution);
  const raw = await alphaVantageFetch(query, symbol);
  const safe = scrubKey(raw);

  const classification = classifyPayload(safe, symbol);

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
      // Cache the full compact response; route-level slicer narrows to [from, to]
      const full = transformCandles(safe);
      await redis.set(cacheKey, JSON.stringify(full), "EX", ttlFor(resolution));
      return full;
    }
  }
}

export const alphaVantageProvider: CandlesProvider = {
  name: "alphaVantage",
  getCandles,
};
