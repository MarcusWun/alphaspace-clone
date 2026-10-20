import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRedis } from "../setup.js";

const mockSearch = vi.hoisted(() => vi.fn());

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ search: mockSearch })),
}));

import { getCompanyNews } from "../../services/news/index.js";

const IN_WINDOW_TS = 1759276800; // 2025-10-01 UTC

const FAKE_SEARCH_RESULT = {
  news: [
    {
      title: "NVDA news",
      link: "https://example.com/news/1",
      publisher: "Reuters",
      providerPublishTime: IN_WINDOW_TS,
    },
  ],
};

beforeEach(() => {
  mockSearch.mockReset();
});

describe("News barrel — Redis cache", () => {
  it("cold miss: calls upstream Yahoo and writes to Redis with 15-min TTL", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockSearch.mockResolvedValueOnce(FAKE_SEARCH_RESULT);

    await getCompanyNews("NVDA", "2025-10-01", "2025-10-31");

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^news:yahoo:NVDA:/),
      expect.any(String),
      "EX",
      900
    );
  });

  it("warm hit: returns cached data without calling upstream", async () => {
    const cachedItems = [{ headline: "cached", id: 999, datetime: IN_WINDOW_TS }];
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedItems));

    const items = await getCompanyNews("NVDA", "2025-10-01", "2025-10-31");

    expect(items).toEqual(cachedItems);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("cache key includes provider, symbol, from, to", async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockSearch.mockResolvedValueOnce({ news: [] });

    await getCompanyNews("AAPL", "2025-09-01", "2025-09-30");

    expect(mockRedis.get).toHaveBeenCalledWith("news:yahoo:AAPL:2025-09-01:2025-09-30");
  });

  it("emits cache_hit log on warm hit", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cached = [{ headline: "cached" }];
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

    await getCompanyNews("NVDA", "2025-10-01", "2025-10-31");

    const logCalls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logCalls.some((msg) => msg.includes("news.cache_hit"))).toBe(true);
    logSpy.mockRestore();
  });

  it("emits cache_miss and upstream_call logs on cold miss", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockRedis.get.mockResolvedValueOnce(null);
    mockSearch.mockResolvedValueOnce({ news: [] });

    await getCompanyNews("NVDA", "2025-10-01", "2025-10-31");

    const logCalls = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logCalls.some((msg) => msg.includes("news.cache_miss"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("news.upstream_call"))).toBe(true);
    logSpy.mockRestore();
  });
});
