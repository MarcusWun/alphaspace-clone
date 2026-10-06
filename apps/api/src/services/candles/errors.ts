/**
 * Candle provider error types.
 */

/**
 * Thrown when a provider upstream call fails (non-quota, non-symbol-unknown errors).
 * The route layer maps this to HTTP 502.
 */
export class UpstreamError extends Error {
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(`[candles/${provider}] upstream error: ${message}`);
    this.name = "UpstreamError";
    this.provider = provider;
  }
}
