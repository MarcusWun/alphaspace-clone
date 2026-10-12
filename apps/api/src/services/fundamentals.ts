/**
 * Fundamentals service — Phase 2a
 *
 * Five thin cached wrappers over Finnhub free-tier endpoints.
 * Each returns { data, source } so route handlers can emit cache-hit/miss logs.
 * All use the shared finnhubFetch + cachedFetchWithMeta so the PQueue budget
 * is shared across every Finnhub-backed endpoint (60 req/min free tier).
 *
 * Cache keys and TTLs (PRD §3):
 *   finnhub:metric:<sym>          24h
 *   finnhub:earnings:<sym>        24h
 *   finnhub:financials:<sym>      24h
 *   finnhub:filings:<sym>:<n>     6h
 *   finnhub:recommendation:<sym>  24h
 */

import { finnhubFetch, cachedFetchWithMeta } from "./finnhub.js";

export async function getStockMetric(symbol: string) {
  return cachedFetchWithMeta<unknown>(
    `finnhub:metric:${symbol}`,
    86400,
    () => finnhubFetch("/stock/metric", { symbol, metric: "all" })
  );
}

export async function getStockEarnings(symbol: string) {
  return cachedFetchWithMeta<unknown>(
    `finnhub:earnings:${symbol}`,
    86400,
    () => finnhubFetch("/stock/earnings", { symbol })
  );
}

export async function getStockFinancials(symbol: string) {
  return cachedFetchWithMeta<unknown>(
    `finnhub:financials:${symbol}`,
    86400,
    () => finnhubFetch("/stock/financials-reported", { symbol })
  );
}

export async function getStockFilings(symbol: string, limit = 10) {
  return cachedFetchWithMeta<unknown>(
    `finnhub:filings:${symbol}:${limit}`,
    21600,
    () => finnhubFetch("/stock/filings", { symbol, limit: String(limit) })
  );
}

export async function getStockRecommendation(symbol: string) {
  return cachedFetchWithMeta<unknown>(
    `finnhub:recommendation:${symbol}`,
    86400,
    () => finnhubFetch("/stock/recommendation", { symbol })
  );
}
