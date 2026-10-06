/**
 * AS-FE-11: Group Comparison Chart tests.
 * - Removing a ticker does not refetch survivors
 * - Normalization formula is correct
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// ── Normalization helper — tested in isolation ────────────────────────────────
function normalizeCandles(
  c: number[],
  t: number[]
): Array<{ time: number; value: number }> {
  if (!c.length) return [];
  const first = c[0] ?? 1;
  return t.map((time, i) => ({
    time,
    value: (((c[i] ?? 0) - first) / first) * 100,
  }));
}

describe("normalizeCandles", () => {
  it("anchors first bar to 0%", () => {
    const result = normalizeCandles([100, 110, 90], [1, 2, 3]);
    expect(result[0]?.value).toBeCloseTo(0);
  });

  it("calculates 10% gain correctly", () => {
    const result = normalizeCandles([100, 110], [1, 2]);
    expect(result[1]?.value).toBeCloseTo(10);
  });

  it("calculates 10% loss correctly", () => {
    const result = normalizeCandles([100, 90], [1, 2]);
    expect(result[1]?.value).toBeCloseTo(-10);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeCandles([], [])).toEqual([]);
  });
});

// ── Panel tests — removing ticker doesn't refetch survivors ──────────────────

// Use vi.hoisted so mock fn is available inside vi.mock factory (which gets hoisted)
const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn().mockResolvedValue({
    s: "ok",
    c: [150, 155, 160],
    t: [1700000000, 1700086400, 1700172800],
    h: [152, 157, 162],
    l: [148, 153, 158],
    o: [150, 154, 159],
    v: [1000000, 1100000, 1200000],
  }),
}));

vi.mock("@/lib/queries/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/market")>();
  return {
    ...actual,
    fetchCandles: fetchMock,
    candleKeys: {
      ticker: (symbol: string, res: string, from: number, to: number) =>
        ["candles", symbol, res, from, to],
    },
  };
});

// Mock TradingView to avoid canvas requirement in jsdom
vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({
      setData: vi.fn(),
    })),
    removeSeries: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    remove: vi.fn(),
  })),
  ColorType: { Solid: "solid" },
  LineSeries: {},
  CandlestickSeries: {},
}));

import { ComparisonChartPanel } from "@/components/panels/ComparisonChartPanel";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockClear();
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("ComparisonChartPanel", () => {
  it("renders ticker chips for initial tickers", async () => {
    render(
      <ComparisonChartPanel
        panelId="chart-1"
        tickers={["AAPL", "MSFT"]}
        timeRange="1Y"
      />,
      { wrapper }
    );

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("removing a ticker does not refetch the remaining survivors", async () => {
    render(
      <ComparisonChartPanel
        panelId="chart-1"
        tickers={["AAPL", "MSFT", "NVDA"]}
        timeRange="1Y"
      />,
      { wrapper }
    );

    // Wait for initial fetches
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const callCountBeforeRemove = fetchMock.mock.calls.length;

    // Remove AAPL
    const removeButtons = screen.getAllByLabelText(/remove.*from chart/i);
    act(() => fireEvent.click(removeButtons[0]!));

    // Give React a tick
    await new Promise((r) => setTimeout(r, 50));

    // Survivors MSFT and NVDA should not have triggered new fetch calls
    // (TanStack Query serves from cache for same keys)
    const newCalls = fetchMock.mock.calls.length - callCountBeforeRemove;
    expect(newCalls).toBe(0);

    // AAPL chip should be gone
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  it("time range buttons exist including Custom", () => {
    render(
      <ComparisonChartPanel panelId="chart-2" tickers={[]} timeRange="1Y" />,
      { wrapper }
    );
    ["1W", "1M", "3M", "YTD", "1Y", "5Y", "Custom"].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("selecting Custom and entering dates triggers fetch with custom timestamps", async () => {
    render(
      <ComparisonChartPanel
        panelId="chart-custom"
        tickers={["AAPL"]}
        timeRange="1Y"
      />,
      { wrapper }
    );

    // Wait for initial fetch
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockClear();

    // Click Custom button
    const customBtn = screen.getByText("Custom");
    act(() => fireEvent.click(customBtn));

    // Date inputs should now be visible
    const fromInput = screen.getByLabelText("Custom range start date");
    const toInput = screen.getByLabelText("Custom range end date");

    const fromDateStr = "2024-01-01";
    const toDateStr = "2024-06-30";
    const expectedFrom = Math.floor(new Date(fromDateStr).getTime() / 1000);
    const expectedTo = Math.floor(new Date(toDateStr).getTime() / 1000);

    act(() => {
      fireEvent.change(fromInput, { target: { value: fromDateStr } });
      fireEvent.change(toInput, { target: { value: toDateStr } });
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "AAPL",
        expect.any(String),
        expectedFrom,
        expectedTo
      );
    });
  });
});
