import YahooFinance from "yahoo-finance2";
import { createHash } from "node:crypto";
import type { NewsItem } from "@alpha/types";
import type { NewsProvider } from "./types.js";

// v3 instantiation — suppress deprecation notices consistent with candles provider
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// Minimal shape of a Yahoo search news item (yahoo-finance2 internal)
interface YahooNewsItem {
  title?: string;
  link?: string;
  publisher?: string;
  providerPublishTime?: number;
  thumbnail?: {
    resolutions?: Array<{ url?: string }>;
  };
}

/** Deterministic 32-bit hash of (url, publishTime) for synthesizing NewsItem.id */
function hashId(url: string, publishTime: number): number {
  const hash = createHash("sha256")
    .update(`${url}${publishTime}`)
    .digest();
  return hash.readUInt32BE(0);
}

/** Convert YYYY-MM-DD string to unix seconds (UTC midnight) */
function dateToSec(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

async function getCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<NewsItem[]> {
  const fromSec = dateToSec(from);
  // Include full `to` day (add 24 hours - 1 second)
  const toSec = dateToSec(to) + 86399;

  try {
    const result = await (yf.search as (q: string, opts: { newsCount: number }) => Promise<{ news?: YahooNewsItem[] }>)(
      symbol,
      { newsCount: 20 }
    );

    const newsItems = result.news ?? [];
    if (newsItems.length === 0) return [];

    return newsItems
      .filter((item) => {
        const ts = item.providerPublishTime;
        return ts !== undefined && ts >= fromSec && ts <= toSec;
      })
      .map((item): NewsItem => ({
        id: hashId(item.link ?? "", item.providerPublishTime ?? 0),
        headline: item.title ?? "",
        summary: "",
        source: item.publisher ?? "",
        url: item.link ?? "",
        datetime: item.providerPublishTime ?? 0,
        image: item.thumbnail?.resolutions?.[0]?.url ?? "",
        category: "company",
        related: symbol,
      }));
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "news.upstream_error",
        provider: "yahoo",
        symbol,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return [];
  }
}

export const yahooProvider: NewsProvider = {
  name: "yahoo",
  getCompanyNews,
};
