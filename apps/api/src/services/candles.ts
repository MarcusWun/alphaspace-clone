/**
 * Candle service re-export.
 *
 * Routes import `getCandles` and friends from this module. Keeping the import
 * surface stable means a future provider swap (Alpha Vantage → Yahoo/Polygon)
 * is a one-file change here. See prd/alphaspace-clone-candles-alpha-vantage-prd.md §4.1.
 */

export {
  getCandles,
  sliceCandles,
  UnknownSymbolError,
  QuotaExceededError,
  UnexpectedResponseError,
} from "./alphaVantage.js";
export type { CandlesParams, FinnhubShapedCandles } from "./alphaVantage.js";
