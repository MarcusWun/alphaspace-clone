/**
 * AS-FE-11: News Feed panel tests
 * Verifies that ticker change triggers fetch with new symbol.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// Use vi.hoisted so the mock fn reference is available before vi.mock hoisting
const { fetchCompanyNewsMock } = vi.hoisted(() => ({
  fetchCompanyNewsMock: vi.fn().mockResolvedValue([
    {
      id: 1,
      headline: "AAPL hits all-time high",
      source: "Bloomberg",
      datetime: Math.floor(Date.now() / 1000),
      url: "https://example.com/news/1",
      category: "company",
      image: "",
      related: "AAPL",
      summary: "",
    },
  ]),
}));

vi.mock("@/lib/queries/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/market")>();
  return {
    ...actual,
    fetchCompanyNews: fetchCompanyNewsMock,
    newsKeys: {
      ticker: (symbol: string, from: string, to: string) => ["news", symbol, from, to],
    },
  };
});

import { NewsFeedPanel } from "@/components/panels/NewsFeedPanel";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
  fetchCompanyNewsMock.mockClear();
});

describe("NewsFeedPanel", () => {
  it("shows placeholder when no ticker is active", () => {
    render(<NewsFeedPanel panelId="panel-news" />, { wrapper });
    expect(screen.getByText(/click a ticker/i)).toBeInTheDocument();
  });

  it("fetches news when activeTicker is set", async () => {
    render(<NewsFeedPanel panelId="panel-news" />, { wrapper });

    act(() => {
      useTickerStore.getState().setActiveTicker("AAPL");
    });

    await waitFor(() => {
      expect(fetchCompanyNewsMock).toHaveBeenCalledWith("AAPL", expect.any(String), expect.any(String));
    });
  });

  it("refetches with new symbol when ticker changes", async () => {
    render(<NewsFeedPanel panelId="panel-news" />, { wrapper });

    act(() => {
      useTickerStore.getState().setActiveTicker("AAPL");
    });

    await waitFor(() => {
      expect(fetchCompanyNewsMock).toHaveBeenCalledWith("AAPL", expect.any(String), expect.any(String));
    });

    act(() => {
      useTickerStore.getState().setActiveTicker("MSFT");
    });

    await waitFor(() => {
      expect(fetchCompanyNewsMock).toHaveBeenCalledWith("MSFT", expect.any(String), expect.any(String));
    });
  });

  it("displays news headlines when loaded", async () => {
    render(<NewsFeedPanel panelId="panel-news" />, { wrapper });

    act(() => {
      useTickerStore.getState().setActiveTicker("AAPL");
    });

    await waitFor(() => {
      expect(screen.getByText("AAPL hits all-time high")).toBeInTheDocument();
    });
  });
});
