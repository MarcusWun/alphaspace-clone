/**
 * useCandles — single-flight TanStack Query hook for /api/candles.
 *
 * Signature: useCandles(symbol, resolution) — no from/to args.
 * Bucket boundaries are computed internally and memoised on [resolution].
 *
 * queryKey shape: ["candles", symbol, resolution, bucketedFrom, bucketedTo]
 * Stable keys prevent the per-second churn that caused the retry-storm bugs.
 *
 * Retry semantics:
 *  - Never retries rate-limited responses (error.rateLimited === true).
 *  - One retry on any other error.
 *  - No refetch on focus, reconnect, or mount — avoids redundant upstream hits.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { bucketedFrom, bucketedTo, fetchCandlesWithMeta } from "./market";
import type { CandleData } from "@alpha/types";

/** Shared query config — spread into useQueries callers (ComparisonChartPanel). */
export const candleQueryConfig = {
  gcTime: 24 * 60 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
  retry: (failureCount: number, error: unknown): boolean => {
    if ((error as { rateLimited?: boolean })?.rateLimited) return false;
    return failureCount < 1;
  },
  retryDelay: (attemptIndex: number): number =>
    Math.min(1000 * 2 ** attemptIndex, 8000) + Math.random() * 500,
};

export interface UseCandlesResult {
  data: CandleData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** True when the backend is in Yahoo rate-limit cool-off (X-Candles-Status: rate_limited). */
  rateLimited: boolean;
  refetch: () => void;
}

export function useCandles(symbol: string, resolution: string): UseCandlesResult {
  const fromBucket = useMemo(() => bucketedFrom(resolution), [resolution]);
  const toBucket   = useMemo(() => bucketedTo(resolution),   [resolution]);

  const query = useQuery({
    queryKey: ["candles", symbol, resolution, fromBucket, toBucket],
    queryFn: () => fetchCandlesWithMeta(symbol, resolution, fromBucket, toBucket),
    enabled: !!symbol,
    staleTime: resolution === "D" ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000,
    ...candleQueryConfig,
  });

  return {
    data: query.data?.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    rateLimited: query.data?.rateLimited ?? false,
    refetch: query.refetch,
  };
}
