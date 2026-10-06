/**
 * FE-CY-6: Chart type toggle + hook dedup/backoff tests.
 *
 * Test coverage:
 *  1. Workspace header toggle — clicking Candles calls PUT with chartType:"candles"
 *  2. Toggle persists across reload — initial render with chartType:"candles" renders candles active
 *  3. Header toggle — candlesDisabled shows aria-disabled + tooltip on Candles button
 *  4. Multi-ticker rule — chart renders line even when chartType:"candles" + 2 tickers; badge shown
 *  5. Hook dedup — two useCandles calls with same args fire only one fetch
 *  6. Hook retry/backoff — 500→500→200 resolves on 3rd attempt
 *  7. Hook retry exhaustion — 500×4 → error state; Retry button triggers refetch
 *  8. Chart card error UI — "Chart data unavailable" visible when query returns error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  renderHook,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTickerStore } from "@/lib/stores/tickerStore";

// ── Hoisted mock fns (must be before vi.mock calls — vi.hoisted() is also hoisted) ──
const { fetchCandlesMock, updateWorkspaceMock, MOCK_CANDLE_RESPONSE } = vi.hoisted(() => {
  const mockCandleResponse = {
    s: "ok",
    c: [150, 155, 160],
    t: [1700000000, 1700086400, 1700172800],
    h: [152, 157, 162],
    l: [148, 153, 158],
    o: [150, 154, 159],
    v: [1_000_000, 1_100_000, 1_200_000],
  };
  return {
    MOCK_CANDLE_RESPONSE: mockCandleResponse,
    fetchCandlesMock: vi.fn().mockResolvedValue(mockCandleResponse),
    updateWorkspaceMock: vi.fn().mockResolvedValue({
      id: "ws-1",
      name: "Test",
      layout: null,
      chartType: "candles",
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }),
  };
});

vi.mock("@/lib/queries/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/market")>();
  return {
    ...actual,
    fetchCandles: fetchCandlesMock,
    candleKeys: {
      ticker: (symbol: string, res: string, from: number, to: number) =>
        ["candles", symbol, res, from, to] as const,
    },
  };
});

vi.mock("@/lib/queries/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/workspaces")>();
  return {
    ...actual,
    updateWorkspace: updateWorkspaceMock,
    fetchWorkspaces: vi.fn().mockResolvedValue([
      {
        id: "ws-1",
        name: "Test Workspace",
        layout: null,
        chartType: "line",
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]),
  };
});

// Mock TradingView to avoid canvas requirement in jsdom
const { addSeriesMock, removeSeriesMock } = vi.hoisted(() => ({
  addSeriesMock: vi.fn(() => ({ setData: vi.fn() })),
  removeSeriesMock: vi.fn(),
}));

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: addSeriesMock,
    removeSeries: removeSeriesMock,
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    remove: vi.fn(),
  })),
  ColorType: { Solid: "solid" },
  LineSeries: { _type: "line" },
  CandlestickSeries: { _type: "candle" },
}));

// Mock next-auth for AppHeader
vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
}));

import { ComparisonChartPanel } from "@/components/panels/ComparisonChartPanel";
import { AppHeader } from "@/components/header/AppHeader";
import { useCandles } from "@/lib/queries/useCandles";

// ── Test utilities ────────────────────────────────────────────────────────────

function makeQueryClient(overrides?: ConstructorParameters<typeof QueryClient>[0]) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
    ...overrides,
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  fetchCandlesMock.mockClear();
  updateWorkspaceMock.mockClear();
  addSeriesMock.mockClear();
  removeSeriesMock.mockClear();
  useTickerStore.setState({ activeTicker: null, activeTimeRange: "1Y" });
});

// ── 1. AppHeader toggle — clicking Candles calls PUT ─────────────────────────
describe("AppHeader — chart type toggle", () => {
  it("clicking Candles calls PUT /api/workspaces/:id with chartType:candles", async () => {
    const onChartTypeChange = vi.fn();
    const qc = makeQueryClient();

    render(
      <AppHeader
        activeWorkspaceId="ws-1"
        lastSavedAt={null}
        onWorkspaceChange={vi.fn()}
        chartType="line"
        onChartTypeChange={onChartTypeChange}
        candlesDisabled={false}
      />,
      { wrapper: wrapper(qc) }
    );

    const candlesBtn = screen.getByTestId("chart-type-candles-btn");
    act(() => fireEvent.click(candlesBtn));

    // Optimistic update fired synchronously
    expect(onChartTypeChange).toHaveBeenCalledWith("candles");

    // PUT called with correct payload
    await waitFor(() => {
      expect(updateWorkspaceMock).toHaveBeenCalledWith("ws-1", { chartType: "candles" });
    });
  });

  it("renders with Candles button active when chartType is candles", () => {
    const qc = makeQueryClient();
    render(
      <AppHeader
        activeWorkspaceId="ws-1"
        lastSavedAt={null}
        onWorkspaceChange={vi.fn()}
        chartType="candles"
        onChartTypeChange={vi.fn()}
        candlesDisabled={false}
      />,
      { wrapper: wrapper(qc) }
    );

    const candlesBtn = screen.getByTestId("chart-type-candles-btn");
    expect(candlesBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows candles button with aria-disabled and tooltip when candlesDisabled=true", () => {
    const qc = makeQueryClient();
    render(
      <AppHeader
        activeWorkspaceId="ws-1"
        lastSavedAt={null}
        onWorkspaceChange={vi.fn()}
        chartType="candles"
        onChartTypeChange={vi.fn()}
        candlesDisabled={true}
      />,
      { wrapper: wrapper(qc) }
    );

    const candlesBtn = screen.getByTestId("chart-type-candles-btn");
    expect(candlesBtn).toHaveAttribute("aria-disabled", "true");
    expect(candlesBtn).toHaveAttribute(
      "title",
      "Candles only available for single-ticker charts"
    );
  });

  it("clicking the Candles button when disabled does NOT call updateWorkspace", () => {
    const onChartTypeChange = vi.fn();
    const qc = makeQueryClient();
    render(
      <AppHeader
        activeWorkspaceId="ws-1"
        lastSavedAt={null}
        onWorkspaceChange={vi.fn()}
        chartType="line"
        onChartTypeChange={onChartTypeChange}
        candlesDisabled={true}
      />,
      { wrapper: wrapper(qc) }
    );

    const candlesBtn = screen.getByTestId("chart-type-candles-btn");
    act(() => fireEvent.click(candlesBtn));

    expect(onChartTypeChange).not.toHaveBeenCalled();
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });
});

// ── 2. Multi-ticker rule ──────────────────────────────────────────────────────
describe("ComparisonChartPanel — multi-ticker rule", () => {
  it("renders line mode even when chartType=candles and 2+ tickers", async () => {
    const qc = makeQueryClient();
    render(
      <ComparisonChartPanel
        panelId="chart-1"
        tickers={["AAPL", "MSFT"]}
        timeRange="1Y"
        chartType="candles"
      />,
      { wrapper: wrapper(qc) }
    );

    // Wait for fetches to complete
    await waitFor(() => expect(fetchCandlesMock).toHaveBeenCalled());
    await waitFor(() => expect(addSeriesMock).toHaveBeenCalled());

    // Must be called with LineSeries (not CandlestickSeries)
    const { LineSeries, CandlestickSeries } = await import("lightweight-charts");
    const seriesTypeArgs = addSeriesMock.mock.calls.map((c) => (c as unknown[])[0]);
    expect(seriesTypeArgs.every((t) => t === LineSeries)).toBe(true);
    expect(seriesTypeArgs.some((t) => t === CandlestickSeries)).toBe(false);
  });

  it("shows candles-disabled badge when chartType=candles and 2+ tickers", async () => {
    const qc = makeQueryClient();
    render(
      <ComparisonChartPanel
        panelId="chart-2"
        tickers={["AAPL", "MSFT"]}
        timeRange="1Y"
        chartType="candles"
      />,
      { wrapper: wrapper(qc) }
    );

    expect(screen.getByTestId("candles-disabled-badge")).toBeInTheDocument();
    expect(
      screen.getByTitle("Candles only available for single-ticker charts")
    ).toBeInTheDocument();
  });

  it("does NOT show candles-disabled badge when single ticker + candles mode", async () => {
    const qc = makeQueryClient();
    render(
      <ComparisonChartPanel
        panelId="chart-3"
        tickers={["AAPL"]}
        timeRange="1Y"
        chartType="candles"
      />,
      { wrapper: wrapper(qc) }
    );

    expect(screen.queryByTestId("candles-disabled-badge")).toBeNull();
  });

  it("uses CandlestickSeries for single-ticker candles mode", async () => {
    const qc = makeQueryClient();
    render(
      <ComparisonChartPanel
        panelId="chart-4"
        tickers={["NVDA"]}
        timeRange="1Y"
        chartType="candles"
      />,
      { wrapper: wrapper(qc) }
    );

    await waitFor(() => expect(addSeriesMock).toHaveBeenCalled());

    const { CandlestickSeries } = await import("lightweight-charts");
    const seriesTypeArgs = addSeriesMock.mock.calls.map((c) => (c as unknown[])[0]);
    expect(seriesTypeArgs.some((t) => t === CandlestickSeries)).toBe(true);
  });
});

// ── 3. Chart card error UI ────────────────────────────────────────────────────
// Real timers — retry exhaustion (1 initial + 3 retries at 1s, 2s, 4s) takes ~7s.
// Math.random mocked to 0 to remove jitter and make timing deterministic.
describe("ComparisonChartPanel — error state", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows "Chart data unavailable" with Retry button after all retries exhausted', async () => {
    fetchCandlesMock.mockRejectedValue(new Error("Network error"));

    const qc = makeQueryClient();
    render(
      <ComparisonChartPanel
        panelId="chart-err"
        tickers={["AAPL"]}
        timeRange="1Y"
        chartType="line"
      />,
      { wrapper: wrapper(qc) }
    );

    // Wait for all 3 retries to exhaust (1s + 2s + 4s = 7s with no jitter)
    await waitFor(
      () => expect(screen.getByTestId("chart-error-state")).toBeInTheDocument(),
      { timeout: 15_000 }
    );
    expect(screen.getByText("Chart data unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  }, 20_000);

  it("Retry button triggers a fresh fetch and clears error on success", async () => {
    fetchCandlesMock.mockRejectedValue(new Error("Network error"));

    const qc = makeQueryClient();
    render(
      <ComparisonChartPanel
        panelId="chart-err2"
        tickers={["AAPL"]}
        timeRange="1Y"
        chartType="line"
      />,
      { wrapper: wrapper(qc) }
    );

    // Wait for error state (1s + 2s + 4s = 7s with no jitter)
    await waitFor(
      () => expect(screen.getByTestId("chart-error-state")).toBeInTheDocument(),
      { timeout: 15_000 }
    );

    // Next refetch should succeed
    fetchCandlesMock.mockResolvedValueOnce(MOCK_CANDLE_RESPONSE);
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    act(() => fireEvent.click(retryBtn));

    await waitFor(
      () => expect(screen.queryByTestId("chart-error-state")).toBeNull(),
      { timeout: 5_000 }
    );
  }, 25_000);
});

// ── 4. useCandles hook — dedup ────────────────────────────────────────────────
describe("useCandles — request dedup", () => {
  it("two useCandles calls with identical args fire only one fetch", async () => {
    fetchCandlesMock.mockResolvedValue(MOCK_CANDLE_RESPONSE);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function TwoHooks() {
      const a = useCandles("AAPL", "D", 1700000000, 1702000000);
      const b = useCandles("AAPL", "D", 1700000000, 1702000000);
      return (
        <div>
          <span data-testid="a-loading">{String(a.isLoading)}</span>
          <span data-testid="b-loading">{String(b.isLoading)}</span>
        </div>
      );
    }

    render(<TwoHooks />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("a-loading").textContent).toBe("false");
      expect(screen.getByTestId("b-loading").textContent).toBe("false");
    });

    // Both hooks resolved but only one upstream fetch
    expect(fetchCandlesMock).toHaveBeenCalledTimes(1);
  });

  it("different args are NOT deduped — each fires its own fetch", async () => {
    fetchCandlesMock.mockResolvedValue(MOCK_CANDLE_RESPONSE);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function TwoDifferentHooks() {
      useCandles("AAPL", "D", 1700000000, 1702000000);
      useCandles("MSFT", "D", 1700000000, 1702000000);
      return null;
    }

    render(<TwoDifferentHooks />, { wrapper: wrapper(qc) });

    await waitFor(() => expect(fetchCandlesMock).toHaveBeenCalledTimes(2));
  });
});

// ── 5. useCandles hook — retry / backoff ─────────────────────────────────────
describe("useCandles — retry / backoff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on 5xx: 500 → 500 → 200 resolves with data", async () => {
    const error500 = Object.assign(new Error("Server error"), { statusCode: 500 });
    fetchCandlesMock
      .mockRejectedValueOnce(error500)
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce(MOCK_CANDLE_RESPONSE);

    // Need a client that allows retries (override the test default)
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          // retryDelay = 0 to avoid timeouts in tests
          retryDelay: 0,
        },
      },
    });

    const { result } = renderHook(
      () => useCandles("AAPL", "D", 1700000000, 1702000000),
      { wrapper: wrapper(qc) }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), {
      timeout: 5000,
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(MOCK_CANDLE_RESPONSE);
    // 3 calls total (2 failures + 1 success)
    expect(fetchCandlesMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 4xx (symbol not found)", async () => {
    const { ApiError } = await import("@/lib/api-client");
    const error404 = new ApiError("Not found", 404, "NOT_FOUND");
    fetchCandlesMock.mockRejectedValue(error404);

    const qc = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });

    const { result } = renderHook(
      () => useCandles("ZZZZ", "D", 1700000000, 1702000000),
      { wrapper: wrapper(qc) }
    );

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 3000,
    });

    // Only called once — no retries for 4xx
    expect(fetchCandlesMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces error state after retry exhaustion (500×4)", async () => {
    const error500 = Object.assign(new Error("Server error"), { statusCode: 500 });
    fetchCandlesMock.mockRejectedValue(error500);

    const qc = new QueryClient({ defaultOptions: { queries: {} } });

    const { result } = renderHook(
      () => useCandles("AAPL", "D", 1700000000, 1702000000),
      { wrapper: wrapper(qc) }
    );

    // Wait for all 3 retries to exhaust (~7-9s)
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 12_000,
    });

    // 1 initial + 3 retries = 4 calls max
    expect(fetchCandlesMock).toHaveBeenCalledTimes(4);
  }, 15_000);

  it("refetch after exhaustion triggers a fresh request", async () => {
    const error500 = Object.assign(new Error("Server error"), { statusCode: 500 });
    fetchCandlesMock.mockRejectedValue(error500);

    const qc = new QueryClient({ defaultOptions: { queries: {} } });

    const { result } = renderHook(
      () => useCandles("AAPL", "D", 1700000000, 1702000000),
      { wrapper: wrapper(qc) }
    );

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 12_000,
    });

    fetchCandlesMock.mockResolvedValueOnce(MOCK_CANDLE_RESPONSE);
    const callsBefore = fetchCandlesMock.mock.calls.length;

    act(() => { result.current.refetch(); });

    await waitFor(
      () => expect(fetchCandlesMock.mock.calls.length).toBeGreaterThan(callsBefore),
      { timeout: 3000 }
    );
  }, 15_000);
});
