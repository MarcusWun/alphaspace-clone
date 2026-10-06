/**
 * useCandles — stable-key TanStack Query hook for /api/candles with
 * capped exponential backoff and no 4xx retries.
 *
 * queryKey shape: ["candles", symbol, resolution, from, to]
 * Retry semantics: up to 3 attempts on 5xx / network errors; never retries 4xx.
 * Error state: hook returns isError=true after exhaustion; caller renders
 *   "Chart data unavailable" + a Retry button.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchCandles, candleKeys } from "./market";
import { ApiError } from "@/lib/api-client";
import type { CandleData } from "@alpha/types";

/** Shared retry predicate — exported so useQueries callers can reuse it */
export function shouldRetryCandleError(
  failureCount: number,
  error: unknown
): boolean {
  // Never retry 4xx client errors (unknown symbol, auth failure, etc.)
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }
  return failureCount < 3;
}

/** Shared retry delay — exported for useQueries callers */
export function candleRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 10_000) + Math.random() * 500;
}

/** Shared query config object — spread into useQueries query descriptors */
export const candleQueryConfig = {
  staleTime: 300_000,
  retry: shouldRetryCandleError,
  retryDelay: candleRetryDelay,
} as const;

export interface UseCandlesResult {
  data: CandleData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Single-ticker candle hook with stable queryKey and capped retry.
 * Two calls with identical (symbol, resolution, from, to) in the same
 * QueryClient will deduplicate to a single in-flight request.
 */
export function useCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number
): UseCandlesResult {
  const query = useQuery<CandleData, unknown>({
    queryKey: candleKeys.ticker(symbol, resolution, from, to),
    queryFn: () => fetchCandles(symbol, resolution, from, to),
    enabled: !!symbol && from > 0 && to > 0,
    ...candleQueryConfig,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
