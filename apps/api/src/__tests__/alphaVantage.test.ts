/**
 * Unit tests for the Alpha Vantage candle service.
 *
 * Covers:
 *  - resolution → function/interval map
 *  - response-shape transform (Finnhub-shaped output, ascending sort,
 *    invalid-row drop, defensive key picking, no_data fallback)
 *  - error payload classification (unknown symbol, quota, unexpected)
 *  - cache hit path + per-resolution TTL
 *  - rate-limit cool-off window
 *
 * Tests mock the Alpha Vantage HTTP boundary (`global.fetch`). No live
 * API calls — see PRD §P2.
 */

import { describe, it, expect, vi } from "vitest";
import {
  getCandles,
  mapResolution,
  isIntradayResolution,
  transformCandles,
  classifyPayload,
  sliceCandles,
  UnknownSymbolError,
  QuotaExceededError,
  UnexpectedResponseError,
} from "../services/alphaVantage.js";
import { mockRedis } from "./setup.js";

const REAL_AV_KEY = process.env["ALPHA_VANTAGE_API_KEY"]!;

describe("Alpha Vantage candle service", () => {
  describe("mapResolution", () => {
    it("maps D → TIME_SERIES_DAILY (no interval)", () => {
      expect(mapResolution("D")).toEqual({ function: "TIME_SERIES_DAILY" });
    });
    it("maps W → TIME_SERIES_WEEKLY", () => {
      expect(mapResolution("W")).toEqual({ function: "TIME_SERIES_WEEKLY" });
    });
    it("maps M → TIME_SERIES_MONTHLY", () => {
      expect(mapResolution("M")).toEqual({ function: "TIME_SERIES_MONTHLY" });
    });
    it("maps 1 → intraday 1min", () => {
      expect(mapResolution("1")).toEqual({ function: "TIME_SERIES_INTRADAY", interval: "1min" });
    });
    it("maps 5 → intraday 5min", () => {
      expect(mapResolution("5")).toEqual({ function: "TIME_SERIES_INTRADAY", interval: "5min" });
    });
    it("maps 15 → intraday 15min", () => {
      expect(mapResolution("15")).toEqual({ function: "TIME_SERIES_INTRADAY", interval: "15min" });
    });
    it("maps 30 → intraday 30min", () => {
      expect(mapResolution("30")).toEqual({ function: "TIME_SERIES_INTRADAY", interval: "30min" });
    });
    it("maps 60 → intraday 60min", () => {
      expect(mapResolution("60")).toEqual({ function: "TIME_SERIES_INTRADAY", interval: "60min" });
    });
    it("throws on unsupported resolution", () => {
      expect(() => mapResolution("Q")).toThrow(/Unsupported resolution/);
    });
  });

  describe("isIntradayResolution", () => {
    it.each(["1", "5", "15", "30", "60"])("%s is intraday", (r) => {
      expect(isIntradayResolution(r)).toBe(true);
    });
    it.each(["D", "W", "M"])("%s is NOT intraday", (r) => {
      expect(isIntradayResolution(r)).toBe(false);
    });
  });

  describe("transformCandles", () => {
    it("converts daily Alpha Vantage payload to Finnhub shape with ascending timestamps", () => {
      const payload = {
        "Meta Data": { "1. Information": "..." },
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
      const result = transformCandles(payload);
      expect(result.s).toBe("ok");
      // Sorted ascending
      expect(result.t[0]).toBeLessThan(result.t[1]!);
      expect(result.o).toEqual([148.0, 150.0]);
      expect(result.h).toEqual([151.0, 152.0]);
      expect(result.l).toEqual([147.5, 149.0]);
      expect(result.c).toEqual([150.0, 151.0]);
      expect(result.v).toEqual([900000, 1000000]);
      expect(result.t[0]).toBe(Math.floor(Date.parse("2026-10-02") / 1000));
    });

    it("picks the first *Time Series* key defensively (handles key renames)", () => {
      const payload = {
        "Weekly Time Series": {
          "2026-10-03": {
            "1. open": "100", "2. high": "110", "3. low": "95",
            "4. close": "105", "5. volume": "10000",
          },
        },
      };
      const result = transformCandles(payload);
      expect(result.s).toBe("ok");
      expect(result.c).toEqual([105]);
    });

    it("drops rows with non-numeric fields", () => {
      const payload = {
        "Time Series (Daily)": {
          "2026-10-03": {
            "1. open": "150", "2. high": "152", "3. low": "149",
            "4. close": "151", "5. volume": "1000",
          },
          "2026-10-02": {
            "1. open": "not-a-number", "2. high": "151", "3. low": "147",
            "4. close": "150", "5. volume": "900",
          },
        },
      };
      const result = transformCandles(payload);
      expect(result.s).toBe("ok");
      expect(result.c).toEqual([151]); // only the valid row
    });

    it("returns no_data when the *Time Series* key is missing", () => {
      expect(transformCandles({ "Meta Data": {} }).s).toBe("no_data");
    });

    it("returns no_data for null / non-object payloads", () => {
      expect(transformCandles(null).s).toBe("no_data");
      expect(transformCandles("not an object").s).toBe("no_data");
    });

    it("returns no_data when the series is empty after filtering", () => {
      const payload = {
        "Time Series (Daily)": {
          "bad-date": {
            "1. open": "x", "2. high": "y", "3. low": "z",
            "4. close": "q", "5. volume": "r",
          },
        },
      };
      expect(transformCandles(payload).s).toBe("no_data");
    });
  });

  describe("classifyPayload", () => {
    it("Error Message → unknown_symbol", () => {
      const c = classifyPayload({ "Error Message": "Invalid API call..." }, "BOGUS");
      expect(c.kind).toBe("unknown_symbol");
      if (c.kind === "unknown_symbol") {
        expect(c.error).toBeInstanceOf(UnknownSymbolError);
      }
    });

    it("Note → quota", () => {
      const c = classifyPayload({ Note: "Thank you for using Alpha Vantage..." }, "AAPL");
      expect(c.kind).toBe("quota");
      if (c.kind === "quota") {
        expect(c.error).toBeInstanceOf(QuotaExceededError);
      }
    });

    it("Information → quota (premium gate)", () => {
      const c = classifyPayload({ Information: "...premium endpoint..." }, "AAPL");
      expect(c.kind).toBe("quota");
    });

    it("missing time series → unexpected", () => {
      const c = classifyPayload({ "Meta Data": {} }, "AAPL");
      expect(c.kind).toBe("unexpected");
      if (c.kind === "unexpected") {
        expect(c.error).toBeInstanceOf(UnexpectedResponseError);
      }
    });

    it("valid payload → ok", () => {
      const c = classifyPayload({ "Time Series (Daily)": {} }, "AAPL");
      expect(c.kind).toBe("ok");
    });

    it("non-object → unexpected", () => {
      expect(classifyPayload(null, "AAPL").kind).toBe("unexpected");
    });
  });

  describe("sliceCandles", () => {
    const full = {
      s: "ok" as const,
      t: [100, 200, 300, 400, 500],
      o: [1, 2, 3, 4, 5],
      h: [1, 2, 3, 4, 5],
      l: [1, 2, 3, 4, 5],
      c: [1, 2, 3, 4, 5],
      v: [1, 2, 3, 4, 5],
    };

    it("returns inclusive window", () => {
      const result = sliceCandles(full, 200, 400);
      expect(result.s).toBe("ok");
      expect(result.t).toEqual([200, 300, 400]);
      expect(result.c).toEqual([2, 3, 4]);
    });

    it("returns no_data when window is empty", () => {
      const result = sliceCandles(full, 1000, 2000);
      expect(result.s).toBe("no_data");
      expect(result.t).toEqual([]);
    });

    it("passes through no_data input unchanged", () => {
      const empty = { s: "no_data" as const, t: [], o: [], h: [], l: [], c: [], v: [] };
      expect(sliceCandles(empty, 0, 100).s).toBe("no_data");
    });
  });

  describe("getCandles (integration-ish, fetch mocked)", () => {
    const dailyPayload = {
      "Meta Data": {},
      "Time Series (Daily)": {
        "2026-10-03": {
          "1. open": "150", "2. high": "152", "3. low": "149",
          "4. close": "151", "5. volume": "1000",
        },
      },
    };

    it("fetches and caches on miss, with 24h TTL for daily resolution", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => dailyPayload,
      } as Response);

      const result = await getCandles({
        symbol: "AAPL", resolution: "D", from: "1700000000", to: "1800000000",
      });

      expect(result.s).toBe("ok");
      expect(mockRedis.set).toHaveBeenCalledWith(
        "alphavantage:candles:AAPL:D",
        expect.any(String),
        "EX",
        86_400
      );
    });

    it("uses 5-minute TTL for intraday resolutions", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "Time Series (5min)": {
            "2026-10-03 15:55:00": {
              "1. open": "150", "2. high": "151", "3. low": "149",
              "4. close": "150.5", "5. volume": "100",
            },
          },
        }),
      } as Response);

      await getCandles({
        symbol: "AAPL", resolution: "5", from: "1700000000", to: "1800000000",
      });

      expect(mockRedis.set).toHaveBeenCalledWith(
        "alphavantage:candles:AAPL:5",
        expect.any(String),
        "EX",
        300
      );
    });

    it("returns cached payload without calling fetch on hit", async () => {
      const cached = {
        s: "ok", t: [1_700_000_000], o: [1], h: [1], l: [1], c: [1], v: [1],
      };
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "alphavantage:ratelimited") return null;
        if (key === "alphavantage:candles:MSFT:D") return JSON.stringify(cached);
        return null;
      });

      const result = await getCandles({
        symbol: "MSFT", resolution: "D", from: "0", to: "9999999999",
      });

      expect(result).toEqual(cached);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("throws QuotaExceededError and latches a 60s cool-off key on Note payload", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Note: "...25 requests per day..." }),
      } as Response);

      await expect(
        getCandles({ symbol: "AAPL", resolution: "D", from: "0", to: "1" })
      ).rejects.toBeInstanceOf(QuotaExceededError);

      expect(mockRedis.set).toHaveBeenCalledWith(
        "alphavantage:ratelimited",
        "1",
        "EX",
        60
      );
    });

    it("short-circuits with QuotaExceededError while the cool-off key is set", async () => {
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === "alphavantage:ratelimited") return "1";
        return null;
      });

      await expect(
        getCandles({ symbol: "AAPL", resolution: "D", from: "0", to: "1" })
      ).rejects.toBeInstanceOf(QuotaExceededError);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("throws UnknownSymbolError on Error Message payload", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ "Error Message": "Invalid API call" }),
      } as Response);

      await expect(
        getCandles({ symbol: "BOGUS", resolution: "D", from: "0", to: "1" })
      ).rejects.toBeInstanceOf(UnknownSymbolError);
    });

    it("throws UnexpectedResponseError on missing time-series key", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ "Meta Data": {} }),
      } as Response);

      await expect(
        getCandles({ symbol: "AAPL", resolution: "D", from: "0", to: "1" })
      ).rejects.toBeInstanceOf(UnexpectedResponseError);
    });

    it("does not leak ALPHA_VANTAGE_API_KEY in cached payload", async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => dailyPayload,
      } as Response);

      await getCandles({
        symbol: "AAPL", resolution: "D", from: "0", to: "9999999999",
      });

      // Inspect what was serialized into Redis
      const serialized = mockRedis.set.mock.calls
        .map((c) => c[1])
        .join("");
      expect(serialized).not.toContain(REAL_AV_KEY);
    });
  });
});
