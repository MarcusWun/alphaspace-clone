/**
 * Yahoo Finance 2 candle provider.
 *
 * Primary chart-data source per PRD §2 (Decision: Yahoo Finance 2 as default).
 *
 * - D/W/M resolutions use `historical()` with 1d/1wk/1mo intervals.
 * - Intraday (1/5/15/30/60 min) uses `chart()` because `historical()` doesn't
 *   support sub-daily intervals.
 * - Soft concurrency limit of 10 upstream fetches (p-queue) guards against
 *   burst storms; Yahoo itself doesn't enforce a documented req/sec cap.
 * - Redis cache: 24h for D/W/M, 5min for intraday (keyed by from+to so
 *   distinct request windows don't collide in the cache).
 * - Unknown symbol → returns {s:"no_data"} without throwing.
 * - Library / upstream errors → throws UpstreamError (route maps to 502).
 *
 * See prd/alphaspace-clone-candles-yahoo-and-chart-toggle-prd.md §5.1
 */

import yahooFinance from "yahoo-finance2";
import PQueue from "p-queue";
import { getRedis } from "../redis.js";
import { UpstreamError } from "./errors.js";
import type { CandlesParams, CandlesResponse, CandlesProvider } from "./types.js";

// Soft concurrency limiter — not rate control, just a safety net against
// runaway parallel requests (e.g. frontend retry storm regression).
const queue = new PQueue({ concurrency: 10 });

// ─── Resolution maps ──────────────────────────────────────────────────────────

type HistoricalInterval = "1d" | "1wk" | "1mo";
type IntradayInterval = "1m" | "5m" | "15m" | "30m" | "60m";

const DAILY_INTERVAL_MAP: Record<string, HistoricalInterval> = {
  D: "1d",
  W: "1wk",
  M: "1mo",
};

const INTRADAY_INTERVAL_MAP: Record<string, IntradayInterval> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "60m",
};

function isIntraday(resolution: string): boolean {
  return resolution in INTRADAY_INTERVAL_MAP;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cacheKey(symbol: string, resolution: string, from: number, to: number): string {
  return `yahoo:candles:${symbol}:${resolution}:${from}:${to}`;
}

function ttlSeconds(resolution: string): number {
  return isIntraday(resolution) ? 300 : 86_400;
}

// ─── Response builders ────────────────────────────────────────────────────────

function noData(): CandlesResponse {
  return { s: "no_data" };
}

function buildOk(rows: Array<{ ts: number; o: number; h: number; l: number; c: number; v: number }>): CandlesResponse {
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

// ─── D/W/M fetch via historical() ────────────────────────────────────────────

async function fetchDaily(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<CandlesResponse> {
  const interval = DAILY_INTERVAL_MAP[resolution];
  if (!interval) throw new UpstreamError("yahoo", `Unsupported resolution: ${resolution}`);

  const result = await queue.add(() =>
    yahooFinance.historical(symbol, {
      period1: new Date(from * 1000),
      period2: new Date(to * 1000),
      interval,
    })
  );

  if (!result || result.length === 0) return noData();

  const rows = result
    .map((row) => ({
      ts: Math.floor(row.date.getTime() / 1000),
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.ts) &&
        Number.isFinite(r.o) &&
        Number.isFinite(r.h) &&
        Number.isFinite(r.l) &&
        Number.isFinite(r.c) &&
        Number.isFinite(r.v) &&
        r.o !== null &&
        r.h !== null &&
        r.l !== null &&
        r.c !== null
    )
    .sort((a, b) => a.ts - b.ts);

  return buildOk(rows);
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
    yahooFinance.chart(symbol, {
      period1: new Date(from * 1000),
      period2: new Date(to * 1000),
      interval,
    })
  );

  const quotes = result?.quotes;
  if (!quotes || quotes.length === 0) return noData();

  const rows = quotes
    .map((q) => ({
      ts: q.date instanceof Date ? Math.floor(q.date.getTime() / 1000) : Math.floor(Number(q.date) / 1000),
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

// ─── Public provider ──────────────────────────────────────────────────────────

async function getCandles(params: CandlesParams): Promise<CandlesResponse> {
  const { symbol, resolution, from, to } = params;
  const redis = getRedis();

  // Cache hit
  const key = cacheKey(symbol, resolution, from, to);
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as CandlesResponse;
  }

  // Upstream fetch
  let response: CandlesResponse;
  try {
    if (isIntraday(resolution)) {
      response = await fetchIntraday(symbol, resolution, from, to);
    } else {
      response = await fetchDaily(symbol, resolution, from, to);
    }
  } catch (err) {
    // unknown-symbol errors from the library return a specific message shape;
    // treat "No data found" or validation-type errors as no_data.
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

  // Cache and return
  await redis.set(key, JSON.stringify(response), "EX", ttlSeconds(resolution));
  return response;
}

export const yahooProvider: CandlesProvider = {
  name: "yahoo",
  getCandles,
};
