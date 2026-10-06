import { describe, it, expect, vi } from "vitest";
import {
  getQuote,
  getCompanyNews,
  getFundamentals,
} from "../services/finnhub.js";
import { mockRedis } from "./setup.js";

const REAL_FINNHUB_KEY = process.env["FINNHUB_API_KEY"]!;

// Note: Candle tests moved to alphaVantage.test.ts (Finnhub /stock/candle
// is paid-tier only; Alpha Vantage is now the candle provider).
// See prd/alphaspace-clone-candles-alpha-vantage-prd.md.

describe("Finnhub REST proxy", () => {
  describe("FINNHUB_API_KEY security", () => {
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
});
