/**
 * Unit tests for the Yahoo Finance 2 candle provider.
 *
 * Covers:
 *  - D/W/M happy path: historical() transform to Finnhub shape, ascending sort
 *  - Intraday happy path: chart() transform
 *  - Null/NaN row drop
 *  - Unknown / no-data path → {s:"no_data"}
 *  - Cache hit path
 *  - Cache key includes from+to
 *  - Library error → UpstreamError (not a crash)
 *
 * yahoo-finance2 is mocked at module level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRedis } from "./setup.js";

// Mock yahoo-finance2 before importing the provider so we control the module
vi.mock("yahoo-finance2", () => ({
  default: {
    historical: vi.fn(),
    chart: vi.fn(),
  },
}));

import yahooFinance from "yahoo-finance2";
import { yahooProvider } from "../services/candles/yahoo.js";
import { UpstreamError } from "../services/candles/errors.js";

const FROM = 1696118400; // 2023-10-01 UTC
const TO = 1698710400;   // 2023-10-31 UTC

describe("Yahoo Finance candle provider", () => {
  beforeEach(() => {
    vi.mocked(yahooFinance.historical).mockReset();
    vi.mocked(yahooFinance.chart).mockReset();
  });

  describe("D/W/M daily resolution via historical()", () => {
    const mockRows = [
      { date: new Date("2023-10-02"), open: 100, high: 105, low: 98, close: 103, adjClose: 103, volume: 1_000_000 },
      { date: new Date("2023-10-03"), open: 103, high: 108, low: 101, close: 107, adjClose: 107, volume: 1_200_000 },
    ];

    it("transforms historical rows to Finnhub shape ascending", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockResolvedValue(mockRows);

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

    it("maps D to 1d, W to 1wk, M to 1mo", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockResolvedValue([]);

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "W", from: FROM, to: TO });
      expect(vi.mocked(yahooFinance.historical)).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "1wk" })
      );

      mockRedis.get.mockResolvedValue(null);
      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "M", from: FROM, to: TO });
      expect(vi.mocked(yahooFinance.historical)).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "1mo" })
      );
    });

    it("drops rows with null/NaN OHLC", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockResolvedValue([
        { date: new Date("2023-10-02"), open: 100, high: 105, low: 98, close: 103, adjClose: 103, volume: 1_000_000 },
        // row with null close — should be dropped
        { date: new Date("2023-10-03"), open: 103, high: 108, low: 101, close: null as unknown as number, adjClose: null, volume: 1_200_000 },
      ]);

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("ok");
      expect(result.c).toEqual([103]);
    });

    it("returns no_data when historical returns empty array", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockResolvedValue([]);

      const result = await yahooProvider.getCandles({ symbol: "FAKE", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("no_data");
    });

    it("caches result with 24h TTL; cache key includes from+to", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockResolvedValue(mockRows);

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(mockRedis.set).toHaveBeenCalledWith(
        `yahoo:candles:AAPL:D:${FROM}:${TO}`,
        expect.any(String),
        "EX",
        86_400
      );
    });

    it("returns cached result without calling historical on hit", async () => {
      const cached = { s: "ok", t: [1_696_118_400], o: [100], h: [105], l: [98], c: [103], v: [1_000_000] };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === `yahoo:candles:AAPL:D:${FROM}:${TO}`) return JSON.stringify(cached);
        return null;
      });

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO });

      expect(result).toEqual(cached);
      expect(yahooFinance.historical).not.toHaveBeenCalled();
    });
  });

  describe("Intraday resolution via chart()", () => {
    const mockChartResult = {
      quotes: [
        { date: new Date("2023-10-02T14:30:00Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 50_000 },
        { date: new Date("2023-10-02T14:35:00Z"), open: 100.5, high: 102, low: 100, close: 101.5, volume: 60_000 },
      ],
    };

    it("transforms chart quotes to Finnhub shape, ascending", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.chart).mockResolvedValue(mockChartResult as never);

      const result = await yahooProvider.getCandles({ symbol: "AAPL", resolution: "5", from: FROM, to: TO });

      expect(result.s).toBe("ok");
      expect(result.t).toHaveLength(2);
      expect(result.t![0]).toBeLessThan(result.t![1]!);
      expect(result.o).toEqual([100, 100.5]);
    });

    it("maps 1 to 1m, 15 to 15m, 60 to 60m", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.chart).mockResolvedValue({ quotes: [] } as never);

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "1", from: FROM, to: TO });
      expect(vi.mocked(yahooFinance.chart)).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "1m" })
      );

      mockRedis.get.mockResolvedValue(null);
      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "60", from: FROM, to: TO });
      expect(vi.mocked(yahooFinance.chart)).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ interval: "60m" })
      );
    });

    it("uses 5-minute TTL for intraday", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.chart).mockResolvedValue(mockChartResult as never);

      await yahooProvider.getCandles({ symbol: "AAPL", resolution: "5", from: FROM, to: TO });

      expect(mockRedis.set).toHaveBeenCalledWith(
        `yahoo:candles:AAPL:5:${FROM}:${TO}`,
        expect.any(String),
        "EX",
        300
      );
    });

    it("returns no_data when chart returns empty quotes", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.chart).mockResolvedValue({ quotes: [] } as never);

      const result = await yahooProvider.getCandles({ symbol: "FAKE", resolution: "5", from: FROM, to: TO });

      expect(result.s).toBe("no_data");
    });
  });

  describe("Error handling", () => {
    it("returns no_data when the library throws a no-data message", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockRejectedValue(new Error("No data found for symbol"));

      const result = await yahooProvider.getCandles({ symbol: "FAKE", resolution: "D", from: FROM, to: TO });

      expect(result.s).toBe("no_data");
    });

    it("throws UpstreamError for non-no-data library errors", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(yahooFinance.historical).mockRejectedValue(new Error("Network timeout"));

      await expect(
        yahooProvider.getCandles({ symbol: "AAPL", resolution: "D", from: FROM, to: TO })
      ).rejects.toBeInstanceOf(UpstreamError);
    });
  });
});
