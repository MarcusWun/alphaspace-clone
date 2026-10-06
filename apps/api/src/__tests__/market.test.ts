import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../app.js";
import { mockRedis } from "./setup.js";
import jwt from "jsonwebtoken";

const SECRET = process.env["AUTH_SECRET"]!;

function bearerFor(userId: string, email: string) {
  return `Bearer ${jwt.sign({ sub: userId, email }, SECRET, { expiresIn: "1h" })}`;
}

const authHeader = bearerFor("user-1", "test@example.com");

// Candles are now served from Alpha Vantage (see candles-alpha-vantage PRD).
// The upstream payload shape is `Time Series (Daily)` etc.; the route hands back
// the Finnhub-shaped {c,h,l,o,t,v,s} envelope — unchanged frontend contract.

const AV_BASE_TS = Math.floor(Date.parse("2026-10-03") / 1000);

function alphaVantageDailyPayload() {
  return {
    "Meta Data": { "1. Information": "Daily Prices" },
    "Time Series (Daily)": {
      "2026-10-03": {
        "1. open": "150.0", "2. high": "152.0", "3. low": "149.0",
        "4. close": "151.0", "5. volume": "1000000",
      },
      "2026-10-02": {
        "1. open": "148.0", "2. high": "151.0", "3. low": "147.5",
        "4. close": "150.0", "5. volume": "900000",
      },
    },
  };
}

describe("Market proxy routes", () => {
  describe("GET /api/candles", () => {
    it("returns Finnhub-shaped candle data from Alpha Vantage for valid params", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => alphaVantageDailyPayload(),
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=${AV_BASE_TS - 86400}&to=${AV_BASE_TS + 86400}`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { s: string; c: number[]; t: number[] } }>();
      expect(body.data.s).toBe("ok");
      expect(body.data.c.length).toBeGreaterThan(0);
      expect(body.data.t.length).toBe(body.data.c.length);
      await app.close();
    });

    it("returns 200 {s:'no_data'} for unknown symbol (Alpha Vantage Error Message)", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ "Error Message": "Invalid API call" }),
      } as Response);

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

    it("returns 429 when Alpha Vantage quota is exhausted (Note payload)", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Note: "Thank you for using Alpha Vantage! ...25 requests per day..." }),
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=0&to=9999999999`,
        headers: { authorization: authHeader },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json<{ data: { s: string; reason: string } }>();
      expect(body.data.s).toBe("error");
      expect(body.data.reason).toBe("rate_limited");
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

    it("does not leak ALPHA_VANTAGE_API_KEY in response", async () => {
      const key = process.env["ALPHA_VANTAGE_API_KEY"]!;
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => alphaVantageDailyPayload(),
      } as Response);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/api/candles?symbol=AAPL&resolution=D&from=0&to=9999999999`,
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
