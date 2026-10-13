import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchTool } from "../../services/ai/tools.js";

vi.mock("../../services/finnhub.js", () => ({
  getQuote: vi.fn(),
  getCompanyNews: vi.fn(),
  getFundamentals: vi.fn(),
}));

vi.mock("../../services/candles.js", () => ({
  getCandles: vi.fn(),
}));

vi.mock("../../services/fundamentals.js", () => ({
  getStockMetric: vi.fn(),
  getStockEarnings: vi.fn(),
  getStockFilings: vi.fn(),
  getStockRecommendation: vi.fn(),
}));

import { getQuote, getCompanyNews } from "../../services/finnhub.js";
import { getCandles } from "../../services/candles.js";
import {
  getStockMetric,
  getStockEarnings,
  getStockFilings,
  getStockRecommendation,
} from "../../services/fundamentals.js";

const mockQuote = vi.mocked(getQuote);
const mockNews = vi.mocked(getCompanyNews);
const mockCandles = vi.mocked(getCandles);
const mockMetric = vi.mocked(getStockMetric);
const mockEarnings = vi.mocked(getStockEarnings);
const mockFilings = vi.mocked(getStockFilings);
const mockRecommendation = vi.mocked(getStockRecommendation);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchTool", () => {
  describe("get_quote", () => {
    it("returns ok:true with result on success", async () => {
      mockQuote.mockResolvedValue({ c: 500 });
      const result = await dispatchTool("get_quote", { symbol: "NVDA" });
      expect(result).toEqual({ ok: true, result: { c: 500 } });
      expect(mockQuote).toHaveBeenCalledWith("NVDA");
    });

    it("returns ok:false on Zod validation failure (missing symbol)", async () => {
      const result = await dispatchTool("get_quote", {});
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("symbol");
    });

    it("returns ok:false when service throws", async () => {
      mockQuote.mockRejectedValue(new Error("upstream error"));
      const result = await dispatchTool("get_quote", { symbol: "NVDA" });
      expect(result).toEqual({ ok: false, error: "upstream error" });
    });
  });

  describe("get_candles", () => {
    it("returns ok:true with result on success", async () => {
      const candles = { s: "ok", t: [1], c: [100] };
      mockCandles.mockResolvedValue(candles as never);
      const result = await dispatchTool("get_candles", {
        symbol: "AAPL",
        resolution: "D",
        from: "1700000000",
        to: "1700086400",
      });
      expect(result).toEqual({ ok: true, result: candles });
    });

    it("returns ok:false on Zod validation failure (missing fields)", async () => {
      const result = await dispatchTool("get_candles", { symbol: "AAPL" });
      expect(result.ok).toBe(false);
    });
  });

  describe("get_company_news", () => {
    it("returns ok:true with result on success", async () => {
      mockNews.mockResolvedValue([{ headline: "news" }]);
      const result = await dispatchTool("get_company_news", {
        symbol: "TSLA",
        from: "2026-01-01",
        to: "2026-01-07",
      });
      expect(result).toEqual({ ok: true, result: [{ headline: "news" }] });
    });

    it("returns ok:false on Zod validation failure", async () => {
      const result = await dispatchTool("get_company_news", { symbol: "TSLA" });
      expect(result.ok).toBe(false);
    });
  });

  describe("get_fundamentals_metric", () => {
    it("returns ok:true with data (not the source wrapper)", async () => {
      mockMetric.mockResolvedValue({ data: { pe: 30 }, source: "cache" });
      const result = await dispatchTool("get_fundamentals_metric", { symbol: "NVDA" });
      expect(result).toEqual({ ok: true, result: { pe: 30 } });
    });

    it("returns ok:false on Zod validation failure", async () => {
      const result = await dispatchTool("get_fundamentals_metric", {});
      expect(result.ok).toBe(false);
    });

    it("returns ok:false when service throws", async () => {
      mockMetric.mockRejectedValue(new Error("finnhub down"));
      const result = await dispatchTool("get_fundamentals_metric", { symbol: "NVDA" });
      expect(result).toEqual({ ok: false, error: "finnhub down" });
    });
  });

  describe("get_fundamentals_earnings", () => {
    it("returns ok:true with data", async () => {
      mockEarnings.mockResolvedValue({ data: [{ eps: 4.5 }], source: "upstream" });
      const result = await dispatchTool("get_fundamentals_earnings", { symbol: "NVDA" });
      expect(result).toEqual({ ok: true, result: [{ eps: 4.5 }] });
    });
  });

  describe("get_fundamentals_filings", () => {
    it("returns ok:true with data and default limit", async () => {
      mockFilings.mockResolvedValue({ data: [], source: "cache" });
      const result = await dispatchTool("get_fundamentals_filings", { symbol: "NVDA" });
      expect(result.ok).toBe(true);
      expect(mockFilings).toHaveBeenCalledWith("NVDA", undefined);
    });

    it("passes limit when provided", async () => {
      mockFilings.mockResolvedValue({ data: [], source: "cache" });
      await dispatchTool("get_fundamentals_filings", { symbol: "NVDA", limit: 5 });
      expect(mockFilings).toHaveBeenCalledWith("NVDA", 5);
    });
  });

  describe("get_fundamentals_recommendation", () => {
    it("returns ok:true with data", async () => {
      mockRecommendation.mockResolvedValue({ data: { buy: 20 }, source: "cache" });
      const result = await dispatchTool("get_fundamentals_recommendation", { symbol: "NVDA" });
      expect(result).toEqual({ ok: true, result: { buy: 20 } });
    });
  });

  describe("unknown tool", () => {
    it("returns ok:false for unknown tool name", async () => {
      const result = await dispatchTool("get_unknown_thing", { symbol: "X" });
      expect(result).toEqual({ ok: false, error: "Unknown tool: get_unknown_thing" });
    });
  });
});
