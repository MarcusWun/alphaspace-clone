/**
 * Route-level tests for market proxy endpoints.
 *
 * Candles now served by Yahoo Finance v3 (chart()-only, no historical).
 * These tests verify the route contract (HTTP shape, auth, param validation,
 * X-Candles-Status header, meta-field stripping) without testing provider
 * internals — see yahoo.test.ts for provider unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../app.js";
import { mockRedis } from "./setup.js";
import jwt from "jsonwebtoken";

const SECRET = process.env["AUTH_SECRET"]!;

function bearerFor(userId: string, email: string) {
  return `Bearer ${jwt.sign({ sub: userId, email }, SECRET, { expiresIn: "1h" })}`;
}

const authHeader = bearerFor("user-1", "test@example.com");

// Mock yahoo-finance2 (v3 class-based API) at the route-test level
const mockChartFn = vi.hoisted(() => vi.fn());

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ chart: mockChartFn })),
}));

// chart() result shape (ChartResultArray)
const MOCK_CHART_RESULT = {
  quotes: [
    { date: new Date("2026-10-02"), open: 148, high: 151, low: 147.5, close: 150, volume: 900_000 },
    { date: new Date("2026-10-03"), open: 150, high: 152, low: 149, close: 151, volume: 1_000_000 },
  ],
};

const FROM_TS = Math.floor(Date.parse("2026-10-01") / 1000);
const TO_TS = Math.floor(Date.parse("2026-10-05") / 1000);

describe("Market proxy routes", () => {
  describe("GET /api/candles", () => {
    it("returns Finnhub-shaped candle data for valid params (Yahoo provider)", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChartFn.mockResolvedValue(MOCK_CHART_RESULT);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=${FROM_TS}&to=${TO_TS}`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { s: string; c: number[]; t: number[] } }>();
      expect(body.data.s).toBe("ok");
      expect(body.data.c.length).toBeGreaterThan(0);
      expect(body.data.t.length).toBe(body.data.c.length);
      await app.close();
    });

    it("returns 200 {s:'no_data'} when Yahoo returns empty data", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChartFn.mockResolvedValue({ quotes: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=BOGUS&resolution=D&from=0&to=9999999999`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { s: string } }>();
      expect(body.data.s).toBe("no_data");
      await app.close();
    });

    it("returns 502 when Yahoo upstream throws a non-no-data error", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockChartFn.mockRejectedValue(new Error("Connection reset"));

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=0&to=9999999999`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(502);
      await app.close();
    });

    it("returns 400 for missing required params", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/candles?symbol=AAPL",
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("returns 401 when unauthenticated", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/candles?symbol=AAPL&resolution=D&from=1700000000&to=1700086400",
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("does not leak ALPHA_VANTAGE_API_KEY in response (key-scrub regression)", async () => {
      const key = process.env["ALPHA_VANTAGE_API_KEY"]!;
      mockRedis.get.mockResolvedValue(null);
      mockChartFn.mockResolvedValue(MOCK_CHART_RESULT);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=0&to=9999999999`,
        headers: { authorization: authHeader },
      });

      expect(res.payload).not.toContain(key);
      await app.close();
    });

    it("returns cached payload and does not call chart() on cache hit", async () => {
      const cachedPayload = { s: "ok", t: [FROM_TS], o: [100], h: [105], l: [98], c: [103], v: [1_000_000] };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.startsWith("yahoo:candles:")) return JSON.stringify(cachedPayload);
        return null;
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=${FROM_TS}&to=${TO_TS}`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(mockChartFn).not.toHaveBeenCalled();
      await app.close();
    });

    it("sets X-Candles-Status: rate_limited header when service returns rateLimited:true", async () => {
      // Sentinel active → service returns rateLimited:true, no_data
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "yahoo:ratelimited") return "1";
        return null; // no stale cache
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=${FROM_TS}&to=${TO_TS}`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-candles-status"]).toBe("rate_limited");
      await app.close();
    });

    it("does not include rateLimited or stale fields in JSON response body", async () => {
      // Stale cache available so rateLimited+stale meta is set on the service response
      const staleData = { s: "ok" as const, t: [FROM_TS], o: [100], h: [105], l: [98], c: [103], v: [1_000_000] };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "yahoo:ratelimited") return "1";
        if (key.endsWith(":stale")) return JSON.stringify(staleData);
        return null;
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=${FROM_TS}&to=${TO_TS}`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Record<string, unknown>>();
      const data = body["data"] as Record<string, unknown>;
      expect(data).not.toHaveProperty("rateLimited");
      expect(data).not.toHaveProperty("stale");
      await app.close();
    });
  });

  describe("GET /api/quote", () => {
    it("returns quote data", async () => {
      const fakeQuote = { c: 150, d: 1, dp: 0.7, h: 151, l: 149, o: 150, pc: 149, t: 1700000000 };
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeQuote,
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/quote?symbol=AAPL",
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("GET /api/company-news", () => {
    it("returns news data", async () => {
      const fakeNews = [{ headline: "AAPL beats estimates", id: 1 }];
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeNews,
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/company-news?symbol=AAPL&from=2026-09-01&to=2026-09-27",
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("GET /api/fundamentals", () => {
    it("returns fundamentals data", async () => {
      const fakeFundamentals = { metric: { "52WeekHigh": 200 }, symbol: "AAPL" };
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeFundamentals,
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/fundamentals?symbol=AAPL",
        headers: { authorization: authHeader },
      });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });
});
