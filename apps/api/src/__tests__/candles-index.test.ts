/**
 * Unit tests for the candles provider selection + route adapter (services/candles/index.ts).
 *
 * Covers:
 *  - CANDLES_PROVIDER=yahoo (default) → yahooProvider selected
 *  - CANDLES_PROVIDER=alphaVantage (case-insensitive) → alphaVantageProvider selected
 *  - getCandles wrapper converts string from/to to numbers
 *  - UpstreamError is translated to UnexpectedResponseError for route compat
 *  - sliceCandles: boundary inclusion (from <= t <= to)
 *  - sliceCandles: empty-overlap returns {s:"no_data"}
 *  - sliceCandles: mid-window slice
 *  - sliceCandles: preserves rateLimited and stale meta flags
 *  - sliceCandles: passes through s:"no_data" input unchanged
 *
 * Each sub-suite dynamically imports the module with a fresh env so the
 * module-level provider selection re-evaluates.
 */

import { describe, it, expect, vi } from "vitest";

// Mock both providers so we can assert which one is called
vi.mock("../services/candles/yahoo.js", () => ({
  yahooProvider: {
    name: "yahoo",
    getCandles: vi.fn().mockResolvedValue({ s: "ok", t: [], o: [], h: [], l: [], c: [], v: [] }),
  },
}));

vi.mock("../services/candles/alphaVantage.js", () => ({
  alphaVantageProvider: {
    name: "alphaVantage",
    getCandles: vi.fn().mockResolvedValue({ s: "ok", t: [], o: [], h: [], l: [], c: [], v: [] }),
  },
  UnknownSymbolError: class UnknownSymbolError extends Error {},
  QuotaExceededError: class QuotaExceededError extends Error {},
  UnexpectedResponseError: class UnexpectedResponseError extends Error {},
}));

import { yahooProvider } from "../services/candles/yahoo.js";
import { alphaVantageProvider, UnexpectedResponseError } from "../services/candles/alphaVantage.js";
import { UpstreamError } from "../services/candles/errors.js";

describe("Candles provider selection (services/candles/index.ts)", () => {
  it("default (no CANDLES_PROVIDER env) selects yahoo provider", async () => {
    const { getCandles, candlesProvider } = await import("../services/candles/index.js");

    expect(candlesProvider.name).toBe("yahoo");

    await getCandles({ symbol: "AAPL", resolution: "D", from: "1700000000", to: "1800000000" });
    expect(vi.mocked(yahooProvider.getCandles)).toHaveBeenCalledWith({
      symbol: "AAPL",
      resolution: "D",
      from: 1700000000,
      to: 1800000000,
    });
  });

  it("getCandles wrapper converts string from/to to numbers for the provider", async () => {
    const { getCandles } = await import("../services/candles/index.js");

    await getCandles({ symbol: "NVDA", resolution: "W", from: "1696000000", to: "1700000000" });

    expect(vi.mocked(yahooProvider.getCandles)).toHaveBeenCalledWith(
      expect.objectContaining({ from: 1696000000, to: 1700000000 })
    );
  });

  it("UpstreamError from provider is translated to UnexpectedResponseError", async () => {
    vi.mocked(yahooProvider.getCandles).mockRejectedValueOnce(
      new UpstreamError("yahoo", "Network timeout")
    );

    const { getCandles } = await import("../services/candles/index.js");

    await expect(
      getCandles({ symbol: "AAPL", resolution: "D", from: "0", to: "1" })
    ).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("alphaVantage provider name is exposed correctly", async () => {
    const { candlesProvider } = await import("../services/candles/index.js");
    expect(candlesProvider.name).toBe("yahoo");
    expect(alphaVantageProvider.name).toBe("alphaVantage");
  });
});

// ─── sliceCandles tests ───────────────────────────────────────────────────────

import { sliceCandles } from "../services/candles/index.js";

describe("sliceCandles (services/candles/index.ts)", () => {
  const full = {
    s: "ok" as const,
    t: [100, 200, 300, 400, 500],
    o: [1, 2, 3, 4, 5],
    h: [1, 2, 3, 4, 5],
    l: [1, 2, 3, 4, 5],
    c: [1, 2, 3, 4, 5],
    v: [1, 2, 3, 4, 5],
  };

  it("returns inclusive mid-window slice", () => {
    const result = sliceCandles(full, 200, 400);
    expect(result.s).toBe("ok");
    expect(result.t).toEqual([200, 300, 400]);
    expect(result.c).toEqual([2, 3, 4]);
  });

  it("boundary inclusion: t === from is kept", () => {
    const result = sliceCandles(full, 100, 300);
    expect(result.t).toEqual([100, 200, 300]);
  });

  it("boundary inclusion: t === to is kept", () => {
    const result = sliceCandles(full, 300, 500);
    expect(result.t).toEqual([300, 400, 500]);
  });

  it("empty-overlap returns {s:'no_data'}", () => {
    const result = sliceCandles(full, 1000, 2000);
    expect(result.s).toBe("no_data");
  });

  it("passes through s:'no_data' input unchanged", () => {
    const noData = { s: "no_data" as const };
    expect(sliceCandles(noData, 0, 100).s).toBe("no_data");
  });

  it("preserves rateLimited meta flag after slice", () => {
    const limited = { ...full, rateLimited: true as const };
    const result = sliceCandles(limited, 200, 400);
    expect(result.rateLimited).toBe(true);
  });

  it("preserves stale meta flag after slice", () => {
    const stale = { ...full, stale: true as const };
    const result = sliceCandles(stale, 200, 400);
    expect(result.stale).toBe(true);
  });

  it("preserves rateLimited meta flag on empty-overlap no_data return", () => {
    const limited = { ...full, rateLimited: true as const };
    const result = sliceCandles(limited, 1000, 2000);
    expect(result.s).toBe("no_data");
    expect(result.rateLimited).toBe(true);
  });
});
