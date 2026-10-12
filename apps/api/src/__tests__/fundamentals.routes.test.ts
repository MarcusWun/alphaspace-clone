/**
 * Route-level tests for fundamentals proxy endpoints (Phase 2a).
 *
 * Covers:
 * - 5× happy path: mock service returns {data, source}, assert {data} envelope + 200
 * - 5× missing symbol → 400
 * - 5× upstream 429 from service → 429 { error:"rate_limited", statusCode:429 }
 */

import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../app.js";
import { FinnhubError } from "../services/finnhub.js";
import jwt from "jsonwebtoken";

const SECRET = process.env["AUTH_SECRET"]!;

function bearerFor(userId: string, email: string) {
  return `Bearer ${jwt.sign({ sub: userId, email }, SECRET, { expiresIn: "1h" })}`;
}

const authHeader = bearerFor("user-1", "test@example.com");

// Mock the fundamentals service module
vi.mock("../services/fundamentals.js", () => ({
  getStockMetric: vi.fn(),
  getStockEarnings: vi.fn(),
  getStockFinancials: vi.fn(),
  getStockFilings: vi.fn(),
  getStockRecommendation: vi.fn(),
}));

import {
  getStockMetric,
  getStockEarnings,
  getStockFinancials,
  getStockFilings,
  getStockRecommendation,
} from "../services/fundamentals.js";

const MOCK_DATA = { metric: { "52WeekHigh": 500 } };
const HAPPY = { data: MOCK_DATA, source: "upstream" as const };
const CACHED = { data: MOCK_DATA, source: "cache" as const };

// ─── Happy path (200 + {data} envelope) ──────────────────────────────────────

describe("GET /api/stock/metric", () => {
  it("returns 200 with {data} envelope on happy path", async () => {
    vi.mocked(getStockMetric).mockResolvedValueOnce(HAPPY);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/metric?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown }>();
    expect(body.data).toEqual(MOCK_DATA);
    await app.close();
  });

  it("returns 200 on cache hit", async () => {
    vi.mocked(getStockMetric).mockResolvedValueOnce(CACHED);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/metric?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 for missing symbol", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/metric",
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 429 when service throws FinnhubError(429)", async () => {
    vi.mocked(getStockMetric).mockRejectedValueOnce(
      new FinnhubError(429, "Too Many Requests")
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/metric?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json<{ error: string; statusCode: number }>();
    expect(body.error).toBe("rate_limited");
    expect(body.statusCode).toBe(429);
    await app.close();
  });
});

describe("GET /api/stock/earnings", () => {
  it("returns 200 with {data} envelope on happy path", async () => {
    vi.mocked(getStockEarnings).mockResolvedValueOnce(HAPPY);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/earnings?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown }>();
    expect(body.data).toEqual(MOCK_DATA);
    await app.close();
  });

  it("returns 400 for missing symbol", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/earnings",
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 429 when service throws FinnhubError(429)", async () => {
    vi.mocked(getStockEarnings).mockRejectedValueOnce(
      new FinnhubError(429, "Too Many Requests")
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/earnings?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: string }>().error).toBe("rate_limited");
    await app.close();
  });
});

describe("GET /api/stock/financials", () => {
  it("returns 200 with {data} envelope on happy path", async () => {
    vi.mocked(getStockFinancials).mockResolvedValueOnce(HAPPY);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/financials?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown }>();
    expect(body.data).toEqual(MOCK_DATA);
    await app.close();
  });

  it("returns 400 for missing symbol", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/financials",
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 429 when service throws FinnhubError(429)", async () => {
    vi.mocked(getStockFinancials).mockRejectedValueOnce(
      new FinnhubError(429, "Too Many Requests")
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/financials?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: string }>().error).toBe("rate_limited");
    await app.close();
  });
});

describe("GET /api/stock/filings", () => {
  it("returns 200 with {data} envelope on happy path", async () => {
    vi.mocked(getStockFilings).mockResolvedValueOnce(HAPPY);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/filings?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown }>();
    expect(body.data).toEqual(MOCK_DATA);
    await app.close();
  });

  it("passes limit param to service and returns 200", async () => {
    vi.mocked(getStockFilings).mockResolvedValueOnce(HAPPY);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/filings?symbol=NVDA&limit=5",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(getStockFilings)).toHaveBeenCalledWith("NVDA", 5);
    await app.close();
  });

  it("returns 400 for missing symbol", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/filings",
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 429 when service throws FinnhubError(429)", async () => {
    vi.mocked(getStockFilings).mockRejectedValueOnce(
      new FinnhubError(429, "Too Many Requests")
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/filings?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: string }>().error).toBe("rate_limited");
    await app.close();
  });
});

describe("GET /api/stock/recommendation", () => {
  it("returns 200 with {data} envelope on happy path", async () => {
    vi.mocked(getStockRecommendation).mockResolvedValueOnce(HAPPY);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/recommendation?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown }>();
    expect(body.data).toEqual(MOCK_DATA);
    await app.close();
  });

  it("returns 400 for missing symbol", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/recommendation",
      headers: { authorization: authHeader },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 429 when service throws FinnhubError(429)", async () => {
    vi.mocked(getStockRecommendation).mockRejectedValueOnce(
      new FinnhubError(429, "Too Many Requests")
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/stock/recommendation?symbol=NVDA",
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: string }>().error).toBe("rate_limited");
    await app.close();
  });
});
