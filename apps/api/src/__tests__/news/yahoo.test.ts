import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchFn = vi.hoisted(() => vi.fn());

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ search: mockSearchFn })),
}));

import { yahooProvider } from "../../services/news/yahoo.js";

// Unix seconds for 2025-10-01 UTC midnight = 1759276800
const FROM = "2025-09-01";
const TO = "2025-10-31";

// providerPublishTime that falls within [FROM, TO]
const IN_WINDOW_TS = 1759276800; // 2025-10-01 UTC

// providerPublishTime outside the window (before FROM)
const OUT_OF_WINDOW_TS = 1753920000; // 2025-07-31 UTC

const FAKE_NEWS_ITEM = {
  title: "NVDA smashes estimates",
  link: "https://example.com/nvda-news",
  publisher: "Reuters",
  providerPublishTime: IN_WINDOW_TS,
  thumbnail: {
    resolutions: [{ url: "https://img.example.com/thumb.jpg" }],
  },
};

beforeEach(() => {
  mockSearchFn.mockReset();
});

describe("Yahoo news provider", () => {
  it("maps Yahoo search result to NewsItem correctly", async () => {
    mockSearchFn.mockResolvedValueOnce({ news: [FAKE_NEWS_ITEM] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.headline).toBe("NVDA smashes estimates");
    expect(item.source).toBe("Reuters");
    expect(item.url).toBe("https://example.com/nvda-news");
    expect(item.datetime).toBe(IN_WINDOW_TS);
    expect(item.image).toBe("https://img.example.com/thumb.jpg");
    expect(item.category).toBe("company");
    expect(item.related).toBe("NVDA");
    expect(item.summary).toBe("");
    expect(typeof item.id).toBe("number");
  });

  it("synthesizes a numeric id from url + publishTime", async () => {
    mockSearchFn.mockResolvedValueOnce({ news: [FAKE_NEWS_ITEM] });
    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);
    // id must be a non-negative integer (UInt32 hash)
    expect(items[0]!.id).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(items[0]!.id)).toBe(true);
  });

  it("image falls back to empty string when thumbnail is absent", async () => {
    const noThumb = { ...FAKE_NEWS_ITEM, thumbnail: undefined };
    mockSearchFn.mockResolvedValueOnce({ news: [noThumb] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);
    expect(items[0]!.image).toBe("");
  });

  it("filters out items outside the [from, to] date window", async () => {
    const outsideWindow = { ...FAKE_NEWS_ITEM, providerPublishTime: OUT_OF_WINDOW_TS };
    mockSearchFn.mockResolvedValueOnce({ news: [outsideWindow] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);
    expect(items).toHaveLength(0);
  });

  it("returns [] when Yahoo returns no news field", async () => {
    mockSearchFn.mockResolvedValueOnce({});
    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);
    expect(items).toEqual([]);
  });

  it("returns [] when Yahoo returns an empty news array", async () => {
    mockSearchFn.mockResolvedValueOnce({ news: [] });
    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);
    expect(items).toEqual([]);
  });

  it("returns [] and logs a warning when Yahoo throws (e.g. network error)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSearchFn.mockRejectedValueOnce(new Error("Network error"));

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);
    expect(items).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("news.upstream_error")
    );
    warnSpy.mockRestore();
  });
});
