/**
 * Candle provider selection and route-compatible adapter.
 *
 * Reads CANDLES_PROVIDER env var (default: "yahoo") and exports:
 *  - `candlesProvider` — the selected CandlesProvider instance
 *  - `getCandles`      — route-compatible wrapper (accepts string from/to)
 *  - `sliceCandles`    — passthrough filter for backward route compat
 *  - Error classes re-exported for the route error-mapping contract
 *
 * Startup hard-fail: if CANDLES_PROVIDER=alphaVantage and ALPHA_VANTAGE_API_KEY
 * is missing, an error is thrown during module initialization so the server
 * fails fast rather than silently falling back.
 *
 * See prd/alphaspace-clone-candles-yahoo-and-chart-toggle-prd.md §5.1, §5.2
 */

import { yahooProvider } from "./yahoo.js";
import { alphaVantageProvider, sliceCandles as avSliceCandles } from "./alphaVantage.js";
import {
  UnknownSymbolError,
  QuotaExceededError,
  UnexpectedResponseError,
} from "./alphaVantage.js";
import { UpstreamError } from "./errors.js";
import type { CandlesParams, CandlesResponse, CandlesProvider } from "./types.js";

export type { CandlesParams, CandlesResponse, CandlesProvider };
export { UnknownSymbolError, QuotaExceededError, UnexpectedResponseError, UpstreamError };

// ─── Provider selection ───────────────────────────────────────────────────────

const providerName = (process.env["CANDLES_PROVIDER"] ?? "yahoo").toLowerCase();

// Startup validation: hard-fail if alphaVantage selected but key is missing
if (providerName === "alphavantage" && !process.env["ALPHA_VANTAGE_API_KEY"]) {
  const msg = "[candles] FATAL: CANDLES_PROVIDER=alphaVantage requires ALPHA_VANTAGE_API_KEY to be set";
  console.error(msg);
  throw new Error(msg);
}

export const candlesProvider: CandlesProvider =
  providerName === "alphavantage" ? alphaVantageProvider : yahooProvider;

// Startup log so A9 ops can confirm provider post-restart
console.log(`[candles] provider=${candlesProvider.name}`);

// ─── Route-compatible wrapper ─────────────────────────────────────────────────
//
// The route passes from/to as strings (URL query params). Providers use numbers.
// This wrapper converts and also maps Yahoo's UpstreamError to UnexpectedResponseError
// so the existing route error-mapping (→ 502) works without route changes.

// Legacy type alias so the re-export shim (services/candles.ts) can still
// export `FinnhubShapedCandles` for any callers that imported that type.
export type FinnhubShapedCandles = CandlesResponse;

export async function getCandles(params: {
  symbol: string;
  resolution: string;
  from: string;
  to: string;
}): Promise<CandlesResponse> {
  try {
    return await candlesProvider.getCandles({
      symbol: params.symbol,
      resolution: params.resolution,
      from: Number(params.from),
      to: Number(params.to),
    });
  } catch (err) {
    // Translate Yahoo's UpstreamError → UnexpectedResponseError so the route's
    // existing `err instanceof UnexpectedResponseError → 502` mapping fires.
    if (err instanceof UpstreamError) {
      throw new UnexpectedResponseError(err.message);
    }
    throw err;
  }
}

// Re-export sliceCandles so the route can still call it (it's now a no-op
// passthrough since providers return pre-sliced results, but the route
// contract is unchanged).
export function sliceCandles(full: CandlesResponse, from: number, to: number): CandlesResponse {
  return avSliceCandles(full, from, to);
}
