/**
 * Candle service re-export shim.
 *
 * Keeping this file as a stable import surface means route files don't need
 * changes when the underlying provider changes. The real implementation now
 * lives in services/candles/ (provider directory).
 *
 * See prd/alphaspace-clone-candles-yahoo-and-chart-toggle-prd.md §5.1
 */

export * from "./candles/index.js";
