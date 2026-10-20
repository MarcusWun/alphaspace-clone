/**
 * FE-PY-4: ComparisonChartPanel persistence — adding a ticker triggers save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { updatePanelPropsMock, useQueriesMock } = vi.hoisted(() => ({
  updatePanelPropsMock: vi.fn(),
  useQueriesMock: vi.fn(),
}));

vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: vi.fn(),
    updatePanelProps: updatePanelPropsMock,
    removePanel: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query"
  );
  return {
    ...actual,
    useQueries: useQueriesMock,
  };
});

vi.mock("@/lib/queries/market", () => ({
  bucketedWindowForTimeRange: () => ({ from: 1000000, to: 2000000 }),
  fetchCandlesWithMeta: vi.fn(),
  timeRangeToResolution: () => "D",
}));

vi.mock("@/lib/stores/tickerStore", () => ({
  useTickerStore: (selector: (s: { activeTimeRange: string; setActiveTimeRange: () => void }) => unknown) =>
    selector({ activeTimeRange: "1Y", setActiveTimeRange: vi.fn() }),
}));

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn() })),
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
  updatePanelPropsMock.mockClear();
  // Return empty results for all ticker queries
  useQueriesMock.mockReturnValue([]);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ComparisonChartPanel persistence", () => {
  it("does NOT call save on initial mount (initial-mount guard)", () => {
    render(
      <ComparisonChartPanel
        panelId="chart-1"
        tickers={["AAPL", "MSFT"]}
        timeRange="1Y"
      />,
      { wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(updatePanelPropsMock).not.toHaveBeenCalled();
  });

  it("saves after adding a ticker (debounce 500ms)", async () => {
    render(
      <ComparisonChartPanel
        panelId="chart-1"
        tickers={["AAPL", "MSFT"]}
        timeRange="1Y"
      />,
      { wrapper }
    );

    // Add TSLA via the input form
    const input = screen.getByRole("textbox", { name: /add ticker/i });
    const form = input.closest("form")!;

    // Change + submit flush state; separate act() advances the debounce
    act(() => {
      fireEvent.change(input, { target: { value: "TSLA" } });
      fireEvent.submit(form);
    });

    // Should not have saved yet (debounce pending)
    expect(updatePanelPropsMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledOnce();
    expect(updatePanelPropsMock).toHaveBeenCalledWith("chart-1", expect.objectContaining({
      tickers: expect.arrayContaining(["AAPL", "MSFT", "TSLA"]),
    }));
  });

  it("saves the timeRange when changed", () => {
    render(
      <ComparisonChartPanel
        panelId="chart-1"
        tickers={["AAPL"]}
        timeRange="1Y"
      />,
      { wrapper }
    );

    // Click flushes state; separate act() fires the debounce
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "3M" }));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(updatePanelPropsMock).toHaveBeenCalledWith(
      "chart-1",
      expect.objectContaining({ timeRange: "3M" })
    );
  });
});
