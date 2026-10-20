import { describe, it, expect, afterEach, vi } from "vitest";

// Module-level code in news/index.ts reads NEWS_PROVIDER at init time.
// Reset modules between tests so each test gets a fresh import with its env value.

afterEach(() => {
  vi.resetModules();
  delete process.env["NEWS_PROVIDER"];
});

vi.mock("../../services/redis.js", () => ({
  getRedis: () => ({ get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue("OK") }),
  closeRedis: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ search: vi.fn() })),
}));

describe("News provider selection", () => {
  it("defaults to yahoo when NEWS_PROVIDER is unset", async () => {
    delete process.env["NEWS_PROVIDER"];
    const { newsProvider } = await import("../../services/news/index.js");
    expect(newsProvider.name).toBe("yahoo");
  });

  it("selects yahoo when NEWS_PROVIDER=yahoo", async () => {
    process.env["NEWS_PROVIDER"] = "yahoo";
    const { newsProvider } = await import("../../services/news/index.js");
    expect(newsProvider.name).toBe("yahoo");
  });

  it("selects finnhub when NEWS_PROVIDER=finnhub", async () => {
    process.env["NEWS_PROVIDER"] = "finnhub";
    const { newsProvider } = await import("../../services/news/index.js");
    expect(newsProvider.name).toBe("finnhub");
  });

  it("defaults to yahoo for unknown provider value", async () => {
    process.env["NEWS_PROVIDER"] = "benzinga";
    const { newsProvider } = await import("../../services/news/index.js");
    expect(newsProvider.name).toBe("yahoo");
  });
});
