/**
 * Yahoo Finance candle provider (yahoo-finance2 v3).
 *
 * Primary chart-data source per PRD §2.
 *
 * P1 — Bucketed cache keys: keyed by (symbol, resolution, day-bucket) for D/W/M,
 *      5-min bucket for intraday. Eliminates the from/to key-per-second bug that
 *      caused ~1000× the necessary upstream calls.
 * P1 — Full-envelope caching: D/W/M fetches a 10-year wide window; the route-level
 *      slicer narrows to the requested [from, to].
 * P2 — 429 detection: sets a 15-min Redis sentinel on any Yahoo rate-limit signal.
 *      Falls back to stale cache if available, else returns {s:"no_data",rateLimited:true}.
 * P3 — chart()-only: historical() removed; both daily and intraday use chart().
 *      suppressNotices suppresses the v3 yahooSurvey + ripHistorical notices.
 * P5 — Structured observability log lines (grep: candles.*).
 *
 * See prd/alphaspace-clone-candles-rate-limit-hardening-prd.md §5.1–5.5
 */

import YahooFinance from "yahoo-finance2";
import PQueue from "p-queue";
import { getRedis } from "../redis.js";
import { UpstreamError } from "./errors.js";
import type { CandlesParams, CandlesResponse, CandlesProvider } from "./types.js";

// v3 instantiation — suppressNotices replaces the v2 deprecation log at module init
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// Soft concurrency limiter — guards against runaway parallel request storms
const queue = new PQueue({ concurrency: 10 });

// ─── Resolution maps ──────────────────────────────────────────────────────────

type ChartInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";

const DAILY_INTERVAL_MAP: Record<string, ChartInterval> = {
  D: "1d",
  W: "1wk",
  M: "1mo",
};

const INTRADAY_INTERVAL_MAP: Record<string, ChartInterval> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "60m",
};

function isIntraday(resolution: string): boolean {
  return resolution in INTRADAY_INTERVAL_MAP;
}

// ─── Rate-limit sentinel ──────────────────────────────────────────────────────

const RATE_LIMIT_SENTINEL = "yahoo:ratelimited";
const RATE_LIMIT_TTL = 900; // 15 min

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Too Many Requests") ||
    msg.includes("Unexpected token 'T'") ||
    msg.includes("status code 429") ||
    (err instanceof SyntaxError && msg.includes("not valid JSON"))
  );
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

export function bucketedKey(symbol: string, resolution: string): string {
  const now = Date.now();
  const bucket = isIntraday(resolution)
    ? Math.floor(now / 300_000)    // 5-min buckets for intraday
    : Math.floor(now / 86_400_000); // day buckets for D/W/M
  return `yahoo:candles:${symbol}:${resolution}:${bucket}`;
}

function staleCacheKey(symbol: string, resolution: string): string {
  return `${bucketedKey(symbol, resolution)}:stale`;
}

function ttlSeconds(resolution: string): number {
  return isIntraday(resolution) ? 300 : 86_400;
}

// ─── Response builders ────────────────────────────────────────────────────────

function noData(meta?: Partial<Pick<CandlesResponse, "rateLimited" | "stale">>): CandlesResponse {
  return { s: "no_data", ...meta };
}

function buildOk(
  rows: Array<{ ts: number; o: number; h: number; l: number; c: number; v: number }>
): CandlesResponse {
  if (rows.length === 0) return noData();
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

// ─── Unified chart() response mapper ─────────────────────────────────────────
// Single path from chart() response → {t,o,h,l,c,v} rows for both daily + intraday.

interface ChartRow {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

function mapChartResult(result: { quotes: ChartRow[] } | null | undefined): CandlesResponse {
  const quotes = result?.quotes;
  if (!quotes || quotes.length === 0) return noData();

  const rows = quotes
    .map((q) => ({
      ts: Math.floor(q.date.getTime() / 1000),
      o: q.open ?? NaN,
      h: q.high ?? NaN,
      l: q.low ?? NaN,
      c: q.close ?? NaN,
      v: q.volume ?? NaN,
    }))
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

  return buildOk(rows);
}

// ─── D/W/M fetch via chart() — full 10-year envelope ─────────────────────────

async function fetchDaily(symbol: string, resolution: string): Promise<CandlesResponse> {
  const interval = DAILY_INTERVAL_MAP[resolution];
  if (!interval) throw new UpstreamError("yahoo", `Unsupported resolution: ${resolution}`);

  const now = new Date();
  const tenYearsAgo = new Date(now.getTime() - 10 * 365.25 * 24 * 60 * 60 * 1000);

  const result = await queue.add(() =>
    yf.chart(symbol, {
      period1: tenYearsAgo,
      period2: now,
      interval,
      return: "array",
    })
  );

  return mapChartResult(result as { quotes: ChartRow[] } | null);
}

// ─── Intraday fetch via chart() ───────────────────────────────────────────────

async function fetchIntraday(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<CandlesResponse> {
  const interval = INTRADAY_INTERVAL_MAP[resolution];
  if (!interval) throw new UpstreamError("yahoo", `Unsupported intraday resolution: ${resolution}`);

  const result = await queue.add(() =>
    yf.chart(symbol, {
      period1: new Date(from * 1000),
      period2: new Date(to * 1000),
      interval,
      return: "array",
    })
  );

  return mapChartResult(result as { quotes: ChartRow[] } | null);
}

// ─── Public provider ──────────────────────────────────────────────────────────

async function getCandles(params: CandlesParams): Promise<CandlesResponse> {
  const { symbol, resolution, from, to } = params;
  const redis = getRedis();
  const key = bucketedKey(symbol, resolution);
  const staleKey = staleCacheKey(symbol, resolution);

  // 1. Check rate-limit sentinel before touching upstream
  const sentinel = await redis.get(RATE_LIMIT_SENTINEL);
  if (sentinel) {
    console.log(JSON.stringify({ event: "candles.rate_limited", provider: "yahoo", ttl: RATE_LIMIT_TTL }));
    const staleRaw = await redis.get(staleKey);
    if (staleRaw) {
      console.log(JSON.stringify({ event: "candles.stale_served", key: staleKey, symbol, resolution }));
      return { ...(JSON.parse(staleRaw) as CandlesResponse), rateLimited: true, stale: true };
    }
    return noData({ rateLimited: true });
  }

  // 2. Primary cache hit
  const cached = await redis.get(key);
  if (cached) {
    console.log(JSON.stringify({ event: "candles.cache_hit", key, symbol, resolution }));
    return JSON.parse(cached) as CandlesResponse;
  }
  console.log(JSON.stringify({ event: "candles.cache_miss", key, symbol, resolution }));

  // 3. Upstream fetch
  console.log(JSON.stringify({ event: "candles.upstream_call", provider: "yahoo", symbol, resolution }));
  let response: CandlesResponse;
  try {
    if (isIntraday(resolution)) {
      response = await fetchIntraday(symbol, resolution, from, to);
    } else {
      response = await fetchDaily(symbol, resolution);
    }
  } catch (err) {
    if (isRateLimitError(err)) {
      // Set sentinel and fall back to stale cache
      await redis.set(RATE_LIMIT_SENTINEL, "1", "EX", RATE_LIMIT_TTL);
      console.log(JSON.stringify({ event: "candles.rate_limited", provider: "yahoo", ttl: RATE_LIMIT_TTL }));
      const staleRaw = await redis.get(staleKey);
      if (staleRaw) {
        console.log(JSON.stringify({ event: "candles.stale_served", key: staleKey, symbol, resolution }));
        return { ...(JSON.parse(staleRaw) as CandlesResponse), rateLimited: true, stale: true };
      }
      return noData({ rateLimited: true });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("No data found") ||
      message.includes("no data") ||
      message.includes("Unknown Symbol") ||
      message.includes("unknown symbol")
    ) {
      return noData();
    }
    throw new UpstreamError("yahoo", message);
  }

  // 4. Cache: primary key (normal TTL) + stale key (72h for rate-limit fallback)
  const ttl = ttlSeconds(resolution);
  await redis.set(key, JSON.stringify(response), "EX", ttl);
  await redis.set(staleKey, JSON.stringify(response), "EX", 72 * 3600);

  return response;
}

export const yahooProvider: CandlesProvider = {
  name: "yahoo",
  getCandles,
};
