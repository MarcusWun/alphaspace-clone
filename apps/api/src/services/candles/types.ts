/**
 * Shared types for the candles provider abstraction.
 * See prd/alphaspace-clone-candles-yahoo-and-chart-toggle-prd.md §5.1
 */

export interface CandlesParams {
  symbol: string;
  resolution: string; // "D" | "W" | "M" | "1" | "5" | "15" | "30" | "60"
  from: number; // unix seconds
  to: number; // unix seconds
}

export interface CandlesResponse {
  s: "ok" | "no_data";
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  // Service-internal meta — stripped before HTTP response body (see market.ts)
  rateLimited?: boolean; // provider is in rate-limit cool-off
  stale?: boolean;       // data served from expired/stale cache
}

export interface CandlesProvider {
  name: "yahoo" | "alphaVantage";
  getCandles(params: CandlesParams): Promise<CandlesResponse>;
}
