/**
 * Service-level tests for services/fundamentals.ts
 *
 * Covers:
 * - 5× happy path: correct Finnhub path + params, correct Redis cache key + TTL, data passthrough
 * - 5× cache-hit: no fetch call, returns cached payload
 * - 1× 429 propagation: FinnhubError thrown, Redis.set NOT called
 * - 1× scrubKey: FINNHUB_API_KEY not present in returned data
 */

import { describe, it, expect, vi } from "vitest";
import {
  getStockMetric,
  getStockEarnings,
  getStockFinancials,
  getStockFilings,
  getStockRecommendation,
} from "../services/fundamentals.js";
import { FinnhubError } from "../services/finnhub.js";
import { mockRedis } from "./setup.js";

const FINNHUB_KEY = process.env["FINNHUB_API_KEY"]!;
const SYM = "NVDA";

function mockFetchOk(payload: unknown) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => payload,
  } as Response);
}

function mockFetchStatus(status: number) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: false,
    status,
    statusText: status === 429 ? "Too Many Requests" : "Internal Server Error",
  } as Response);
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("fundamentals service — happy path", () => {
  it("getStockMetric: hits /stock/metric with correct params, caches 86400s", async () => {
    const payload = { metric: { "52WeekHigh": 500 }, symbol: SYM };
    mockFetchOk(payload);

    const result = await getStockMetric(SYM);

    expect(result.source).toBe("upstream");
    expect(result.data).toMatchObject({ metric: { "52WeekHigh": 500 } });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0]!;
    const url = new URL(fetchCall[0] as string);
    expect(url.pathname).toBe("/api/v1/stock/metric");
    expect(url.searchParams.get("symbol")).toBe(SYM);
    expect(url.searchParams.get("metric")).toBe("all");

    expect(mockRedis.set).toHaveBeenCalledWith(
      `finnhub:metric:${SYM}`,
      expect.any(String),
      "EX",
      86400
    );
  });

  it("getStockEarnings: hits /stock/earnings, caches 86400s", async () => {
    const payload = [{ actual: 2.5, estimate: 2.4, period: "2026-Q3", symbol: SYM }];
    mockFetchOk(payload);

    const result = await getStockEarnings(SYM);

    expect(result.source).toBe("upstream");
    const url = new URL((vi.mocked(global.fetch).mock.calls[0]![0]) as string);
    expect(url.pathname).toBe("/api/v1/stock/earnings");
    expect(url.searchParams.get("symbol")).toBe(SYM);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `finnhub:earnings:${SYM}`,
      expect.any(String),
      "EX",
      86400
    );
  });

  it("getStockFinancials: hits /stock/financials-reported, caches 86400s", async () => {
    const payload = { data: [{ revenue: 10_000 }], symbol: SYM };
    mockFetchOk(payload);

    const result = await getStockFinancials(SYM);

    expect(result.source).toBe("upstream");
    const url = new URL((vi.mocked(global.fetch).mock.calls[0]![0]) as string);
    expect(url.pathname).toBe("/api/v1/stock/financials-reported");

    expect(mockRedis.set).toHaveBeenCalledWith(
      `finnhub:financials:${SYM}`,
      expect.any(String),
      "EX",
      86400
    );
  });

  it("getStockFilings: hits /stock/filings with limit param, caches 21600s", async () => {
    const payload = [{ form: "10-K", filedDate: "2026-01-15", reportUrl: "https://sec.gov/x" }];
    mockFetchOk(payload);

    const result = await getStockFilings(SYM, 5);

    expect(result.source).toBe("upstream");
    const url = new URL((vi.mocked(global.fetch).mock.calls[0]![0]) as string);
    expect(url.pathname).toBe("/api/v1/stock/filings");
    expect(url.searchParams.get("limit")).toBe("5");

    expect(mockRedis.set).toHaveBeenCalledWith(
      `finnhub:filings:${SYM}:5`,
      expect.any(String),
      "EX",
      21600
    );
  });

  it("getStockRecommendation: hits /stock/recommendation, caches 86400s", async () => {
    const payload = [{ strongBuy: 10, buy: 15, hold: 5, sell: 2, strongSell: 1, period: "2026-10-01", symbol: SYM }];
    mockFetchOk(payload);

    const result = await getStockRecommendation(SYM);

    expect(result.source).toBe("upstream");
    const url = new URL((vi.mocked(global.fetch).mock.calls[0]![0]) as string);
    expect(url.pathname).toBe("/api/v1/stock/recommendation");

    expect(mockRedis.set).toHaveBeenCalledWith(
      `finnhub:recommendation:${SYM}`,
      expect.any(String),
      "EX",
      86400
    );
  });
});

// ─── Cache hit ────────────────────────────────────────────────────────────────

describe("fundamentals service — cache hit", () => {
  it("getStockMetric: returns cached payload, no fetch call", async () => {
    const cached = { metric: { beta: 1.5 }, symbol: SYM };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await getStockMetric(SYM);

    expect(result.source).toBe("cache");
    expect(result.data).toEqual(cached);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("getStockEarnings: returns cached payload, no fetch call", async () => {
    const cached = [{ actual: 1.1, estimate: 1.0 }];
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await getStockEarnings(SYM);

    expect(result.source).toBe("cache");
    expect(result.data).toEqual(cached);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("getStockFinancials: returns cached payload, no fetch call", async () => {
    const cached = { data: [{ revenue: 99 }] };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await getStockFinancials(SYM);

    expect(result.source).toBe("cache");
    expect(result.data).toEqual(cached);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("getStockFilings: returns cached payload, no fetch call", async () => {
    const cached = [{ form: "10-Q" }];
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await getStockFilings(SYM);

    expect(result.source).toBe("cache");
    expect(result.data).toEqual(cached);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("getStockRecommendation: returns cached payload, no fetch call", async () => {
    const cached = [{ strongBuy: 8, buy: 12 }];
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await getStockRecommendation(SYM);

    expect(result.source).toBe("cache");
    expect(result.data).toEqual(cached);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────────

describe("fundamentals service — error paths", () => {
  it("429 propagation: throws FinnhubError(429), does not write to Redis", async () => {
    mockFetchStatus(429);

    const err = await getStockMetric(SYM).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FinnhubError);
    expect((err as FinnhubError).statusCode).toBe(429);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("scrubKey: FINNHUB_API_KEY is not present in returned data", async () => {
    // Inject a mock response that happens to contain the API key as a field value
    mockFetchOk({ metric: { apiKeyLeak: FINNHUB_KEY }, symbol: SYM });

    const result = await getStockMetric(SYM);

    expect(JSON.stringify(result.data)).not.toContain(FINNHUB_KEY);
  });
});
