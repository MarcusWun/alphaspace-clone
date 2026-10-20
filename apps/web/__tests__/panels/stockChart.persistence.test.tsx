/**
 * FE-PY-4: StockChartPanel persistence — changing time range triggers save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { updatePanelPropsMock, useCandlesMock, useQuoteMock } = vi.hoisted(() => ({
  updatePanelPropsMock: vi.fn(),
  useCandlesMock: vi.fn(),
  useQuoteMock: vi.fn(),
}));

vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: vi.fn(),
    updatePanelProps: updatePanelPropsMock,
    removePanel: vi.fn(),
  }),
}));

vi.mock("@/lib/queries/useCandles", () => ({
  useCandles: useCandlesMock,
  candleQueryConfig: {},
}));

vi.mock("@/lib/queries/useQuote", () => ({
  useQuote: useQuoteMock,
}));

vi.mock("@/lib/queries/market", () => ({
  timeRangeToResolution: () => "D",
  bucketedWindowForTimeRange: () => ({ from: 1000000, to: 2000000 }),
}));

vi.mock("@/lib/stores/tickerStore", () => ({
  useTickerStore: (selector: (s: { activeTicker: string | null }) => unknown) =>
    selector({ activeTicker: null }),
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

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  updatePanelPropsMock.mockClear();
  useCandlesMock.mockReturnValue({ data: null, isLoading: false, rateLimited: false });
  useQuoteMock.mockReturnValue({ data: null, isLoading: false });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StockChartPanel persistence", () => {
  it("does NOT call save on initial mount", () => {
    render(
      <StockChartPanel panelId="stock-1" symbol="NVDA" />,
      { wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(updatePanelPropsMock).not.toHaveBeenCalled();
  });

  it("saves timeRange after user changes it", () => {
    render(
      <StockChartPanel panelId="stock-1" symbol="NVDA" />,
      { wrapper }
    );

    // Separate act() calls: first flush the click's state + effects, then advance timers
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /set time range 3M/i }));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledOnce();
    expect(updatePanelPropsMock).toHaveBeenCalledWith(
      "stock-1",
      expect.objectContaining({ timeRange: "3M" })
    );
  });

  it("saves activeTicker in the payload", () => {
    render(
      <StockChartPanel panelId="stock-1" symbol="NVDA" />,
      { wrapper }
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /set time range 1M/i }));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledWith(
      "stock-1",
      expect.objectContaining({ activeTicker: "NVDA" })
    );
  });
});
