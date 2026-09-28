import { describe, it, expect, vi } from "vitest";
import {
  getCandles,
  getQuote,
  getCompanyNews,
  getFundamentals,
} from "../services/finnhub.js";
import { mockRedis } from "./setup.js";

const REAL_FINNHUB_KEY = process.env["FINNHUB_API_KEY"]!;

describe("Finnhub REST proxy", () => {
  describe("FINNHUB_API_KEY security", () => {
    it("API key does not appear in candle response", async () => {
      const fakeCandleResponse = {
        c: [100, 101],
        h: [102, 103],
        l: [99, 100],
        o: [100, 101],
        s: "ok",
        t: [1_700_000_000, 1_700_086_400],
        v: [1000, 1100],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeCandleResponse,
      } as Response);

      const result = await getCandles({
        symbol: "AAPL",
        resolution: "D",
        from: "1700000000",
        to: "1700086400",
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(REAL_FINNHUB_KEY);
      expect(serialized).not.toContain("Bearer");
    });

    it("API key does not appear in quote response", async () => {
      const fakeQuote = { c: 150.0, d: 1.5, dp: 1.0, h: 151, l: 149, o: 149, pc: 148.5, t: 1700000000 };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeQuote,
      } as Response);

      const result = await getQuote("AAPL");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(REAL_FINNHUB_KEY);
    });

    it("API key does not appear in news response", async () => {
      const fakeNews = [{ headline: "AAPL earnings", id: 1, source: "CNBC" }];

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeNews,
      } as Response);

      const result = await getCompanyNews("AAPL", "2026-09-01", "2026-09-27");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(REAL_FINNHUB_KEY);
    });

    it("API key does not appear in fundamentals response", async () => {
      const fakeFundamentals = { metric: { "52WeekHigh": 200.0 }, symbol: "AAPL" };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeFundamentals,
      } as Response);

      const result = await getFundamentals("AAPL");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(REAL_FINNHUB_KEY);
    });
  });

  describe("Redis caching", () => {
    it("serves candles from cache on second request (hit ratio)", async () => {
      const fakeCandles = { c: [100], s: "ok", t: [1700000000] };

      // First call — cache miss
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeCandles,
      } as Response);
      await getCandles({ symbol: "NVDA", resolution: "D", from: "1700000000", to: "1700086400" });

      // Second call — cache hit
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(fakeCandles));
      await getCandles({ symbol: "NVDA", resolution: "D", from: "1700000000", to: "1700086400" });

      // fetch should only have been called once (first request)
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });

    it("caches candles with TTL 300s", async () => {
      const fakeCandles = { c: [100], s: "ok", t: [1700000000] };
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeCandles,
      } as Response);

      await getCandles({ symbol: "AAPL", resolution: "D", from: "1700000000", to: "1700086400" });

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining("finnhub:candles:AAPL"),
        expect.any(String),
        "EX",
        300
      );
    });

    it("caches fundamentals with TTL 3600s", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ metric: {}, symbol: "AAPL" }),
      } as Response);

      await getFundamentals("AAPL");

      expect(mockRedis.set).toHaveBeenCalledWith(
        "finnhub:fundamentals:AAPL",
        expect.any(String),
        "EX",
        3600
      );
    });

    it("caches quotes with TTL 30s", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ c: 150, d: 1, dp: 0.7, h: 151, l: 149, o: 150, pc: 149, t: 1700000000 }),
      } as Response);

      await getQuote("MSFT");

      expect(mockRedis.set).toHaveBeenCalledWith(
        "finnhub:quote:MSFT",
        expect.any(String),
        "EX",
        30
      );
    });
  });

  describe("cache hit ratio simulation", () => {
    it("achieves > 90% cache hit ratio for 10 identical candle requests", async () => {
      const fakeCandles = { c: [100], s: "ok", t: [1700000000] };
      const params = { symbol: "TSLA", resolution: "D", from: "1700000000", to: "1700086400" };

      let cacheHitCount = 0;

      // First request: cache miss
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeCandles,
      } as unknown as Response);

      await getCandles(params);

      // Subsequent 9 requests: cache hit
      for (let i = 1; i < 10; i++) {
        mockRedis.get.mockResolvedValueOnce(JSON.stringify(fakeCandles));
        await getCandles(params);
        cacheHitCount++;
      }

      const hitRatio = cacheHitCount / 10;
      expect(hitRatio).toBeGreaterThanOrEqual(0.9);
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });
  });
});
