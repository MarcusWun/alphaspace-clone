/**
 * FE-P2A-7: StockChartPanel tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { useCandlesMock, useQuoteMock } = vi.hoisted(() => ({
  useCandlesMock: vi.fn(),
  useQuoteMock: vi.fn(),
}));

vi.mock("@/lib/queries/useCandles", () => ({
  useCandles: useCandlesMock,
}));
vi.mock("@/lib/queries/useQuote", () => ({
  useQuote: useQuoteMock,
}));
vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: vi.fn(),
    updatePanelProps: vi.fn(),
    removePanel: vi.fn(),
  }),
  CanvasProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
    removeSeries: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    remove: vi.fn(),
  })),
  ColorType: { Solid: "solid" },
  LineSeries: {},
  CandlestickSeries: {},
  HistogramSeries: {},
}));

import { StockChartPanel } from "@/components/panels/StockChartPanel";

const MOCK_CANDLES = {
  s: "ok" as const,
  c: [130, 132, 135],
  t: [1700000000, 1700086400, 1700172800],
  h: [133, 134, 136],
  l: [129, 131, 134],
  o: [130, 131, 134],
  v: [5_000_000, 5_200_000, 4_800_000],
};

const MOCK_QUOTE = {
  c: 135.72,
  d: 2.45,
  dp: 1.84,
  h: 136.5,
  l: 133.1,
  o: 133.5,
  pc: 133.27,
  t: 1728000000,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useCandlesMock.mockReturnValue({
    data: MOCK_CANDLES,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    rateLimited: false,
    refetch: vi.fn(),
  });
  useQuoteMock.mockReturnValue({
    data: MOCK_QUOTE,
    isLoading: false,
    isSuccess: true,
  });
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

describe("StockChartPanel", () => {
  it("renders symbol and quote values in header", async () => {
    render(<StockChartPanel panelId="sc-1" symbol="NVDA" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("NVDA")).toBeInTheDocument();
      expect(screen.getByText("$135.72")).toBeInTheDocument();
    });
  });

  it("shows rate-limited banner when rateLimited is true", async () => {
    useCandlesMock.mockReturnValue({
      data: { s: "no_data" as const, c: [], h: [], l: [], o: [], t: [], v: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      rateLimited: true,
      refetch: vi.fn(),
    });

    render(<StockChartPanel panelId="sc-2" symbol="NVDA" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("rate-limited-banner")).toBeInTheDocument();
      expect(screen.getByTestId("rate-limited-banner")).toHaveTextContent(
        "Chart data temporarily unavailable (rate-limited). Try again in a few minutes."
      );
    });
  });

  it("uses activeTicker from store when no symbol prop", async () => {
    useTickerStore.setState({ activeTicker: "AAPL", activeTimeRange: "1Y" });

    render(<StockChartPanel panelId="sc-3" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("AAPL")).toBeInTheDocument();
    });
  });

  it("changing resolution dropdown calls useCandles with new resolution", async () => {
    const { rerender } = render(
      <StockChartPanel panelId="sc-4" symbol="NVDA" />,
      { wrapper }
    );

    const callsBefore = useCandlesMock.mock.calls.length;

    // Click the "1D" button to change time range
    const oneDayBtn = screen.getByRole("button", { name: /set time range 1D/i });
    act(() => fireEvent.click(oneDayBtn));

    // useCandles should be called with "60" resolution (1D → 60)
    const callsAfter = useCandlesMock.mock.calls.length;
    expect(callsAfter).toBeGreaterThan(callsBefore);

    const lastCall = useCandlesMock.mock.calls[useCandlesMock.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe("NVDA");
    expect(lastCall?.[1]).toBe("60"); // 1D resolution is "60"

    void rerender;
  });

  it("selecting 5Y calls useCandles with resolution='D' and 5y window (FE-5Y-5)", async () => {
    render(<StockChartPanel panelId="sc-5y" symbol="NVDA" />, { wrapper });

    // Click the 5Y button
    const fiveYBtn = screen.getByRole("button", { name: /set time range 5Y/i });
    act(() => fireEvent.click(fiveYBtn));

    const calls = useCandlesMock.mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toBe("NVDA");
    expect(lastCall[1]).toBe("D"); // 5Y → daily resolution

    const from = lastCall[2] as number;
    const to = lastCall[3] as number;
    expect(typeof from).toBe("number");
    expect(typeof to).toBe("number");

    const fiveYearSeconds = 5 * 365 * 86_400;
    const diff = to - from;
    expect(diff).toBeGreaterThanOrEqual(fiveYearSeconds);
    expect(diff).toBeLessThanOrEqual(fiveYearSeconds + 2 * 86_400);
  });

  it("updates displayed ticker when activeTicker store changes", async () => {
    useTickerStore.setState({ activeTicker: "TSLA", activeTimeRange: "1Y" });

    const { rerender } = render(<StockChartPanel panelId="sc-5" />, { wrapper });

    await waitFor(() => expect(screen.getByText("TSLA")).toBeInTheDocument());

    act(() => {
      useTickerStore.setState({ activeTicker: "GOOGL", activeTimeRange: "1Y" });
    });

    rerender(<StockChartPanel panelId="sc-5" />);

    await waitFor(() => expect(screen.getByText("GOOGL")).toBeInTheDocument());
  });
});
