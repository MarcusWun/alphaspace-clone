import { apiClient, ApiError } from "@/lib/api-client";
import type { CandleData, NewsItem, TimeRange } from "@alpha/types";

export interface CandleResponse {
  data: CandleData;
}

export interface CandleWithMeta {
  data: CandleData;
  rateLimited: boolean;
}

export interface NewsResponse {
  data: NewsItem[];
}

// Candle query keys include all params so TanStack Query caches per-ticker-per-range
export const candleKeys = {
  ticker: (symbol: string, resolution: string, from: number, to: number) =>
    ["candles", symbol, resolution, from, to] as const,
};

/**
 * Return the upper bucket boundary (seconds).
 * D/W/M: UTC-midnight of the current day. Intraday: 5-minute window boundary.
 * Advancing by one day or one 5-min window keeps queryKeys stable within a session.
 */
export function bucketedTo(resolution: string): number {
  const now = Date.now();
  if (
    resolution === "1" ||
    resolution === "5" ||
    resolution === "15" ||
    resolution === "30" ||
    resolution === "60"
  ) {
    return Math.floor(now / 1000 / 300) * 300;
  }
  return Math.floor(now / 86_400_000) * 86_400;
}

/**
 * Return the lower bucket boundary (seconds).
 * Wide fixed window so server's full-envelope cache is always covered.
 */
export function bucketedFrom(resolution: string): number {
  const to = bucketedTo(resolution);
  if (
    resolution === "1" ||
    resolution === "5" ||
    resolution === "15" ||
    resolution === "30" ||
    resolution === "60"
  ) {
    return to - 30 * 86_400;
  }
  if (resolution === "W") return to - 5 * 365 * 86_400;
  if (resolution === "M") return to - 10 * 365 * 86_400;
  return to - 370 * 86_400;
}

/**
 * Fetch candles and expose the X-Candles-Status response header.
 * Uses fetch() directly (not apiClient) to read response headers.
 */
export async function fetchCandlesWithMeta(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): Promise<CandleWithMeta> {
  const params = new URLSearchParams({
    symbol,
    resolution,
    from: String(from),
    to: String(to),
  });

  const res = await fetch(`/api/candles?${params}`, { credentials: "include" });
  const rateLimited = res.headers.get("X-Candles-Status") === "rate_limited";

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      // ignore JSON parse failure on error responses
    }
    const err = new ApiError(message, res.status, code);
    // Mark 429s and rate-limited responses so retry predicate can skip retry
    if (res.status === 429 || rateLimited)
      (err as ApiError & { rateLimited: boolean }).rateLimited = true;
    throw err;
  }

  const body = (await res.json()) as CandleResponse;
  return { data: body.data, rateLimited };
}

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
    case "1D":
      return { from: Math.floor((now - msDay) / 1000), to: toTs };
    case "1W":
      return { from: Math.floor((now - 7 * msDay) / 1000), to: toTs };
    case "1M":
      return { from: Math.floor((now - 30 * msDay) / 1000), to: toTs };
    case "3M":
      return { from: Math.floor((now - 90 * msDay) / 1000), to: toTs };
    case "6M":
      return { from: Math.floor((now - 180 * msDay) / 1000), to: toTs };
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
    case "1D":
      return "60";
    case "1W":
      return "60";
    case "1M":
      return "D";
    case "3M":
    case "6M":
    case "YTD":
    case "1Y":
      return "D";
    case "5Y":
      return "D";
    default:
      return "D";
  }
}

/**
 * Return day-bucketed {from, to} for a given TimeRange.
 * Padding ensures the first bar returned is at or before the exact anchor.
 * All boundaries are stable within the same day (day-bucket via bucketedTo("D")).
 */
export function bucketedWindowForTimeRange(
  timeRange: TimeRange
): { from: number; to: number } {
  const to = bucketedTo("D");
  switch (timeRange) {
    case "1D":  return { from: to - 2 * 86_400,   to };
    case "1W":  return { from: to - 10 * 86_400,  to };
    case "1M":  return { from: to - 35 * 86_400,  to };
    case "3M":  return { from: to - 100 * 86_400, to };
    case "6M":  return { from: to - 190 * 86_400, to };
    case "YTD": {
      const jan1 = Math.floor(
        new Date(new Date().getFullYear(), 0, 1).getTime() / 1000 / 86_400
      ) * 86_400;
      return { from: jan1, to };
    }
    case "1Y":  return { from: to - 370 * 86_400, to };
    case "5Y":  return { from: to - 5 * 365 * 86_400, to };
    default:    return { from: to - 370 * 86_400, to };
  }
}
