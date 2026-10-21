/**
 * F5: StockChartPanel cross-panel ticker sync
 * F7: Cold-load regression — activeTicker null falls through to symbolProp
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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

const EMPTY_CANDLES = {
  s: "no_data" as const,
  c: [],
  t: [],
  h: [],
  l: [],
  o: [],
  v: [],
};
const MOCK_QUOTE = {
  c: 100,
  d: 1,
  dp: 1,
  h: 101,
  l: 99,
  o: 99.5,
  pc: 99,
  t: 1728000000,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useCandlesMock.mockReturnValue({
    data: EMPTY_CANDLES,
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

describe("StockChartPanel — ticker sync (F5)", () => {
  it("activeTicker wins over symbolProp when both are set", async () => {
    useTickerStore.setState({ activeTicker: "AAPL", activeTimeRange: "1Y" });

    render(<StockChartPanel panelId="sc-sync-1" symbol="NVDA" />, { wrapper });

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    expect(screen.queryByText("NVDA")).not.toBeInTheDocument();
  });

  it("updates panel symbol when activeTicker changes to GOOGL", async () => {
    useTickerStore.setState({ activeTicker: "AAPL", activeTimeRange: "1Y" });

    render(<StockChartPanel panelId="sc-sync-2" symbol="NVDA" />, { wrapper });

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());

    act(() => {
      useTickerStore.setState({ activeTicker: "GOOGL", activeTimeRange: "1Y" });
    });

    await waitFor(() => expect(screen.getByText("GOOGL")).toBeInTheDocument());
  });
});

describe("StockChartPanel — cold-load regression (F7)", () => {
  it("falls through to symbolProp when activeTicker is null", async () => {
    useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });

    render(<StockChartPanel panelId="sc-cold" symbol="MSFT" />, { wrapper });

    await waitFor(() => expect(screen.getByText("MSFT")).toBeInTheDocument());
  });

  it("uses DEFAULT_SYMBOL when both activeTicker and symbolProp are absent", async () => {
    useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });

    render(<StockChartPanel panelId="sc-default" />, { wrapper });

    await waitFor(() => expect(screen.getByText("NVDA")).toBeInTheDocument());
  });
});
