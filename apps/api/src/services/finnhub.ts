/**
 * Finnhub REST proxy service
 *
 * - All requests are proxied server-side; FINNHUB_API_KEY never reaches the client.
 * - Redis cache: candles TTL 300s, fundamentals TTL 3600s, quotes TTL 30s, news TTL 120s
 * - p-queue rate limiter: ≤ 60 req/min upstream
 * - The API key must NOT appear in any response payload (enforced by tests).
 */

import PQueue from "p-queue";
import { getRedis } from "./redis.js";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

// Hard-fail if key is missing at startup
function getFinnhubKey(): string {
  const key = process.env["FINNHUB_API_KEY"];
  if (!key) throw new Error("FINNHUB_API_KEY environment variable is not set");
  return key;
}

// Rate limiter: ≤ 60 req/min = 1 per second average
const queue = new PQueue({ intervalCap: 60, interval: 60_000 });

async function finnhubFetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = getFinnhubKey();
  const url = new URL(`${FINNHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("token", key);

  const response = await queue.add(async () => {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "alpha-investment-workspace/1.0" },
    });
    if (!res.ok) {
      throw new Error(`Finnhub error ${res.status}: ${res.statusText}`);
    }
    return res.json() as Promise<unknown>;
  });

  return response;
}

async function cachedFetch<T>(
  cacheKey: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const redis = getRedis();

  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as T;
  }

  const data = await fetcher();

  // Scrub the API key from the response (defense in depth)
  const safe = scrubKey(data);
  await redis.set(cacheKey, JSON.stringify(safe), "EX", ttlSeconds);
  return safe as T;
}

/**
 * Removes the Finnhub API key from any stringified response payload.
 * This is an extra safety net; the key should never be in the response body.
 */
function scrubKey<T>(data: T): T {
  const key = process.env["FINNHUB_API_KEY"];
  if (!key) return data;
  const serialized = JSON.stringify(data);
  if (!serialized.includes(key)) return data;
  // Replace key occurrences in the serialized form
  const scrubbed = serialized.replaceAll(key, "[REDACTED]");
  return JSON.parse(scrubbed) as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────
//
// Note: `getCandles` was removed on 2026-10-05 (see
// prd/alphaspace-clone-candles-alpha-vantage-prd.md) because Finnhub moved
// /stock/candle to a paid tier. Candle data is now served by
// `services/alphaVantage.ts` via `services/candles.ts`. Quote/news/fundamentals
// remain on Finnhub — they still work on the free tier.

export async function getQuote(symbol: string): Promise<unknown> {
  const cacheKey = `finnhub:quote:${symbol}`;
  return cachedFetch(cacheKey, 30, () =>
    finnhubFetch("/quote", { symbol })
  );
}

export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<unknown> {
  const cacheKey = `finnhub:news:${symbol}:${from}:${to}`;
  return cachedFetch(cacheKey, 120, () =>
    finnhubFetch("/company-news", { symbol, from, to })
  );
}

export async function getFundamentals(symbol: string): Promise<unknown> {
  const cacheKey = `finnhub:fundamentals:${symbol}`;
  return cachedFetch(cacheKey, 3600, () =>
    finnhubFetch("/stock/metric", { symbol, metric: "all" })
  );
}

/**
 * Cheap reachability check for the health endpoint.
 * Fetches a small exchange symbol list, cached 60s to avoid burning the free tier.
 */
export async function checkFinnhubReachability(): Promise<boolean> {
  try {
    const redis = getRedis();
    const cached = await redis.get("finnhub:healthcheck");
    if (cached === "ok") return true;

    const url = new URL(`${FINNHUB_BASE}/stock/symbol`);
    url.searchParams.set("exchange", "US");
    url.searchParams.set("token", getFinnhubKey());

    const res = await fetch(url.toString(), { method: "HEAD" });
    const ok = res.status < 500;

    if (ok) await redis.set("finnhub:healthcheck", "ok", "EX", 60);
    return ok;
  } catch {
    return false;
  }
}
