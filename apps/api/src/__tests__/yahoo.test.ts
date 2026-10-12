/**
 * Unit tests for the Yahoo Finance candle provider (yahoo-finance2 v3).
 *
 * Covers:
 *  - bucketedKey: same UTC day → same key; different day → different key (vi.setSystemTime)
 *  - bucketedKey: intraday 5-min bucketing
 *  - isRateLimitError: true for each rate-limit signal shape; false for unrelated errors
 *  - Sentinel-based cool-off: no upstream call; returns stale if present, else no_data
 *  - Stale cache fallback: 429 detection → sentinel set → stale key served
 *  - D/W/M happy path: chart() → Finnhub shape, ascending sort
 *  - Intraday happy path: chart() → Finnhub shape
 *  - Null/NaN row drop
 *  - Unknown / no-data path → {s:"no_data"}
 *  - Cache hit path (no upstream call)
 *  - Library error → UpstreamError (not a crash)
 *  - v3 chart() unification: daily uses chart(); historical never imported
 *
 * yahoo-finance2 is mocked at module level using vi.hoisted so the class
 * constructor returns a controllable mock instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRedis } from "./setup.js";

// vi.hoisted ensures mockChart is available inside the vi.mock factory (which is hoisted)
const mockChart = vi.hoisted(() => vi.fn());

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ chart: mockChart })),
}));

import { yahooProvider, bucketedKey, isRateLimitError } from "../services/candles/yahoo.js";
import { UpstreamError } from "../services/candles/errors.js";

const FROM = 1696118400; // 2023-10-01 UTC
const TO = 1698710400;   // 2023-10-31 UTC

// Helper: chart() response shape (ChartResultArray with quotes)
function chartResult(rows: Array<{ date: Date; open: number; high: number; low: number; close: number; volume: number }>) {
  return { quotes: rows };
}

const DAILY_CHART_ROWS = [
  { date: new Date("2023-10-02"), open: 100, high: 105, low: 98, close: 103, volume: 1_000_000 },
  { date: new Date("2023-10-03"), open: 103, high: 108, low: 101, close: 107, volume: 1_200_000 },
];

describe("Yahoo Finance candle provider (v3)", () => {
  beforeEach(() => {
    mockChart.mockReset();
  });

  // ─── bucketedKey bucketing ────────────────────────────────────────────────────

  describe("bucketedKey — day bucket (D/W/M)", () => {
    it("two calls within the same UTC day return the same key", () => {
      const base = new Date("2023-10-11T00:00:00Z").getTime();
      vi.setSystemTime(base);
      const k1 = bucketedKey("NVDA", "D");
      vi.setSystemTime(base + 43_200_000); // +12h, same day
      const k2 = bucketedKey("NVDA", "D");
      expect(k1).toBe(k2);
      vi.useRealTimers();
    });

    it("calls on different UTC days return different keys", () => {
      vi.setSystemTime(new Date("2023-10-11T23:00:00Z").getTime());
      const k1 = bucketedKey("NVDA", "D");
      vi.setSystemTime(new Date("2023-10-12T01:00:00Z").getTime());
      const k2 = bucketedKey("NVDA", "D");
      expect(k1).not.toBe(k2);
      vi.useRealTimers();
    });

    it("key format is yahoo:candles:<symbol>:<resolution>:<bucket>", () => {
      const now = 1696982400000; // some fixed ms timestamp
      vi.setSystemTime(now);
      const key = bucketedKey("AAPL", "D");
      const bucket = Math.floor(now / 86_400_000);
      expect(key).toBe(`yahoo:candles:AAPL:D:${bucket}`);
      vi.useRealTimers();
    });
  });

  describe("bucketedKey — 5-min bucket (intraday)", () => {
    it("two calls within the same 5-min window share a key", () => {
      const base = new Date("2023-10-11T14:30:00Z").getTime();
      vi.setSystemTime(base);
      const k1 = bucketedKey("AAPL", "5");
      vi.setSystemTime(base + 60_000); // +1 min, same 5-min window
      const k2 = bucketedKey("AAPL", "5");
      expect(k1).toBe(k2);
      vi.useRealTimers();
    });

    it("adjacent 5-min windows return different keys", () => {
      vi.setSystemTime(new Date("2023-10-11T14:34:59Z").getTime());
      const k1 = bucketedKey("AAPL", "5");
      vi.setSystemTime(new Date("2023-10-11T14:35:01Z").getTime());
      const k2 = bucketedKey("AAPL", "5");
      expect(k1).not.toBe(k2);
      vi.useRealTimers();
    });
  });

  // ─── isRateLimitError ─────────────────────────────────────────────────────────

  describe("isRateLimitError", () => {
    it("returns true for 'Too Many Requests'", () => {
      expect(isRateLimitError(new Error("Too Many Requests"))).toBe(true);
    });

    it("returns true for SyntaxError with 'Unexpected token T' (Yahoo HTML body parse error)", () => {
      expect(
        isRateLimitError(
          new SyntaxError("Unexpected token 'T', \"Too Many Requests\\n\" is not valid JSON")
        )
      ).toBe(true);
    });

    it("returns true for 'status code 429'", () => {
      expect(isRateLimitError(new Error("status code 429"))).toBe(true);
    });

    it("returns true for SyntaxError containing 'not valid JSON'", () => {
      expect(isRateLimitError(new SyntaxError("some body is not valid JSON"))).toBe(true);
    });

    it("returns false for 'No data found'", () => {
      expect(isRateLimitError(new Error("No data found"))).toBe(false);
    });

    it("returns false for unrelated error", () => {
      expect(isRateLimitError(new Error("random other error"))).toBe(false);
    });

    it("returns false for non-SyntaxError 'not valid JSON' message", () => {
      // Only SyntaxError with 'not valid JSON' is rate-limit signal
      expect(isRateLimitError(new Error("body is not valid JSON"))).toBe(false);
    });
  });

  // ─── Sentinel-based cool-off ──────────────────────────────────────────────────

  describe("Sentinel cool-off", () => {
    it("does NOT call chart() when sentinel is set; returns no_data with rateLimited:true", async () => {
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "yahoo:ratelimited") return "1";
        return null; // stale key also empty
      });

      const result = await yahooProvider.getCandles({ symbol: "NVDA", resolution: "D", from: FROM, to: TO });

      expect(mockChart).not.toHaveBeenCalled();
      expect(result.s).toBe("no_data");
      expect(result.rateLimited).toBe(true);
      expect(result.stale).toBeUndefined();
    });

    it("serves stale cache with rateLimited:true, stale:true when sentinel set and stale key exists", async () => {
      const staleData = { s: "ok" as const, t: [FROM], o: [100], h: [105], l: [98], c: [103], v: [1_000_000] };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "yahoo:ratelimited") return "1";
        if (key.endsWith(":stale")) return JSON.stringify(staleData);
        return null;
      });

      const result = await yahooProvider.getCandles({ symbol: "NVDA", resolution: "D", from: FROM, to: TO });

      expect(mockChart).not.toHaveBeenCalled();
      expect(result.s).toBe("ok");
      expect(result.rateLimited).toBe(true);
      expect(result.stale).toBe(true);
      expect(result.t).toEqual(staleData.t);
    });
  });

  // ─── Stale cache fallback on 429 ──────────────────────────────────────────────

  describe("Stale cache fallback on 429 detection", () => {
    it("on 429 detection: sets sentinel, serves stale cache with rateLimited+stale flags", async () => {
      const staleData = { s: "ok" as const, t: [FROM], o: [99], h: [104], l: [97], c: [102], v: [900_000] };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "yahoo:ratelimited") return null; // no sentinel yet
        if (key.endsWith(":stale")) return JSON.stringify(staleData);
        return null; // primary cache miss
      });
      mockChart.mockRejectedValue(
        new SyntaxError("Unexpected token 'T', \"Too Many Requests\\n\" is not valid JSON")
      );

      const result = await yahooProvider.getCandles({ symbol: "NVDA", resolution: "D", from: FROM, to: TO });

      // Sentinel set with 15-min TTL
      expect(mockRedis.set).toHaveBeenCalledWith("yahoo:ratelimited", "1", "EX", 900);
      expect(result.s).toBe("ok");
      expect(result.rateLimited).toBe(true);
      expect(result.stale).toBe(true);
    });

    it("on 429 detection with no stale cache: returns no_data with rateLimited:true", async () => {
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "yahoo:ratelimited") return null;
        return null; // all misses
      });
      mockChart.mockRejectedValue(new Error("Too Many Requests"));

      const result = await yahooProvider.getCandles({ symbol: "NVDA", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("no_data");
      expect(result.rateLimited).toBe(true);
    });
  });

  // ─── D/W/M daily resolution via chart() ──────────────────────────────────────

  describe("D/W/M daily resolution via chart()", () => {
    it("transforms chart rows to Finnhub shape ascending", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue(chartResult(DAILY_CHART_ROWS));

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("ok");
      expect(result.t).toHaveLength(2);
      expect(result.t![0]).toBeLessThan(result.t![1]!);
      expect(result.o).toEqual([100, 103]);
      expect(result.h).toEqual([105, 108]);
      expect(result.l).toEqual([98, 101]);
      expect(result.c).toEqual([103, 107]);
      expect(result.v).toEqual([1_000_000, 1_200_000]);
    });

    it("calls chart() with 1d interval for D resolution", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue({ quotes: [] });

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(mockChart).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "1d" })
      );
    });

    it("calls chart() with 1wk interval for W resolution", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue({ quotes: [] });

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "W", from: FROM, to: TO });

      expect(mockChart).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "1wk" })
      );
    });

    it("drops rows with null/NaN OHLC", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue(chartResult([
        { date: new Date("2023-10-02"), open: 100, high: 105, low: 98, close: 103, volume: 1_000_000 },
        { date: new Date("2023-10-03"), open: 103, high: 108, low: 101, close: null as unknown as number, volume: 1_200_000 },
      ]));

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("ok");
      expect(result.c).toEqual([103]);
    });

    it("returns no_data when chart returns empty quotes", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue({ quotes: [] });

      const result = await yahooProvider.getCandles({ symbol: "FAKE", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("no_data");
    });

    it("caches result under bucketed key with 24h TTL and also writes stale key with 72h TTL", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue(chartResult(DAILY_CHART_ROWS));

      const now = Date.now();
      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      const bucket = Math.floor(now / 86_400_000);
      const primaryKey = `yahoo:candles:AAPL:D:${bucket}`;
      const staleKey = `yahoo:candles:AAPL:D:${bucket}:stale`;

      expect(mockRedis.set).toHaveBeenCalledWith(primaryKey, expect.any(String), "EX", 86_400);
      expect(mockRedis.set).toHaveBeenCalledWith(staleKey, expect.any(String), "EX", 72 * 3600);
    });

    it("returns cached result without calling chart() on bucketed cache hit", async () => {
      const now = Date.now();
      const bucket = Math.floor(now / 86_400_000);
      const key = `yahoo:candles:AAPL:D:${bucket}`;
      const cached = { s: "ok", t: [FROM], o: [100], h: [105], l: [98], c: [103], v: [1_000_000] };
      mockRedis.get.mockImplementation(async (k: string) => {
        if (k === key) return JSON.stringify(cached);
        return null;
      });

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(result).toEqual(cached);
      expect(mockChart).not.toHaveBeenCalled();
    });
  });

  // ─── Intraday resolution via chart() ─────────────────────────────────────────

  describe("Intraday resolution via chart()", () => {
    const INTRADAY_CHART_RESULT = {
      quotes: [
        { date: new Date("2023-10-02T14:30:00Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 50_000 },
        { date: new Date("2023-10-02T14:35:00Z"), open: 100.5, high: 102, low: 100, close: 101.5, volume: 60_000 },
      ],
    };

    it("transforms chart quotes to Finnhub shape, ascending", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue(INTRADAY_CHART_RESULT);

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "5", from: FROM, to: TO });

      expect(result.s).toBe("ok");
      expect(result.t).toHaveLength(2);
      expect(result.t![0]).toBeLessThan(result.t![1]!);
      expect(result.o).toEqual([100, 100.5]);
    });

    it("calls chart() with 1m interval for resolution 1", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue({ quotes: [] });

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "1", from: FROM, to: TO });

      expect(mockChart).toHaveBeenCalledWith("AAPL", expect.objectContaining({ interval: "1m" }));
    });

    it("calls chart() with 60m interval for resolution 60", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue({ quotes: [] });

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "60", from: FROM, to: TO });

      expect(mockChart).toHaveBeenCalledWith("AAPL", expect.objectContaining({ interval: "60m" }));
    });

    it("uses 5-min bucketed key with 5-min TTL for intraday", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue(INTRADAY_CHART_RESULT);

      const now = Date.now();
      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "5", from: FROM, to: TO });

      const bucket = Math.floor(now / 300_000);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `yahoo:candles:AAPL:5:${bucket}`,
        expect.any(String),
        "EX",
        300
      );
    });
  });

  // ─── v3 chart() unification ───────────────────────────────────────────────────

  describe("v3 chart() unification", () => {
    it("daily resolution uses chart() and produces correct {t,o,h,l,c,v} output", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockResolvedValue(chartResult(DAILY_CHART_ROWS));

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(mockChart).toHaveBeenCalledTimes(1);
      expect(result.s).toBe("ok");
      expect(result.t).toHaveLength(2);
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────────

  describe("Error handling", () => {
    it("returns no_data when chart throws a no-data message", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockRejectedValue(new Error("No data found for symbol"));

      const result = await yahooProvider.getCandles({ symbol: "FAKE", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("no_data");
    });

    it("throws UpstreamError for non-rate-limit, non-no-data library errors", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChart.mockRejectedValue(new Error("Network timeout"));

      await expect(
        yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO })
      ).rejects.toBeInstanceOf(UpstreamError);
    });
  });
});
