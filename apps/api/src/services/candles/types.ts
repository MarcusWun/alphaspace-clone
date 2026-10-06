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
}

export interface CandlesProvider {
  name: "yahoo" | "alphaVantage";
  getCandles(params: CandlesParams): Promise<CandlesResponse>;
}
