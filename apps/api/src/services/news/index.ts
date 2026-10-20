/**
 * News provider barrel.
 *
 * Selects the active provider via NEWS_PROVIDER env var (default "yahoo").
 * Owns the Redis cache layer: 15-min TTL per (symbol, from, to, provider).
 *
 * Cache key scheme: news:<provider>:<symbol>:<from>:<to>
 *
 * Emits structured log lines compatible with the candles observability pattern:
 *   news.cache_hit   { provider, symbol, from, to }
 *   news.cache_miss  { provider, symbol, from, to }
 *   news.upstream_call { provider, symbol, from, to, ms, count }
 *
 * Startup log: [news] provider=<name>
 */

import type { NewsItem } from "@alpha/types";
import { yahooProvider } from "./yahoo.js";
import { finnhubProvider } from "./finnhub.js";
import { getRedis } from "../redis.js";

const NEWS_CACHE_TTL = 900; // 15 minutes

const providerName = (process.env["NEWS_PROVIDER"] ?? "yahoo").toLowerCase();
export const newsProvider = providerName === "finnhub" ? finnhubProvider : yahooProvider;

// Startup log so A9 ops can verify post-restart
console.log(`[news] provider=${newsProvider.name}`);

export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<NewsItem[]> {
  const redis = getRedis();
  const cacheKey = `news:${newsProvider.name}:${symbol}:${from}:${to}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log(
      JSON.stringify({ event: "news.cache_hit", provider: newsProvider.name, symbol, from, to })
    );
    return JSON.parse(cached) as NewsItem[];
  }

  console.log(
    JSON.stringify({ event: "news.cache_miss", provider: newsProvider.name, symbol, from, to })
  );

  const t0 = Date.now();
  const items = await newsProvider.getCompanyNews(symbol, from, to);
  const ms = Date.now() - t0;

  console.log(
    JSON.stringify({
      event: "news.upstream_call",
      provider: newsProvider.name,
      symbol,
      from,
      to,
      ms,
      count: items.length,
    })
  );

  await redis.set(cacheKey, JSON.stringify(items), "EX", NEWS_CACHE_TTL);

  return items;
}
