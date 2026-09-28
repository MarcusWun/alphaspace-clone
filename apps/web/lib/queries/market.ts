import { apiClient } from "@/lib/api-client";
import type { CandleData, NewsItem, TimeRange } from "@alpha/types";

export interface CandleResponse {
  data: CandleData;
}

export interface NewsResponse {
  data: NewsItem[];
}

// Candle query keys include all params so TanStack Query caches per-ticker-per-range
export const candleKeys = {
  ticker: (symbol: string, resolution: string, from: number, to: number) =>
    ["candles", symbol, resolution, from, to] as const,
};

export const newsKeys = {
  ticker: (symbol: string, from: string, to: string) =>
    ["news", symbol, from, to] as const,
};

export async function fetchCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<CandleData> {
  const params = new URLSearchParams({
    symbol,
    resolution,
    from: String(from),
    to: String(to),
  });
  const res = await apiClient.get<CandleResponse>(`/api/candles?${params}`);
  return res.data;
}

export async function fetchCompanyNews(
  symbol: string,
  from: string,
  to: string
): Promise<NewsItem[]> {
  const params = new URLSearchParams({ symbol, from, to });
  const res = await apiClient.get<NewsResponse>(`/api/company-news?${params}`);
  return res.data;
}

/**
 * Convert a TimeRange value to unix timestamp boundaries (seconds).
 */
export function timeRangeToUnix(range: TimeRange): { from: number; to: number } {
  const now = Date.now();
  const toTs = Math.floor(now / 1000);
  const msDay = 86_400_000;

  switch (range) {
    case "1W":
      return { from: Math.floor((now - 7 * msDay) / 1000), to: toTs };
    case "1M":
      return { from: Math.floor((now - 30 * msDay) / 1000), to: toTs };
    case "3M":
      return { from: Math.floor((now - 90 * msDay) / 1000), to: toTs };
    case "YTD": {
      const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
      return { from: Math.floor(jan1 / 1000), to: toTs };
    }
    case "1Y":
      return { from: Math.floor((now - 365 * msDay) / 1000), to: toTs };
    case "5Y":
      return { from: Math.floor((now - 5 * 365 * msDay) / 1000), to: toTs };
    default:
      return { from: Math.floor((now - 365 * msDay) / 1000), to: toTs };
  }
}

/**
 * Convert a TimeRange to resolution string for Finnhub candle endpoint.
 */
export function timeRangeToResolution(range: TimeRange): string {
  switch (range) {
    case "1W":
      return "60";
    case "1M":
      return "D";
    case "3M":
    case "YTD":
    case "1Y":
      return "D";
    case "5Y":
      return "W";
    default:
      return "D";
  }
}
