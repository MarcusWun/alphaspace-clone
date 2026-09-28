/**
 * AS-FE-11: Watchlist panel tests
 * Verifies that clicking a ticker updates a sibling component subscribing to activeTicker.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// Mock the watchlists query module
vi.mock("@/lib/queries/watchlists", () => ({
  watchlistKeys: { all: ["watchlists"] },
  fetchWatchlists: vi.fn().mockResolvedValue([
    {
      id: "wl-1",
      name: "My Watchlist",
      tickers: ["AAPL", "MSFT", "NVDA"],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ]),
  updateWatchlist: vi.fn().mockResolvedValue({ id: "wl-1", name: "My Watchlist", tickers: ["AAPL", "MSFT", "NVDA", "GOOG"] }),
  createWatchlist: vi.fn().mockResolvedValue({ id: "wl-1", name: "My Watchlist", tickers: [] }),
}));

import { WatchlistPanel } from "@/components/panels/WatchlistPanel";

// Sibling component that reads activeTicker from the store
function TickerDisplay() {
  const activeTicker = useTickerStore((s) => s.activeTicker);
  return <div data-testid="active-ticker">{activeTicker ?? "none"}</div>;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("WatchlistPanel", () => {
  it("clicking a ticker updates sibling subscribing to activeTicker", async () => {
    render(
      <div>
        <WatchlistPanel panelId="panel-1" tickers={[]} />
        <TickerDisplay />
      </div>,
      { wrapper }
    );

    // Wait for tickers to load from the mocked query
    await waitFor(() => {
      expect(screen.getByText("AAPL")).toBeInTheDocument();
    });

    expect(screen.getByTestId("active-ticker")).toHaveTextContent("none");

    // Click AAPL
    act(() => {
      fireEvent.click(screen.getByText("AAPL"));
    });

    expect(useTickerStore.getState().activeTicker).toBe("AAPL");
    expect(screen.getByTestId("active-ticker")).toHaveTextContent("AAPL");
  });

  it("clicking another ticker updates to that ticker", async () => {
    render(
      <div>
        <WatchlistPanel panelId="panel-1" tickers={[]} />
        <TickerDisplay />
      </div>,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("MSFT")).toBeInTheDocument();
    });

    act(() => fireEvent.click(screen.getByText("MSFT")));

    expect(screen.getByTestId("active-ticker")).toHaveTextContent("MSFT");
  });
});
