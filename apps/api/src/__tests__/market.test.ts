import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../app.js";
import { mockRedis } from "./setup.js";
import jwt from "jsonwebtoken";

const SECRET = process.env["AUTH_SECRET"]!;

function bearerFor(userId: string, email: string) {
  return `Bearer ${jwt.sign({ sub: userId, email }, SECRET, { expiresIn: "1h" })}`;
}

const authHeader = bearerFor("user-1", "test@example.com");

describe("Market proxy routes", () => {
  describe("GET /api/candles", () => {
    it("returns candle data for valid params", async () => {
      const fakeCandles = { c: [100, 101], s: "ok", t: [1700000000, 1700086400] };
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeCandles,
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/candles?symbol=AAPL&resolution=D&from=1700000000&to=1700086400",
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown }>();
      expect(body.data).toBeDefined();
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

    it("does not leak FINNHUB_API_KEY in response", async () => {
      const key = process.env["FINNHUB_API_KEY"]!;
      const fakeCandles = { c: [100], s: "ok", t: [1700000000] };
      mockRedis.get.mockResolvedValueOnce(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => fakeCandles,
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/candles?symbol=AAPL&resolution=D&from=1700000000&to=1700086400",
        headers: { authorization: authHeader },
      });

      expect(res.payload).not.toContain(key);
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
