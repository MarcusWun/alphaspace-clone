import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchFn = vi.hoisted(() => vi.fn());

vi.mock("yahoo-finance2", () => ({
  default: vi.fn().mockImplementation(() => ({ search: mockSearchFn })),
}));

import { yahooProvider } from "../../services/news/yahoo.js";

// Unix seconds for 2025-10-01 UTC midnight = 1759276800
const FROM = "2025-09-01";
const TO = "2025-10-31";

// ISO string that falls inside the window (2025-10-01 12:00:00Z)
const IN_WINDOW_ISO = "2025-10-01T12:00:00Z";
const IN_WINDOW_ISO_SEC = Math.floor(Date.parse(IN_WINDOW_ISO) / 1000);

// ISO string that falls outside the window (before FROM: 2025-07-31)
const OUT_OF_WINDOW_ISO = "2025-07-31T00:00:00Z";

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

  // --- Regression tests: providerPublishTime string | number handling ---

  // T2a: ISO string within window → included, datetime is correct unix seconds
  it("T2a: ISO string providerPublishTime within window is included and mapped to unix seconds", async () => {
    const isoItem = { ...FAKE_NEWS_ITEM, providerPublishTime: IN_WINDOW_ISO };
    mockSearchFn.mockResolvedValueOnce({ news: [isoItem] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);

    expect(items).toHaveLength(1);
    expect(items[0]!.datetime).toBe(IN_WINDOW_ISO_SEC);
    expect(Number.isInteger(items[0]!.datetime)).toBe(true);
  });

  // T2b: Numeric providerPublishTime within window still works (backwards compat)
  it("T2b: Numeric providerPublishTime within window is still included (backwards compat)", async () => {
    mockSearchFn.mockResolvedValueOnce({ news: [FAKE_NEWS_ITEM] }); // FAKE_NEWS_ITEM uses IN_WINDOW_TS (number)

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);

    expect(items).toHaveLength(1);
    expect(items[0]!.datetime).toBe(IN_WINDOW_TS);
  });

  // T2c: ISO string outside window → excluded
  it("T2c: ISO string providerPublishTime outside window is excluded", async () => {
    const outItem = { ...FAKE_NEWS_ITEM, providerPublishTime: OUT_OF_WINDOW_ISO };
    mockSearchFn.mockResolvedValueOnce({ news: [outItem] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);

    expect(items).toHaveLength(0);
  });

  // T2d: Malformed string → excluded, no throw
  it("T2d: Malformed providerPublishTime string is excluded without throwing", async () => {
    const malformedItem = { ...FAKE_NEWS_ITEM, providerPublishTime: "not-a-date" };
    mockSearchFn.mockResolvedValueOnce({ news: [malformedItem] });

    await expect(yahooProvider.getCompanyNews("NVDA", FROM, TO)).resolves.toHaveLength(0);
  });

  // T2e: Missing providerPublishTime (undefined) → excluded
  it("T2e: Missing providerPublishTime (undefined) is excluded", async () => {
    const noTimestamp = { ...FAKE_NEWS_ITEM, providerPublishTime: undefined };
    mockSearchFn.mockResolvedValueOnce({ news: [noTimestamp] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);

    expect(items).toHaveLength(0);
  });

  // T2f: Mixed array — numeric in-window + ISO in-window + malformed → first two included, third excluded
  it("T2f: Mixed array: numeric-in-window and ISO-in-window included; malformed excluded", async () => {
    const numericItem = { ...FAKE_NEWS_ITEM, link: "https://example.com/numeric", providerPublishTime: IN_WINDOW_TS };
    const isoItem = { ...FAKE_NEWS_ITEM, link: "https://example.com/iso", providerPublishTime: IN_WINDOW_ISO };
    const malformedItem = { ...FAKE_NEWS_ITEM, link: "https://example.com/bad", providerPublishTime: "not-a-date" };

    mockSearchFn.mockResolvedValueOnce({ news: [numericItem, isoItem, malformedItem] });

    const items = await yahooProvider.getCompanyNews("NVDA", FROM, TO);

    expect(items).toHaveLength(2);
    const datetimes = items.map((i) => i.datetime);
    expect(datetimes).toContain(IN_WINDOW_TS);
    expect(datetimes).toContain(IN_WINDOW_ISO_SEC);
  });
});
