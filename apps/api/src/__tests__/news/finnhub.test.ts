import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/finnhub.js", () => ({
  finnhubFetch: vi.fn(),
  cachedFetch: vi.fn(),
  cachedFetchWithMeta: vi.fn(),
  getQuote: vi.fn(),
  getFundamentals: vi.fn(),
  checkFinnhubReachability: vi.fn(),
  FinnhubError: class FinnhubError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { finnhubProvider } from "../../services/news/finnhub.js";
import { finnhubFetch } from "../../services/finnhub.js";

const mockFinnhubFetch = vi.mocked(finnhubFetch);

beforeEach(() => {
  mockFinnhubFetch.mockReset();
});

const FAKE_FINNHUB_NEWS = [
  {
    category: "company",
    datetime: 1759276800,
    headline: "NVDA Q4 earnings beat",
    id: 12345,
    image: "https://img.finnhub.io/nvda.jpg",
    related: "NVDA",
    source: "Bloomberg",
    summary: "NVDA posted record revenue.",
    url: "https://finnhub.io/nvda-news",
  },
];

describe("Finnhub news provider", () => {
  it("maps Finnhub native shape to NewsItem correctly", async () => {
    mockFinnhubFetch.mockResolvedValueOnce(FAKE_FINNHUB_NEWS);

    const items = await finnhubProvider.getCompanyNews("NVDA", "2025-10-01", "2025-10-31");

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.category).toBe("company");
    expect(item.datetime).toBe(1759276800);
    expect(item.headline).toBe("NVDA Q4 earnings beat");
    expect(item.id).toBe(12345);
    expect(item.image).toBe("https://img.finnhub.io/nvda.jpg");
    expect(item.related).toBe("NVDA");
    expect(item.source).toBe("Bloomberg");
    expect(item.summary).toBe("NVDA posted record revenue.");
    expect(item.url).toBe("https://finnhub.io/nvda-news");
  });

  it("calls finnhubFetch with correct path and params", async () => {
    mockFinnhubFetch.mockResolvedValueOnce([]);

    await finnhubProvider.getCompanyNews("AAPL", "2025-09-01", "2025-09-30");

    expect(mockFinnhubFetch).toHaveBeenCalledWith("/company-news", {
      symbol: "AAPL",
      from: "2025-09-01",
      to: "2025-09-30",
    });
  });

  it("returns [] when Finnhub returns a non-array response", async () => {
    mockFinnhubFetch.mockResolvedValueOnce(null);
    const items = await finnhubProvider.getCompanyNews("AAPL", "2025-09-01", "2025-09-30");
    expect(items).toEqual([]);
  });

  it("provides default field values when Finnhub item has missing fields", async () => {
    mockFinnhubFetch.mockResolvedValueOnce([{}]);
    const items = await finnhubProvider.getCompanyNews("TSLA", "2025-09-01", "2025-09-30");
    expect(items[0]!.headline).toBe("");
    expect(items[0]!.related).toBe("TSLA"); // falls back to symbol
    expect(items[0]!.category).toBe("company");
  });
});
